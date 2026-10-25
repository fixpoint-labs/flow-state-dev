/**
 * The wait gate: what a request parks on while it waits for work that runs
 * elsewhere (FIX-1816; one gate for every wait since FIX-2082).
 *
 * A request waits on work already started: a task it filed (`getTask` with
 * `wait`), a row its plan board handed to another session, or a request a
 * `dispatcher({ wait: true })` started. It parks on this gate, and resumes once:
 *
 * - **with the ending**, when the work ends. For a task, the claim gate writes
 *   the ending, and the filing session resumes the parked request through
 *   `RequestHost.resumeWait`. For a dispatched request, the engine resumes the
 *   parent when the child request ends.
 * - **at the deadline**, with the work still running. The deadline is a wake
 *   ({@link WAIT_DEADLINE_ENTRY}) on the waiting request's session, which the
 *   host's durability sweep fires. Nothing is cancelled: the waiting call reads
 *   the work as it stands.
 * - **with a stop**, when a person stops the parked request.
 *
 * **The gate's data is the wait binding**, its deadline and the waiting
 * request's own work, and nothing else. The gate fences on the work's identity
 * and its single ending, not on a per-attempt claim ticket, and it is pending
 * exactly once, so it admits one outcome.
 *
 * **Never resumed from outside the waiting session.** The public resume route
 * answers not-found for a wait gate. Only the waiting session resolves one (a
 * running request in it, through `RequestHost.resumeWait`), or the engine: its
 * durability sweep at the deadline, and its own resume when a waited-on child
 * request ends.
 *
 * `core` cannot name `orchestration`'s board types, so a row binding crosses as
 * two strings, and the answer as `unknown`.
 */

import { isUserSuspension } from "@flow-state-dev/contracts";
import { SuspensionError, type SuspendOptions } from "../errors/suspension-error";

/** The suspension reason a wait gate carries. */
export const WAIT_GATE_REASON = "wait" as const;

const LEGACY_WAIT_GATE_REASON = "ask"; // retired-name-refusal: WR-9, a gate parked before the rename

/**
 * The internal entry a wait's deadline wake names (FIX-2082 D1). The engine
 * fires it itself: no flow declares it. One wake per session carries the
 * earliest deadline of the waits parked there.
 */
export const WAIT_DEADLINE_ENTRY = "waitDeadline";

/**
 * How many waits may be parked in one chain, the new one included: five. A
 * request may wait on work whose own request waits, and so on down, up to this
 * many. The engine counts the live chain from both ends when a wait starts.
 */
export const MAX_WAIT_DEPTH = 5;

/** The one test of a gate's kind, including a gate stored before the rename. */
export function isWaitGate(suspension: { readonly reason: string }): boolean {
  return suspension.reason === WAIT_GATE_REASON || suspension.reason === LEGACY_WAIT_GATE_REASON;
}

/**
 * Whether a suspension that passed its deadline carries its turn on: not a
 * wait, past its deadline (`expired`), and either one a person could have
 * rejected (an approval, read as a no marked expired) or one that waits for a
 * user (FIX-2129: a review or an input, which resumes its block with
 * `SuspensionTimeoutError`). Any other suspension that allows no `reject`
 * only expires. `allow` is absent on records written before it existed,
 * which read as approve/reject.
 */
export function continuesAtExpiry(suspension: {
  readonly reason: string;
  readonly status: string;
  readonly allow?: readonly string[];
}): boolean {
  if (suspension.status !== "expired" || isWaitGate(suspension)) return false;
  return isUserSuspension(suspension) || (suspension.allow ?? ["approve", "reject"]).includes("reject");
}

/** A row on a board: the waited-on task, or the task a waiting request works. */
export type WaitRow = {
  /** The board the row lives on. */
  readonly board: string;
  /** The row's id on that board. */
  readonly taskId: string;
};

/**
 * What the parked request waits on: one row on one board, or one request it
 * dispatched (a `dispatcher({ wait: true })`, FIX-2082).
 */
export type WaitGateBinding = WaitRow | { readonly requestId: string };

/**
 * Why a wait ended without an answer. A model never reads these: the waiting
 * call turns them into what it returns.
 *
 * - `wait_task_failed` — the waited-on work failed for good.
 * - `wait_task_cancelled` — the waited-on work was cancelled.
 * - `wait_timed_out` — only on a gate parked before FIX-2082, whose deadline
 *   was the suspension's expiry: the durability sweep resumes it with this.
 */
export type WaitEndingErrorCode = "wait_timed_out" | "wait_task_failed" | "wait_task_cancelled";

/**
 * How a wait ended: the answer, an error naming the ending, the deadline with
 * the work still running, or a stop.
 *
 * A stop is a person stopping the parked request. No model reads it: the
 * parked call ends its waited-on work and the request ends `aborted`.
 */
export type WaitOutcome =
  | { readonly answered: true; readonly answer: unknown }
  | {
      readonly answered: false;
      readonly error: { readonly code: WaitEndingErrorCode; readonly message: string };
    }
  | { readonly answered: false; readonly deadline: true }
  | { readonly answered: false; readonly stopped: true };

