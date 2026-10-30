/**
 * A task whose run waits for a user (FIX-2129): its cancel, and the debt the
 * cancel owes that run.
 *
 * The claim gate mirrors the stop on the row (a suspension hold in
 * `Task.questions`, FIX-2133) in the write that drops its lease. Any write
 * that then ends the row (a cancel, a cascade's cancel) owes the parked run
 * its `cancelled` resume, on the board's existing owed-resume mark
 * (`Task.resumeOwed`), in that same write, with the mirror it is owed to kept
 * on the row. Two payers, as for a wait's resume:
 *
 * - **At once**, by the cancelling side: {@link cancelAndResume} writes the cancel
 *   under the stop's own fence (`RequestHost.resumeWait`'s `first`), so an
 *   answer can't land between the cancel and its resume: once the cancel is
 *   written, it wins.
 * - **On the next touch of the board** ({@link payOwedUserResume}, from
 *   `payOwedResumes`): a crash between the cancel and its resume, or a cancel
 *   by any other path, is paid there.
 *
 * Either way the block reads `{ cancelled: true }` and runs to its end, and
 * the row keeps nothing it writes. The resume never goes over HTTP.
 */
import { requireRequestHost, type BlockContext, type ResumeWaitResult } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import { isTerminalStatus } from "../schema/task-status";
import { openHolds, isSuspensionHold, suspensionHoldOf } from "../collection/holds";
import type { CancelOptions, TaskCollectionRef, TaskWriteOutcome } from "../collection/types";

/** Whether `row` owes its parked run a `cancelled` resume: it ended while that run waited for a user. */
export function owesUserResume(row: Pick<Task, "status" | "resumeOwed" | "holds">): boolean {
  return row.resumeOwed === true && suspensionHoldOf(row) !== undefined && isTerminalStatus(row.status);
}

/** Thrown inside the stop's fence when the cancel was declined: nothing is resolved. */
class CancelDeclined extends Error {}

/**
 * Cancel a task, and, when its run waits for a user, end that wait
 * `cancelled`: the one cancel every caller-facing path takes (the
 * `updateTask` tool and action).
 *
 * For a row waiting on a user, the cancel is written under the stop's fence:
 * an answer that arrives meanwhile is told the stop is resolved, and the
 * block resumes `cancelled`. When the stop was resolved first (an answer won
 * the race, or a deadline or a stop), or its request is busy, the cancel is
 * written anyway and its resume stays owed on the row for the board's next
 * touch.
 *
 * @returns The cancel's own outcome, as `collection.cancel` reports it.
 */
export async function cancelAndResume(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  id: string,
  reason?: string,
  options?: CancelOptions
): Promise<TaskWriteOutcome> {
  const row = collection.get(id);
  const resumeWait = ctx.requestHost?.resumeWait;
  // The mirror stays while a later request runs for the task (a notice), with `keptOpenBy` cleared.
  const stop = row === undefined ? undefined : openHolds(row).find(isSuspensionHold);
  if (row === undefined || stop === undefined || resumeWait === undefined) {
    return collection.cancel(id, reason, options);
  }
  let outcome: TaskWriteOutcome | undefined;
  let resumed: ResumeWaitResult | undefined;
  try {
    resumed = await resumeWait({
      suspension: { requestId: stop.source.requestId, suspensionId: stop.source.suspensionId },
      outcome: { cancelled: true },
      taskCancelled: true,
      first: async () => {
        outcome = await collection.cancel(id, reason, options);
        if (outcome.outcome !== "recorded") throw new CancelDeclined();
      }
    });
  } catch (error) {
    if (!(error instanceof CancelDeclined)) throw error;
  }
  // Refused before the fence ran the write: the cancel is written now, its
  // resume owed on the row.
  if (outcome === undefined) outcome = await collection.cancel(id, reason, options);
  // The mark is the row's alone to clear only when no wait on the row is owed its ending too.
  const waitedOn = row.wait != null && row.wait.lapsed !== true;
  if (!waitedOn && (resumed?.ok === true || resumed?.refused === "already-resolved")) await clearOwed(collection, id);
  return outcome;
}

/**
 * Pay the `cancelled` resume an ended row owes its parked run (a board
 * touch's half of the debt). `true` when nothing more is owed: the resume
 * started, the stop was resolved otherwise first, or it can never be reached
 * (another principal's, or gone). `false` while it is retryable (`busy`), or
 * on a host without durable execution.
 */
export async function payOwedUserResume(ctx: BlockContext, row: Task): Promise<boolean> {
  const stop = suspensionHoldOf(row);
  const resumeWait = requireRequestHost(ctx).resumeWait;
  if (stop === undefined || resumeWait === undefined) return false;
  const result = await resumeWait({
    suspension: { requestId: stop.source.requestId, suspensionId: stop.source.suspensionId },
    outcome: { cancelled: true },
    taskCancelled: true
  });
  if (result.ok || result.refused === "already-resolved") return true;
  if (result.refused === "gate-not-found") {
    console.warn(`[orchestration] task "${row.id}": the stop it waited on can't be reached from here (${result.detail}); its resume is dropped`);
    return true;
  }
  return false;
}

/** Clear the row's owed resume once its cancel's resume is paid; the next touch clears one this misses. */
async function clearOwed(collection: TaskCollectionRef, id: string): Promise<void> {
  try {
    await collection.clearResumeOwed?.(id);
  } catch (error) {
    console.warn(`[orchestration] task "${id}": cancelled and resumed, but its owed mark was left for the next touch: ${(error as Error).message}`);
  }
}
