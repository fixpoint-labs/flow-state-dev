/**
 * The wait gate: what a turn parks on while it waits for a colleague's answer.
 *
 * A wait is a dispatched task the caller waits on. The turn files a task, then
 * parks on this gate; when the task ends, the conversation that filed it resumes the parked turn
 * through `RequestHost.resumeWait`, and the call the turn made returns the task's
 * answer as its result. A generator's tool that parks here resumes with the
 * answer as that tool's result, exactly as an approval gate does.
 *
 * **The gate's data is the wait binding** — the board and the row the turn
 * waits on — and nothing else. The gate fences on the row's identity and its
 * single terminal ending, not on a per-attempt claim ticket: the board's own
 * ticket already stops a stale attempt from settling the row, so the gate
 * admits the ending of whichever attempt settles it, including one after a
 * retry. And the gate is pending exactly once, so it admits one answer.
 *
 * **Never resumed from outside the waiting conversation.** The public resume
 * route answers not-found for a wait gate, whatever source the waiting turn
 * arrived on. Only the waiting turn's own conversation resolves one (a running
 * request in the same session, through `RequestHost.resumeWait`), or the host's
 * durability sweep, which resumes a gate still pending past its `deadline`
 * with `wait_timed_out`.
 *
 * `core` cannot name `orchestration`'s board types, so the binding crosses as
 * two strings, and the answer as `unknown`.
 */

import { SuspensionError, type SuspendOptions } from "../errors/suspension-error";

/** The suspension reason a wait gate carries. */
export const WAIT_GATE_REASON = "wait" as const;

/**
 * The reason a wait gate was stored under before it was renamed. A gate parked
 * before the upgrade still carries it, and is a wait gate everywhere one is tested.
 */
const LEGACY_WAIT_GATE_REASON = "ask"; // retired-name-refusal: WR-9, a gate parked before the rename

/**
 * Whether a suspension is a wait gate: the one test of a gate's kind, so a gate
 * stored under the old reason is read as one wherever a wait gate is tested.
 */
export function isWaitGate(suspension: { readonly reason: string }): boolean {
  return suspension.reason === WAIT_GATE_REASON || suspension.reason === LEGACY_WAIT_GATE_REASON;
}

/**
 * Whether a suspension is an approval that expired: not a wait, past its
 * deadline (`expired`), and one a person could have rejected. Its turn carries
 * on as if the approval were rejected, marked expired. A suspension that
 * allows no `reject` (an input form) only expires. `allow` is absent on
 * records written before it existed, which read as approve/reject.
 */
export function isExpiredApproval(suspension: {
  readonly reason: string;
  readonly status: string;
  readonly allow?: readonly string[];
}): boolean {
  if (suspension.status !== "expired" || isWaitGate(suspension)) return false;
  return (suspension.allow ?? ["approve", "reject"]).includes("reject");
}

/** What the parked turn waits on: one row on one board. */
export type WaitGateBinding = {
  /** The board the waited-on row lives on. */
  readonly board: string;
  /** The waited-on row's id on that board. */
  readonly taskId: string;
};

/**
 * Why a wait ended without an answer. A model reads these, so they are
 * stable names.
 *
 * - `wait_timed_out` — the wait was still open at its deadline; the host's
 *   durability sweep resumes it with this error.
 * - `wait_task_failed` — the waited-on task failed for good.
 * - `wait_task_cancelled` — the waited-on task was cancelled.
 */
export type WaitEndingErrorCode = "wait_timed_out" | "wait_task_failed" | "wait_task_cancelled";

/**
 * How a wait ended: the answer, an error naming the ending, or a stop.
 *
 * A stop is a person stopping the parked turn. No model reads it: the parked
 * call ends its waited-on row and the turn ends `aborted`.
 */
export type WaitOutcome =
  | { readonly answered: true; readonly answer: unknown }
  | {
      readonly answered: false;
      readonly error: { readonly code: WaitEndingErrorCode; readonly message: string };
    }
  | { readonly answered: false; readonly stopped: true };

/**
 * Thrown from {@link parkOnWait} when a person stopped the parked turn. The
 * caller ends the task it waited on and lets the turn end; it is not a tool error
 * for a model to read.
 */
export class WaitStoppedError extends Error {
  constructor() {
    super("The waiting turn was stopped.");
    this.name = "WaitStoppedError";
  }
}

/**
 * Thrown from {@link parkOnWait} when the wait ended without an answer. A
 * generator tool that throws it surfaces to the model as a failed tool call,
 * so the model reads it like any other tool error.
 */
export class WaitEndedError extends Error {
  readonly code: WaitEndingErrorCode;

