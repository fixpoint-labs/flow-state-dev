/**
 * The harness gate: whether each Kitchen Sink mode can run on this host, and
 * if not, the one reason why.
 *
 * Server only, and decided **at server start**. The flow list in
 * `fsdev.config.ts` reads that first answer and never another, so a mode's
 * flow is registered only when it was available at start. The picker at `/`
 * and each harness mode's address read the kept answer, which a development
 * server's Re-check (`recheckModeAvailability`) decides again: a sign-in made
 * after start then shows on the picker, and a mode that turned available says
 * to restart the server to open it, since its flow isn't registered
 * (`openableAvailability`). A deployed server never decides again; a change
 * shows at the next restart. Nothing about it is inlined into the browser
 * bundle.
 *
 * Each harness mode gets the first reason that applies, in this order:
 * 1. the host: on Vercel, or no repository (`readHarnessWorkspace`);
 * 2. "not built yet": the mode has no flow kind in `lib/modes.ts`;
 * 3. the mode's own check (sign-in, key, SDK version), from `MODE_CHECKS`. A
 *    check that throws makes its mode unavailable with the error's message,
 *    and the other modes are unaffected. Its sign-in leg is the harness's own
 *    readiness check, from its integration package, read through
 *    `fromReadiness`, so the reason and the remedy are the vendor's.
 *
 * Flow State is available on every host. Without `AI_GATEWAY_API_KEY` it says
 * so in its note: it opens, but none of its flows can answer.
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
 * where an unavailable mode's reason is: Flow State's, when the gateway key is
 * missing. An unavailable mode's `remedy`, when set, is what to do about it.
 */
export type ModeAvailability =
  | { readonly available: true; readonly note?: string }
  | { readonly available: false; readonly reason: string; readonly remedy?: string };

/** A harness's readiness as its mode's availability; in a leaf module, since each mode's file imports it. */
export { fromReadiness } from "./mode-readiness";

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

/** Flow State's note when the server has no gateway key. */
export const NO_GATEWAY_KEY =
  "AI_GATEWAY_API_KEY is not set, so none of its flows can answer. Set it in apps/kitchen-sink/.env.local, then restart.";

/** What a mode that turned available after start shows: its flow isn't registered. */
export const RESTART_TO_OPEN = "Ready now. Restart the server to open it.";

/** What one decision reads. Every field defaults to this process's own. */
export interface DecideOptions {
  /** The repository, or why there is none. */
  readonly workspace?: HarnessWorkspace;
  readonly modes?: readonly KitchenSinkMode[];
  readonly checks?: Partial<Record<HarnessModeId, ModeCheck>>;
  /** Skip the host and each mode's own check (the `gate-open` goal control). */
  readonly gateOpen?: boolean;
  /** The gateway key Flow State's flows answer through. */
  readonly gatewayKey?: string;
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
  const gatewayKey = "gatewayKey" in options ? options.gatewayKey : process.env.AI_GATEWAY_API_KEY;

  const entries = await Promise.all(
    modes.map(async (mode): Promise<[ModeId, ModeAvailability]> => {
      if (!isHarnessMode(mode.id)) {
        return [mode.id, gatewayKey === undefined || gatewayKey === "" ? { available: true, note: NO_GATEWAY_KEY } : { available: true }];
      }
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
 * hot reload does not decide again. The flows themselves are rebuilt on every
 * hot reload, deliberately (`fsdev.config.ts`, beside its HMR dispose), from
 * the start's answer. `START` is the first decision and is never replaced;
 * `MEMO` is the latest, which only a Re-check replaces.
 */
const MEMO = Symbol.for("kitchen-sink.harness-gate");
const START = Symbol.for("kitchen-sink.harness-gate.start");
type Memo = typeof globalThis & { [MEMO]?: Promise<ModesAvailability>; [START]?: Promise<ModesAvailability> };

/** The answer the server started with: what the flow list registered. */
function startAvailability(): Promise<ModesAvailability> {
  const memo = globalThis as Memo;
  memo[START] ??= memo[MEMO] ?? decideAvailability();
  return memo[START];
}

/** Every mode's availability on this server: the start's answer, or the latest Re-check's. */
export function modeAvailability(): Promise<ModesAvailability> {
  const memo = globalThis as Memo;
  memo[MEMO] ??= startAvailability();
  return memo[MEMO];
}

/**
 * Decide again and keep the new answer, for the picker's Re-check. It never
 * changes the flow list, which was built from the start's answer
 * (`openableAvailability` says so for a mode that turned available).
 *
 * @throws On a production server, where availability is decided once per start.
 */
export function recheckModeAvailability(production = process.env.NODE_ENV === "production"): Promise<ModesAvailability> {
  if (production) throw new Error("Re-check is for a development server; restart the server to check again.");
  const memo = globalThis as Memo;
  memo[MEMO] = decideAvailability();
  return memo[MEMO];
}

/**
 * What the picker and a mode's address show: the latest answer, except that a
 * mode that wasn't available at start stays closed, since its flow isn't
 * registered, and says to restart when it is available now.
 */
export async function openableAvailability(): Promise<ModesAvailability> {
  const [start, now] = await Promise.all([startAvailability(), modeAvailability()]);
  const shown = Object.entries(now).map(([id, current]): [ModeId, ModeAvailability] => {
    const opened = start[id as ModeId]?.available === true;
    if (opened || !current.available) return [id as ModeId, current];
    return [id as ModeId, { available: false, reason: RESTART_TO_OPEN }];
  });
  return Object.fromEntries(shown) as Record<ModeId, ModeAvailability>;
}

/** Forget both decisions, so the next read decides again. Tests only: a server never forgets its start. */
export function resetModeAvailabilityForTests(): void {
  delete (globalThis as Memo)[MEMO];
  delete (globalThis as Memo)[START];
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
  const availability = await startAvailability();
  const flows: Partial<Record<HarnessModeId, F>> = {};
  for (const [id, factory] of Object.entries(factories) as Array<[HarnessModeId, () => F | Promise<F>]>) {
    if (availability[id]?.available === true) flows[id] = await factory();
  }
  return flows;
}