/** The outcome a wait's deadline resumes it with: the work is still running. */
export const WAIT_DEADLINE_OUTCOME: WaitOutcome = { answered: false, deadline: true };

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
  if (record.answered === false && record.deadline === true) {
    return WAIT_DEADLINE_OUTCOME;
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
   * The gate's id, chosen before the request parks so the caller can record it
   * first (a waited-on row carries it). Must be **unique within the session**,
   * not only the request: `RequestHost.resumeWait` finds the gate by id across
   * the session, and refuses `ambiguous` rather than guess between two parked
   * requests that share one. And the same on every replay of the call that
   * parks.
   */
  readonly gateId: string;
  readonly binding: WaitGateBinding;
  /**
   * The row the waiting request works, when it works one: the task its claim
   * holds. Server-derived by the caller, never input. The engine's depth count
   * reads it to find what waits on this request's own work.
   */
  readonly own?: WaitRow;
  /** Shown wherever the suspension is listed. */
  readonly message?: string;
  /**
   * When the wait resumes with the work still running (epoch ms). The engine
   * keeps it as a wake ({@link WAIT_DEADLINE_ENTRY}) on the session, never as
   * the suspension's expiry.
   */
  readonly deadline: number;
};

/** What a wait gate's suspension data holds, as the engine reads it back. */
export type WaitGateData = {
  readonly binding: WaitGateBinding;
  readonly own?: WaitRow;
  readonly deadline?: number;
};

/**
 * Read a wait gate's data back from its suspension record: what it waits on,
 * the waiting request's own row, and its deadline. `undefined` for a record
 * that carries no binding. A gate parked before FIX-2082 has no deadline in
 * its data (its expiry is its deadline) and no own row (BP-030).
 */
export function waitGateDataOf(record: { readonly data?: Record<string, unknown> | undefined }): WaitGateData | undefined {
  const data = record.data;
  if (data == null) return undefined;
  const own = data.own as Record<string, unknown> | undefined;
  const ownRow =
    own != null && typeof own.board === "string" && typeof own.taskId === "string"
      ? { board: own.board, taskId: own.taskId }
      : undefined;
  const deadline = typeof data.deadline === "number" ? data.deadline : undefined;
  const extras = { ...(ownRow !== undefined ? { own: ownRow } : {}), ...(deadline !== undefined ? { deadline } : {}) };
  if (typeof data.requestId === "string") return { binding: { requestId: data.requestId }, ...extras };
  if (typeof data.board === "string" && typeof data.taskId === "string") {
    return { binding: { board: data.board, taskId: data.taskId }, ...extras };
  }
  return undefined;
}

/**
 * Whether the running request's host can hold a wait (FIX-1816 BR-5, FIX-2082
 * D1): durable execution (the resume is wired), a durability sweeper that
 * resumes a wait at its deadline (`RequestHost.hasWaitSweeper`), and wakes
 * (`RequestHost.waits`, present only where they are kept). Read off the
 * server's request host, never from input. Every wait checks it before
 * anything is written.
 */
export function canHoldWait(ctx: {
  readonly requestHost?: { readonly resumeWait?: unknown; readonly hasWaitSweeper?: boolean; readonly waits?: unknown };
}): boolean {
  const host = ctx.requestHost;
  return host?.resumeWait !== undefined && host.hasWaitSweeper === true && host.waits !== undefined;
}

/**
 * Park the running request on a wait gate, and return how the wait ended once
 * it resumes: the answer, an error, the deadline, or a stop.
 *
 * Needs a durable host: without one, `ctx.suspend` is absent or refuses, and so
 * does this.
 */
export async function parkOnWait(
  ctx: { suspend?(options: SuspendOptions): Promise<unknown> },
  input: ParkOnWaitInput
): Promise<WaitOutcome> {
  if (ctx.suspend === undefined) {
    throw new Error("parkOnWait needs ctx.suspend, which only a durable host provides.");
  }
  const resumed = await ctx.suspend(waitSuspendOptions(input));
  const outcome = parseWaitOutcome(resumed);
  if (outcome === undefined) {
    throw new Error(`Wait gate "${input.gateId}" was resumed with something that is not a wait outcome.`);
  }
  return outcome;
}

/** The suspension a wait gate is, for one park (or one read of it). */
function waitSuspendOptions(input: ParkOnWaitInput): SuspendOptions {
  const { binding } = input;
  return {
    reason: WAIT_GATE_REASON,
    suspensionId: input.gateId,
    message:
      input.message ??
      ("taskId" in binding ? `Waiting on task "${binding.taskId}"` : `Waiting on request "${binding.requestId}"`),
    data: {
      ...binding,
      deadline: input.deadline,
      ...(input.own !== undefined ? { own: { board: input.own.board, taskId: input.own.taskId } } : {})
    },
    allow: ["submit"]
  };
}

/**
 * The outcome already recorded for this wait gate, or `undefined` when none
 * is: read without parking.
 *
 * On a replay after the gate was resolved, the recorded outcome comes back.
 * When nothing is recorded, nothing is created: the park this would have been
 * is discarded. A caller that holds its own answer (work already ended) uses
 * this to learn whether a stop already won.
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
