/**
 * A durable ledger's ending recorder: what a task's ending is, how a write's
 * ending is read off the row ({@link endingOf}), and the one function a
 * declared recorder's answer goes through (FIX-1794 P2).
 *
 * A composing layer sometimes owes someone something because a task ended:
 * whoever filed it is to be told, a waiting caller is to be resumed. Recording
 * that debt in a second write after the ending leaves a window where the
 * ending is stored and the debt is not, and a crash in it loses the debt for
 * good. So a ledger declared with `recordEnding` hands every ending write's
 * row to it, inside the same atomic write, and keeps the `metadata` it
 * returns. The ending and the debt land together or not at all.
 *
 * There is one ending signal. Every write that changes a row goes through
 * `internal.ts` (`applyTransition`, `applyAbandonmentSettlement`), on both
 * backings, and that is where the ending is detected, once, and every
 * recorder runs: orchestration's own resume recorder first (a waited-on row's
 * `Task.resumeOwed`, FIX-1816), then the ledger's declared one. So every
 * producer of an ending reaches it: a worker settling the task it holds (a
 * board's recorders, a task entry's gate), a board refusing a dispatch, the
 * claim path settling a row whose worker died too often, and a cancel.
 *
 * The recorder runs inside the write and may run more than once (a version
 * conflict re-runs the write against fresher state), so it must be a pure
 * function of what it is handed.
 *
 * Orchestration never reads what the recorder adds: what the metadata means
 * is the composing layer's.
 */
import type { Task } from "../schema/task";

/**
 * How a task ended, as the write that records it describes it.
 *
 * - `completed`: settled with `output`.
 * - `errored`: failed for good, with `error`. Also the claim path settling a
 *   row whose worker died more times than its allowance.
 * - `retried`: failed with attempts left, so the row is `pending` again; the
 *   error is the attempt's.
 * - `cancelled`: cancelled, with the reason when one was given.
 */
export type TaskEnding =
  | { readonly kind: "completed"; readonly output: unknown }
  | { readonly kind: "errored"; readonly error: string }
  | { readonly kind: "retried"; readonly error: string }
  | { readonly kind: "cancelled"; readonly reason?: string };

/**
 * The ending a write records, read off the row before and after it, or
 * `undefined` when the write ends nothing (FIX-1794 P2). The one place an
 * ending is detected; `internal.ts` calls it for every write.
 *
 * - into `completed`, `errored` or `cancelled` from any other status: that
 *   ending, with the row's output, error, or (for a cancel) the reason it
 *   stores as its error;
 * - `in_progress` into `pending`: a failure with attempts left (a lapsed
 *   lease's reclaim writes the row directly and records nothing).
 */
export function endingOf(prev: Task, next: Task): TaskEnding | undefined {
  if (prev.status === next.status) return undefined;
  switch (next.status) {
    case "completed":
      return { kind: "completed", output: next.output };
    case "errored":
      return { kind: "errored", error: next.error ?? "" };
    case "cancelled":
      return next.error !== undefined ? { kind: "cancelled", reason: next.error } : { kind: "cancelled" };
    case "pending":
      return prev.status === "in_progress" ? { kind: "retried", error: next.feedback ?? "" } : undefined;
    default:
      return undefined;
  }
}

/**
 * A ledger's ending recorder: handed the row as the ending write is about to
 * commit it (status, output and error already the ending's) and the ending,
 * returns the row to write. Only the returned row's `metadata` is kept; every
 * other field is the transition's, so a recorder cannot move a status or
 * rewrite a result.
 */
export type TaskEndingRecorder = (row: Task, ending: TaskEnding) => Task;

/**
 * Apply a ledger's recorder to the row an ending write is about to commit:
 * the row as the transition built it, with the recorder's `metadata`.
 *
 * @param recorder The ledger's recorder, or `undefined` for a ledger declared
 *   without one, which writes the row unchanged.
 */
export function applyEndingRecorder<T extends Task>(
  recorder: TaskEndingRecorder | undefined,
  row: T,
  ending: TaskEnding
): T {
  if (recorder === undefined) return row;
  const recorded = recorder(row, ending);
  const metadata = recorded.metadata;
  if (metadata === row.metadata) return row;
  if (metadata === undefined) {
    // The recorder dropped the metadata: the row keeps none.
    const { metadata: _dropped, ...rest } = row;
    return rest as T;
  }
  return { ...row, metadata: { ...metadata } };
}
