/**
 * The ask gate: what a turn parks on while it waits for a colleague's answer.
 *
 * An ask is a hand-off that waits. The turn files a task, then parks on this
 * gate; when the task ends, the conversation that asked resumes the parked turn
 * through `RequestHost.resumeAsk`, and the call the turn made returns the task's
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
 * **Never resumed from outside the asking conversation.** The public resume
 * route answers not-found for an ask gate, whatever source the asking turn
 * arrived on. Only the asker's own conversation resolves one (a running
 * request in the same session, through `RequestHost.resumeAsk`), or the host's
 * durability sweep, which resumes a gate still pending past its `deadline`
 * with `wait_timed_out`.
 *
 * `core` cannot name `orchestration`'s board types, so the binding crosses as
 * two strings, and the answer as `unknown`.
 */

import { SuspensionError, type SuspendOptions } from "../errors/suspension-error";

/** The suspension reason an ask gate carries. */
export const ASK_GATE_REASON = "ask" as const;

/** Whether a suspension is an ask gate. */
export function isAskGate(suspension: { readonly reason: string }): boolean {
  return suspension.reason === ASK_GATE_REASON;
}

/**
 * Whether a suspension is an approval that expired: not an ask, past its
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
  if (suspension.status !== "expired" || isAskGate(suspension)) return false;
  return (suspension.allow ?? ["approve", "reject"]).includes("reject");
}

/** What the parked turn waits on: one row on one board. */
export type AskGateBinding = {
  /** The board the asked row lives on. */
  readonly board: string;
  /** The asked row's id on that board. */
  readonly taskId: string;
};

/**
 * Why an ask ended without an answer. A model reads these, so they are
 * stable names.
 *
 * - `wait_timed_out` — the ask was still open at its deadline; the host's
 *   durability sweep resumes it with this error.
 * - `wait_task_failed` — the asked task failed for good.
 * - `wait_task_cancelled` — the asked task was cancelled.
 */
export type AskEndingErrorCode = "wait_timed_out" | "wait_task_failed" | "wait_task_cancelled";

/**
 * How an ask ended: the answer, an error naming the ending, or a stop.
 *
 * A stop is a person stopping the parked turn. No model reads it: the parked
 * call ends its asked row and the turn ends `aborted`.
 */
export type AskOutcome =
  | { readonly answered: true; readonly answer: unknown }
  | {
      readonly answered: false;
      readonly error: { readonly code: AskEndingErrorCode; readonly message: string };
    }
  | { readonly answered: false; readonly stopped: true };

/**
 * Thrown from {@link parkOnAsk} when a person stopped the parked turn. The
 * caller ends what it asked for and lets the turn end; it is not a tool error
 * for a model to read.
 */
export class AskStoppedError extends Error {
  constructor() {
    super("The asking turn was stopped.");
    this.name = "AskStoppedError";
  }
}

/**
 * Thrown from {@link parkOnAsk} when the ask ended without an answer. A
 * generator tool that throws it surfaces to the model as a failed tool call,
 * so the model reads it like any other tool error.
 */
export class AskEndedError extends Error {
  readonly code: AskEndingErrorCode;

  constructor(code: AskEndingErrorCode, message: string) {
    // The code leads the message, because the message is what the model reads.
    super(`${code}: ${message}`);
    this.name = "AskEndedError";
    this.code = code;
  }
}

const ASK_ENDING_CODES: ReadonlySet<string> = new Set<AskEndingErrorCode>([
  "wait_timed_out",
  "wait_task_failed",
  "wait_task_cancelled"
]);

/**
 * Read an ask outcome from a resume payload, or `undefined` when the payload is
 * not one. Shared by the gate (which reads what it was resumed with) and the
 * engine's resume path (which refuses to write anything else).
 */
export function parseAskOutcome(value: unknown): AskOutcome | undefined {
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
      ASK_ENDING_CODES.has(error.code) &&
      typeof error.message === "string"
    ) {
      return {
        answered: false,
        error: { code: error.code as AskEndingErrorCode, message: error.message }
      };
    }
  }
  return undefined;
}

/** Arguments to {@link parkOnAsk}. */
export type ParkOnAskInput = {
  /**
   * The gate's id, chosen before the turn parks so the caller can record it
   * first (the asked row carries it). Must be **unique within the session**,
   * not only the request: `RequestHost.resumeAsk` finds the gate by id across
   * the conversation, and refuses `ambiguous` rather than guess between two
   * parked turns that share one. And the same on every replay of the call
   * that parks.
   */
  readonly gateId: string;
  readonly binding: AskGateBinding;
  /** Shown wherever the suspension is listed. */
  readonly message?: string;
  /**
   * When the ask times out (epoch ms), the same instant the asked row records.
   * The host's durability sweep resumes a gate still pending past it with
   * `wait_timed_out`. Omit for no deadline.
   */
  readonly deadline?: number;
};

/**
 * Park the running turn on an ask gate, and return the answer once the
 * conversation that asked resumes it.
 *
 * Throws {@link AskEndedError} when the ask ended without an answer. Needs a
 * durable host: without one, `ctx.suspend` is absent or refuses, and so does
 * this.
 */
export async function parkOnAsk(
  ctx: { suspend?(options: SuspendOptions): Promise<unknown> },
  input: ParkOnAskInput
): Promise<unknown> {
  if (ctx.suspend === undefined) {
    throw new Error("parkOnAsk needs ctx.suspend, which only a durable host provides.");
  }
  const resumed = await ctx.suspend(askSuspendOptions(input));
  const outcome = parseAskOutcome(resumed);
  if (outcome === undefined) {
    throw new Error(`Ask gate "${input.gateId}" was resumed with something that is not an ask outcome.`);
  }
  return answerOf(outcome);
}

/** The suspension an ask gate is, for one park (or one read of it). */
function askSuspendOptions(input: ParkOnAskInput): SuspendOptions {
  return {
    reason: ASK_GATE_REASON,
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

function answerOf(outcome: AskOutcome): unknown {
  if (outcome.answered) return outcome.answer;
  if ("stopped" in outcome) throw new AskStoppedError();
  throw new AskEndedError(outcome.error.code, outcome.error.message);
}

/**
 * The outcome already recorded for this ask gate, or `undefined` when none
 * is: read without parking.
 *
 * On a replay after the gate was resolved (an answer, a timeout, a stop), the
 * recorded outcome comes back. When nothing is recorded, nothing is created:
 * the park this would have been is discarded. A caller that holds its own
 * answer (an ended row) uses this to learn whether a stop already won.
 */
export async function recordedAskOutcome(
  ctx: { suspend?(options: SuspendOptions): Promise<unknown> },
  input: ParkOnAskInput
): Promise<AskOutcome | undefined> {
  if (ctx.suspend === undefined) return undefined;
  try {
    return parseAskOutcome(await ctx.suspend(askSuspendOptions(input)));
  } catch (error) {
    if (error instanceof SuspensionError) return undefined;
    throw error;
  }
}
