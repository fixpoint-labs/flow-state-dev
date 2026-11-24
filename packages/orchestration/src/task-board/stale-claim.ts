// FIX-2847: moved out of task-entry.ts, so the check at a request's end can share it.
/**
 * A dispatch's claim that is no longer the row's: the error the start gate
 * throws for it, and the takeover of a row whose lease lapsed before anything
 * reclaimed it. Shared by the start gate (`task-entry.ts`) and the claim
 * gate's check at a request's end (`task-request.ts`), which takes a row back
 * to mirror a stop for a person when only its lease lapsed.
 */
import { ticketForClaim } from "../tasks/claim-ticket";
import { committedLeaseSpan, type Task, type TaskCollectionRef, type TaskWriteOutcome } from "../tasks";

/**
 * Thrown by the start gate when the claim this dispatch names is no longer the
 * row's current claim.
 *
 * Superseded, expired and re-routed all land here rather than each getting a
 * name of its own: what this dispatch must do about any of them is the same —
 * stop, write nothing, leave the row to be recovered. A named error rather
 * than a silent return: a request that stops because its claim was superseded
 * is a *correct* outcome, but one that stops with no trace is
 * indistinguishable from one that never ran.
 */
export class StaleTaskClaimError extends Error {
  readonly code = "stale-task-claim";

  constructor(
    readonly taskId: string,
    detail: string
  ) {
    super(`[task-board] task dispatch for "${taskId}" is stale: ${detail}`);
    this.name = "StaleTaskClaimError";
  }
}

/**
 * Take a lapsed row back for the dispatch that was handed it, and
 * return it as the renewal committed it.
 *
 * The gate's read has already shown that nothing has reclaimed this row. What
 * it cannot show is that nothing *will*, between that read and the worker's
 * first side effect — so the answer is a write rather than a second read: the
 * substrate's own ownership guards run inside the renewal, and whichever of
 * this dispatch and a racing drain commits first is the one that holds the row.
 *
 * @throws {StaleTaskClaimError} when the renewal is declined — a reclaim
 *   genuinely won — and when the row or the collection cannot say what lease
 *   this dispatch would be taking back. All three keep the `stale-task-claim`
 *   code, because what the dispatch must do about them is the same: stop, and
 *   write nothing.
 */
export async function adoptLapsedLease(
  board: TaskCollectionRef,
  task: Task
): Promise<Task> {
  // The duration the CLAIM committed to, read through the substrate rather
  // than restated here. Not what is left of it (nothing is) and not a fresh
  // default: the renewal driver derives its cadence from the same function, so
  // a takeover that wrote any other span would change the cadence of a claim it
  // did not make.
  const span = committedLeaseSpan(task);
  if (span === undefined || span <= 0) {
    // Reachable on a row claimed before the duration was stored, where the
    // fallback subtraction has since been overtaken by an ordinary field
    // mutation, and on a hand-written collection. `undefined` is not reachable
    // at all — the lapse that got us here required a deadline.
    //
    // Refused rather than guessed at: taking the row back for a duration
    // nothing committed to would either install a deadline already in the past
    // — the very next ticket-fenced write refused, the work run unrecordable —
    // or invent a lease this board never chose.
    throw new StaleTaskClaimError(
      task.id,
      "its lease ran out before this dispatch started, and the task carries no lease " +
        "duration this dispatch could take it back for"
    );
  }

  // Typed as possibly absent on purpose. A `TaskCollectionRef` written by hand
  // is a supported extension point, and one whose `renewLease` resolves to
  // nothing gives no verdict — the substrate does not invent one. Reading
  // `.outcome` off that would throw a `TypeError` where this dispatch is
  // entitled to the ordinary refusal, so the missing verdict is its own arm: a
  // ref that answers nothing has not told us the row is ours.
  const outcome: TaskWriteOutcome | undefined = await board.renewLease(
    task.id,
    board.now() + span,
    {
      claim: ticketForClaim(board.collectionId, task, board.partition),
      adoptLapsedLease: true,
    }
  );
  if (outcome === undefined) {
    throw new StaleTaskClaimError(
      task.id,
      `its lease ran out before this dispatch started and this board's collection reported ` +
        `no verdict for the renewal, so nothing says the task is still this dispatch's to run`
    );
  }
  if (outcome.outcome === "declined") {
    throw new StaleTaskClaimError(
      task.id,
      `its lease ran out before this dispatch started and the task was taken back ` +
        `(${outcome.reason}), so the successor owns it and any work done here could ` +
        `not be recorded`
    );
  }

  // Read the row the renewal committed, so the driver started below phases its
  // first tick against the lease this dispatch now holds rather than the one it
  // arrived to find expired.
  const adopted = board.get(task.id) as Task | undefined;
  if (adopted === undefined) {
    // The ledger recorded a write and then denied the row exists. Falling back
    // to the pre-renewal row is the one thing this cannot do: it would run the
    // worker while asserting a lapsed lease, which is the failure the whole
    // takeover exists to close, and it would do it silently. Not a
    // `StaleTaskClaimError` either — nothing here says the claim was
    // superseded, and a caller branching on that code would draw the wrong
    // conclusion from a store that contradicted itself.
    throw new Error(
      `[task-board] ledger "${board.collectionId}" recorded the lease renewal for task ` +
        `"${task.id}" and then reported no such task. The claim cannot be re-minted from a ` +
        `task the collection denies holding.`
    );
  }
  return adopted;
}
