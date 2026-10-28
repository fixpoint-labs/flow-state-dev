/**
 * The harness gate: whether each Kitchen Sink mode can run on this host, and
 * if not, the one reason why.
 *
 * Server only, and decided **once per server start**. The picker at `/`, each
 * harness mode's address, and the flow list in `fsdev.config.ts` all read the
 * same memoized answer, so the page can never call a mode unavailable while
 * the server still serves its flow. A change to the setting, or to a mode's
 * sign-in or key, shows at the next restart; no rebuild, and nothing about it
 * is inlined into the browser bundle.
 *
 * Each harness mode gets the first reason that applies, in this order:
 * 1. the host: on Vercel, or no repository (`readHarnessWorkspace`);
 * 2. "not built yet": the mode has no flow kind in `lib/modes.ts`;
 * 3. the mode's own check (sign-in, key, SDK version), from `MODE_CHECKS`. A
 *    check that throws makes its mode unavailable with the error's message,
 *    and the other modes are unaffected.
 *
 * Flow State is available on every host.
 *
 * The goal control `gate-open` (test-mode builds only, through `goalControl`)
 * skips the host and each mode's own check, so a goal check that a mode
 * refuses can be seen to fail. A mode with no flow kind stays "not built
 * yet" under it: there is nothing to open.
 */
import { claudeCodeModeCheck } from "./claude-code-mode";
import { codexModeCheck } from "./codex-mode";
import { cursorModeCheck } from "./cursor-mode";
import { goalControl } from "./goal-control";
import { readHarnessWorkspace, type HarnessWorkspace } from "./harness-workspace";
import { MODES, isHarnessMode, type HarnessModeId, type KitchenSinkMode, type ModeId } from "./modes";

/**
 * Whether one mode can run here. An available mode's `note`, when set, is shown
 * where an unavailable mode's reason is. No mode sets one today — it carried
 * the "runs without its sandbox" warning before Kitchen Sink stopped
 * confining runs; the slot is kept for the next thing a mode needs to say.
 */
export type ModeAvailability =
  | { readonly available: true; readonly note?: string }
  | { readonly available: false; readonly reason: string };

/** Every mode's availability, by id. */
export type ModesAvailability = Readonly<Record<ModeId, ModeAvailability>>;

/** What a mode's own check is handed: the host has passed, so there is a repository. */
export interface ModeCheckHost {
  /** The top level of the git checkout harness sessions work on. */
  readonly repository: string;
}

/**
 * A harness mode's own check: sign-in, key, SDK version. Runs only when the host
 * has passed and the mode is built, once per server start. Its reason is shown
 * as written.
 */
export type ModeCheck = (host: ModeCheckHost) => ModeAvailability | Promise<ModeAvailability>;

/**
 * Each harness mode's own check. The slot each mode's issue fills, alongside
 * the mode's flow kind in `lib/modes.ts`. A built mode with no entry here has
 * nothing more to check.
 */
export const MODE_CHECKS: Partial<Record<HarnessModeId, ModeCheck>> = {
  "claude-code": claudeCodeModeCheck(),
  codex: codexModeCheck(),
  cursor: cursorModeCheck(),
};

/** The reason a harness mode with no flow kind shows. */
export const NOT_BUILT_YET = "Not built yet.";

/** What one decision reads. Every field defaults to this process's own. */
export interface DecideOptions {
  /** The repository, or why there is none. */
  readonly workspace?: HarnessWorkspace;
  readonly modes?: readonly KitchenSinkMode[];
  readonly checks?: Partial<Record<HarnessModeId, ModeCheck>>;
  /** Skip the host and each mode's own check (the `gate-open` goal control). */
  readonly gateOpen?: boolean;
}

/** The message a thrown check is shown with. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  const text = String(error);
  return text === "" ? "The mode's check failed." : text;
}

/**
 * Decide every mode's availability. Pure apart from the checks it runs, each
 * at most once; `modeAvailability()` is the memoized answer the app reads.
 */
export async function decideAvailability(options: DecideOptions = {}): Promise<ModesAvailability> {
  const workspace = options.workspace ?? readHarnessWorkspace();
  const modes = options.modes ?? MODES;
  const checks = options.checks ?? MODE_CHECKS;
  const gateOpen = options.gateOpen ?? goalControl() === "gate-open";

  const entries = await Promise.all(
    modes.map(async (mode): Promise<[ModeId, ModeAvailability]> => {
      if (!isHarnessMode(mode.id)) return [mode.id, { available: true }];
      const built = mode.flowKind !== undefined;
      // An open gate skips the host and the mode's own check, never "not built yet".
      if (gateOpen) return [mode.id, built ? { available: true } : { available: false, reason: NOT_BUILT_YET }];
      if (!workspace.ok) return [mode.id, { available: false, reason: workspace.reason }];
      if (!built) return [mode.id, { available: false, reason: NOT_BUILT_YET }];
      const check = checks[mode.id];
      if (check === undefined) return [mode.id, { available: true }];
      try {
        return [mode.id, await check({ repository: workspace.repository })];
      } catch (error) {
        return [mode.id, { available: false, reason: messageOf(error) }];
      }
    }),
  );
  return Object.fromEntries(entries) as Record<ModeId, ModeAvailability>;
}

/**
 * Held on `globalThis` so the page, the harness addresses and the flow list
 * share one answer however the server bundles them, and so a dev server's
 * hot reload does not decide again: a change shows at the next restart. The
 * flows themselves are rebuilt on every hot reload, deliberately
 * (`fsdev.config.ts`, beside its HMR dispose), from this same kept answer.
 */
const MEMO = Symbol.for("kitchen-sink.harness-gate");
type Memo = typeof globalThis & { [MEMO]?: Promise<ModesAvailability> };

/** Every mode's availability on this server, decided at the first read and kept until restart. */
export function modeAvailability(): Promise<ModesAvailability> {
  const memo = globalThis as Memo;
  memo[MEMO] ??= decideAvailability();
  return memo[MEMO];
}

/** Forget the decision, so the next read decides again. Tests only: a server never forgets. */
export function resetModeAvailabilityForTests(): void {
  delete (globalThis as Memo)[MEMO];
}

/**
 * The flows of the harness modes that are available, for the flow list. A mode
 * that is unavailable for any reason has no flow registered, so its
 * `/api/flows/<kind>/…` routes are not found; its factory is never called.
 *
 * @param factories Each built harness mode's flow, by mode id.
 * @returns The available modes' flows, keyed by mode id, ready to spread into `createFlowState({ flows })`.
 */
export async function availableHarnessFlows<F>(
  factories: Partial<Record<HarnessModeId, () => F | Promise<F>>>,
): Promise<Partial<Record<HarnessModeId, F>>> {
  const availability = await modeAvailability();
  const flows: Partial<Record<HarnessModeId, F>> = {};
  for (const [id, factory] of Object.entries(factories) as Array<[HarnessModeId, () => F | Promise<F>]>) {
    if (availability[id]?.available === true) flows[id] = await factory();
  }
  return flows;
}
