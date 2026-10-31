/**
 * Harness readiness: which coding harnesses can run on this machine, and what
 * to do about one that can't, read once at start and again on request.
 *
 * A host hands {@link harnessReadiness} one check per harness (each
 * integration ships one: `checkClaudeCodeReadiness`, `checkCodexReadiness`,
 * `checkCursorReadiness`, all core's `HarnessReadinessCheck`). The read runs
 * every check the first time it is asked, keeps the rows in this process, and
 * runs again only when a caller asks for `refresh`. Everything around it reads
 * those rows:
 *
 * - {@link formatHarnessReadiness}, the start log's table and the
 *   coordinator's context, from one formatter so the two never disagree;
 * - {@link harnessReadinessAction}, the read a screen draws chips from, with
 *   Re-check as `{ refresh: true }`;
 * - {@link harnessReadinessCapability}, a context entry a host adds to its
 *   coordinator's `uses`, so work is filed only on a ready harness;
 * - `read.refusal(harness)`, a coding flow's gate before a task starts.
 *
 * ## Rules
 *
 * - **Never fatal.** `read()` never throws. A check that throws, rejects or
 *   passes `timeoutMs` is a not-ready row with a plain reason and
 *   `unanswered: true`.
 * - **No poll.** A check runs on the first read, on a `refresh`, and from
 *   `refusal` for a harness last read as not ready. Concurrent runs of one
 *   harness's check share one call.
 * - **Nothing is stored.** Readiness is this machine's state, held in memory.
 *   Another process reads its own machine.
 * - **Opt-in.** Nothing here changes `harnessManager`; a host that installs
 *   none of it sees no difference.
 */
import { defineCapability, handler } from "@flow-state-dev/core";
import type { HarnessReadiness, HarnessReadinessCheck } from "@flow-state-dev/core/types";
import { z } from "zod";

/** How long a check may take before it reads as unanswered: 30 s, a cold Codex start. */
export const READINESS_CHECK_TIMEOUT_MS = 30_000;

/** One harness a host offers, and how to check it. */
export interface HarnessReadinessSlot {
  /** The name the user sees (`Codex`). Defaults to the harness's key. */
  label?: string;
  /** The harness's own check, from its integration package. */
  check: HarnessReadinessCheck;
}

/** One harness's readiness, as last read. */
export const harnessReadinessRowSchema = z.object({
  /** The harness's key, as the host names it (`codex`). */
  harness: z.string(),
  /** The name the user sees. */
  label: z.string(),
  ready: z.boolean(),
  /** What is wrong, for the user. `null` when ready. */
  reason: z.string().nullable(),
  /** What to do about it. `null` when ready, or when the check named nothing. */
  remedy: z.string().nullable(),
  /** The check got no answer, so nothing is known either way. */
  unanswered: z.boolean(),
  /** When the check finished, in epoch ms. */
  checkedAt: z.number(),
});

export type HarnessReadinessRow = z.infer<typeof harnessReadinessRowSchema>;