  constructor(code: WaitEndingErrorCode, message: string) {
    // The code leads the message, because the message is what the model reads.
    super(`${code}: ${message}`);
    this.name = "WaitEndedError";
    this.code = code;
  }
}

const WAIT_ENDING_CODES: ReadonlySet<string> = new Set<WaitEndingErrorCode>([
  "wait_timed_out",
  "wait_task_failed",
  "wait_task_cancelled"
]);

/**
 * Read a wait outcome from a resume payload, or `undefined` when the payload is
 * not one. Shared by the gate (which reads what it was resumed with) and the
 * engine's resume path (which refuses to write anything else).
 */
export function parseWaitOutcome(value: unknown): WaitOutcome | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.answered === true) {
    return { answered: true, answer: record.answer };
  }
  if (record.answered === false && record.stopped === true) {
    return { answered: false, stopped: true };
  }
  if (record.answered === false) {
    const error = record.error as Record<string, unknown> | null | undefined;
    if (
      error != null &&
      typeof error.code === "string" &&
      WAIT_ENDING_CODES.has(error.code) &&
      typeof error.message === "string"
    ) {
      return {
        answered: false,
        error: { code: error.code as WaitEndingErrorCode, message: error.message }
      };
    }
  }
  return undefined;
}

/** Arguments to {@link parkOnWait}. */
export type ParkOnWaitInput = {
  /**
   * The gate's id, chosen before the turn parks so the caller can record it
   * first (the waited-on row carries it). Must be **unique within the session**,
   * not only the request: `RequestHost.resumeWait` finds the gate by id across
   * the conversation, and refuses `ambiguous` rather than guess between two
   * parked turns that share one. And the same on every replay of the call
   * that parks.
   */
  readonly gateId: string;
  readonly binding: WaitGateBinding;
  /** Shown wherever the suspension is listed. */
  readonly message?: string;
  /**
   * When the wait times out (epoch ms), the same instant the waited-on row records.
   * The host's durability sweep resumes a gate still pending past it with
   * `wait_timed_out`. Omit for no deadline.
   */
  readonly deadline?: number;
};

/**
 * Park the running turn on a wait gate, and return the answer once the
 * conversation that filed the task resumes it.
 *
 * Throws {@link WaitEndedError} when the wait ended without an answer. Needs a
 * durable host: without one, `ctx.suspend` is absent or refuses, and so does
 * this.
 */
export async function parkOnWait(
  ctx: { suspend?(options: SuspendOptions): Promise<unknown> },
  input: ParkOnWaitInput
): Promise<unknown> {
  if (ctx.suspend === undefined) {
    throw new Error("parkOnWait needs ctx.suspend, which only a durable host provides.");
  }
  const resumed = await ctx.suspend(waitSuspendOptions(input));
  const outcome = parseWaitOutcome(resumed);
  if (outcome === undefined) {
    throw new Error(`Wait gate "${input.gateId}" was resumed with something that is not a wait outcome.`);
  }
  return answerOf(outcome);
}

/** The suspension a wait gate is, for one park (or one read of it). */
function waitSuspendOptions(input: ParkOnWaitInput): SuspendOptions {
  return {
    reason: WAIT_GATE_REASON,
    suspensionId: input.gateId,
    message: input.message ?? `Waiting for the answer to task "${input.binding.taskId}"`,
    data: { board: input.binding.board, taskId: input.binding.taskId },
    allow: ["submit"],
    // The gate stores an absolute `expiresAt` from this; at least 1ms, since a
    // zero timeout means "no deadline" to the suspension record.
    ...(input.deadline !== undefined
      ? { timeoutMs: Math.max(1, input.deadline - Date.now()) }
      : {})
  };
}

function answerOf(outcome: WaitOutcome): unknown {
  if (outcome.answered) return outcome.answer;
  if ("stopped" in outcome) throw new WaitStoppedError();
  throw new WaitEndedError(outcome.error.code, outcome.error.message);
}

/**
 * The outcome already recorded for this wait gate, or `undefined` when none
 * is: read without parking.
 *
 * On a replay after the gate was resolved (an answer, a timeout, a stop), the
 * recorded outcome comes back. When nothing is recorded, nothing is created:
 * the park this would have been is discarded. A caller that holds its own
 * answer (an ended row) uses this to learn whether a stop already won.
 */
export async function recordedWaitOutcome(
  ctx: { suspend?(options: SuspendOptions): Promise<unknown> },
  input: ParkOnWaitInput
): Promise<WaitOutcome | undefined> {
  if (ctx.suspend === undefined) return undefined;
  try {
    return parseWaitOutcome(await ctx.suspend(waitSuspendOptions(input)));
  } catch (error) {
    if (error instanceof SuspensionError) return undefined;
    throw error;
  }
}
