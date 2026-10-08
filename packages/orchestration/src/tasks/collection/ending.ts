/**
 * A durable ledger's ending recorder: what a task's ending is, and the one
 * function every write that records one hands it to (FIX-1794 P2).
 *
 * A composing layer sometimes owes someone something because a task ended:
 * the conversation that filed it is to be told, a parked caller is to be
 * resumed. Recording that debt in a second write after the ending leaves a
 * window where the ending is stored and the debt is not, and a crash in it
 * loses the debt for good. So a ledger declared with `recordEnding` hands every
 * ending write's row to it, inside the same atomic write, and keeps the
 * `metadata` it returns. The ending and the debt land together or not at all.
 *
 * Every producer of an ending goes through it, because they all write through
 * the ledger: a worker settling the task it holds (a board's recorders, a task
 * entry's gate), a board refusing a hand-off, the claim path settling a row
 * whose worker died too often, and a cancel.
 *
 * The recorder runs inside the write and may run more than once (a version
 * conflict re-runs the write against fresher state), so it must be a pure
 * function of what it is handed.
 *
 * Orchestration knows no conversation, notice or worker: what the metadata
 * means is the composing layer's.
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
 * - `parked`: waiting on someone, with the note it was parked with as
 *   `question`. `quiet` is true for a park that asks nobody anything: one made
 *   for a person's turn (`forTurn`), or one its holder made for its own reasons
 *   (`awaitReview(..., { quiet: true })`).
 * - `cancelled`: cancelled, with the reason when one was given.
 */
export type TaskEnding =
  | { readonly kind: "completed"; readonly output: unknown }
  | { readonly kind: "errored"; readonly error: string }
  | { readonly kind: "retried"; readonly error: string }
  | { readonly kind: "parked"; readonly question?: string; readonly quiet: boolean }
  | { readonly kind: "cancelled"; readonly reason?: string };

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
  return metadata === undefined ? row : { ...row, metadata: { ...metadata } };
}