/** Options for {@link harnessReadiness}. */
export interface HarnessReadinessOptions {
  /** How long one check may take. Default {@link READINESS_CHECK_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** What {@link HarnessReadinessRead.read} is asked for. */
export interface ReadReadinessOptions {
  /** Run the checks again: every harness (`true`), or one by its key. Default: the kept rows. */
  refresh?: boolean | string;
}

/** The kept readiness of a host's harnesses. */
export interface HarnessReadinessRead {
  /** The harnesses' keys, in the order the host gave them. */
  readonly harnesses: readonly string[];
  /**
   * Every harness's row, in {@link harnesses} order. Runs a check for any
   * harness with no row yet, and for those `refresh` names. Never throws.
   */
  read(options?: ReadReadinessOptions): Promise<HarnessReadinessRow[]>;
  /**
   * Why a task on `harness` can't start, as a sentence that names it and
   * says what to do, or `undefined` when it can. A ready row answers without
   * a check; a not-ready one is checked again first, so a sign-in made since
   * the last read counts. A harness the host didn't name answers `undefined`:
   * there is nothing to check.
   */
  refusal(harness: string): Promise<string | undefined>;
}

/**
 * Keep the readiness of a host's harnesses (see the file header).
 *
 * @param slots One check per harness, keyed by the harness's name.
 * @throws When no harness is given.
 */
export function harnessReadiness(
  slots: Readonly<Record<string, HarnessReadinessSlot>>,
  options: HarnessReadinessOptions = {},
): HarnessReadinessRead {
  const harnesses = Object.keys(slots);
  if (harnesses.length === 0) throw new Error("harnessReadiness: no harness to check.");
  const timeoutMs = options.timeoutMs ?? READINESS_CHECK_TIMEOUT_MS;
  const rows = new Map<string, HarnessReadinessRow>();
  const inFlight = new Map<string, Promise<HarnessReadinessRow>>();

  const run = (harness: string): Promise<HarnessReadinessRow> => {
    const running = inFlight.get(harness);
    if (running !== undefined) return running;
    const slot = slots[harness]!;
    const started = checkWithin(slot.check, timeoutMs)
      .then((answer) => {
        const row = rowOf(harness, slot.label ?? harness, answer, Date.now());
        rows.set(harness, row);
        return row;
      })
      .finally(() => inFlight.delete(harness));
    inFlight.set(harness, started);
    return started;
  };

  const read: HarnessReadinessRead["read"] = async (asked = {}) => {
    const refresh = asked.refresh;
    return Promise.all(
      harnesses.map((harness) => {
        const kept = rows.get(harness);
        const again = refresh === true || refresh === harness;
        return kept !== undefined && !again ? kept : run(harness);
      }),
    );
  };

  return {
    harnesses,
    read,
    async refusal(harness) {
      if (!(harness in slots)) return undefined;
      let row = rows.get(harness) ?? (await run(harness));
      if (!row.ready) row = await run(harness);
      return row.ready ? undefined : refusalOf(row);
    },
  };
}

/** A task's refusal on a harness that isn't ready. */
function refusalOf(row: HarnessReadinessRow): string {
  const fix = row.remedy === null ? "" : ` ${withStop(row.remedy)}`;
  return `${row.label} isn't set up on this machine: ${withStop(row.reason ?? "its check failed")}${fix} Then start the task again.`;
}

/** `text` ending in one full stop. */
function withStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Run one check, reading a throw, a rejection or a timeout as not ready. */
async function checkWithin(check: HarnessReadinessCheck, timeoutMs: number): Promise<HarnessReadiness> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<HarnessReadiness>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ready: false, reason: `The check did not answer within ${timeoutMs / 1000} s`, remedy: "Re-check", unanswered: true });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => check({ signal: controller.signal }))
        .catch(
          (error: unknown): HarnessReadiness => ({
            ready: false,
            reason: `The check failed: ${messageOf(error)}`,
            unanswered: true,
          }),
        ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A row from one check's answer. */
function rowOf(harness: string, label: string, answer: HarnessReadiness, checkedAt: number): HarnessReadinessRow {
  if (answer.ready) return { harness, label, ready: true, reason: null, remedy: null, unanswered: false, checkedAt };
  return {
    harness,
    label,
    ready: false,
    reason: answer.reason,
    remedy: answer.remedy ?? null,
    unanswered: answer.unanswered === true,
    checkedAt,
  };
}

/** The message a thrown value is shown with. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  const text = String(error);
  return text === "" ? "no message" : text;
}

/**
 * The rows as text: one line per harness, `✓ Cursor` or
 * `✗ Codex: <reason>. <remedy>.`, under a heading. The start log and the
 * coordinator's context both print this.
 */
export function formatHarnessReadiness(rows: readonly HarnessReadinessRow[]): string {
  const lines = rows.map((row) => {
    if (row.ready) return `✓ ${row.label}`;
    const fix = row.remedy === null ? "" : ` ${withStop(row.remedy)}`;
    return `✗ ${row.label}: ${withStop(row.reason ?? "its check failed")}${fix}`;
  });
  return ["Coding harnesses on this machine:", ...lines].join("\n");
}

/**
 * The readiness read, as one flow-level action a host puts on a flow:
 * `actions: { harnessReadiness: harnessReadinessAction(readiness) }`.
 *
 * Input `{ refresh?: boolean }`; `refresh: true` is Re-check. Output
 * `{ harnesses }`, one {@link HarnessReadinessRow} per harness. Zero-model.
 */
export function harnessReadinessAction(readiness: HarnessReadinessRead) {
  return {
    description:
      "Which coding harnesses can run on this machine, and what to do about one that can't. " +
      "`refresh: true` checks them again.",
    block: handler({
      name: "harness-readiness",
      inputSchema: z.object({ refresh: z.boolean().optional() }),
      outputSchema: z.object({ harnesses: z.array(harnessReadinessRowSchema) }),
      execute: async (input) => ({ harnesses: await readiness.read({ refresh: input.refresh === true }) }),
    }),
  };
}

/** The guidance under the rows in the coordinator's context. */
export const READINESS_GUIDANCE =
  "File coding work only on a harness marked ✓. If the user asks for one marked ✗, don't start it there: " +
  "say it isn't set up and what to run, and offer a ready one.";

/**
 * The readiness rows in a generator's context, for a host's coordinator:
 * `uses: [harnessReadinessCapability(readiness)]`. Reads the kept rows, so a
 * turn starts no check of its own once the first read has run.
 */
export function harnessReadinessCapability(readiness: HarnessReadinessRead) {
  return defineCapability({
    name: "harness-manager:readiness",
    presets: {
      context: {
        context: [
          async () => ({ harnessReadiness: `${formatHarnessReadiness(await readiness.read())}\n\n${READINESS_GUIDANCE}` }),
        ],
      },
      default: ["context"],
    },
  });
}
