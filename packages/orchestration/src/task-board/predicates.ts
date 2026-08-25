/**
 * Predicate factories for the task-board worker idle-wait (FIX-621).
 *
 * The worker's `.waitForCondition(predicate, { timeoutMs })` step
 * suspends until the predicate returns true on an item event (or the
 * timeout trips). These predicates derive their truth from collection
 * state rather than parsing the items array — the item stream is used
 * only as a wake signal (every `task-change` and `resource_change`
 * event fans out an item, which re-evaluates the predicate).
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { TaskCollectionRef } from "../tasks";
import { boardQuiescence } from "./quiescence";
import { hasClaimableTask, type RunsElsewhere } from "./shared";

/**
 * Wake-up predicate for the worker idle-wait. Semantics depend on
 * `onIdle`:
 *
 * - `"complete"`: wake when the collection has at least one claimable
 *   task (a worker should re-attempt `claim`) OR has fully drained
 *   (the worker should wake up, observe the drain, and exit via
 *   `checkBoard`). Stays asleep while the only remaining work is
 *   `in_progress` on a sibling — or parked in `awaiting_review`, unless
 *   the board declared `onReview: "exit"`, in which case a parked row
 *   is excused from the counts and the board reads as drained.
 *
 * - `"complete-or-blocked"`: same as `"complete"` plus wake when no
 *   active worker is in `in_progress`/`awaiting_review` — if there's
 *   no claimable pending in that snapshot either, `checkBoard` exits
 *   with reason `blocked`. The extra wake-up means a dep-blocked board
 *   no longer requires a timeout to notice it can't progress.
 *
 * - `"wait"`: wake only when the collection has a claimable task or
 *   the caller-supplied `shouldExit` predicate says to terminate.
 *   A fully-drained `wait`-mode board must NOT wake on drained-ness
 *   alone, or the worker would busy-spin until `shouldExit` flips.
 *
 * Reads collection state directly; the items array is ignored. Cheap
 * on every fan-out — at most a couple of count/list reads.
 *
 * Every mode above reduces to the same two disjuncts, so the terminal
 * half defers to `boardQuiescence` — the single definition of the exit
 * question the exit check also reads (FIX-990).
 *
 * `hasClaimableTask` is NOT redundant with that verdict and must not be
 * folded into it. A board holding newly claimable work is `continue` by
 * design (the drain should not end), so a wake test written as the verdict
 * alone would leave a worker asleep on claimable work until its timeout —
 * exactly the promptness defect this issue set out to fix.
 *
 * A board running detached workers passes `runsElsewhere` (FIX-982), and it
 * reaches the verdict half only. The claimable disjunct needs no adjustment for
 * it: `hasClaimableTask` judges rows by the substrate's lease, and a row a
 * Workstream holds has a live lease renewed from the child, so it is already
 * not claimable here. Once that lease does lapse the row is genuinely
 * recoverable and waking on it is correct.
 *
 * A board in park-exit mode passes `excuseParked` (FIX-1234) the same way, and
 * that it reaches this predicate at all is the point: the wake test and the
 * exit check have to agree, or a worker already asleep when the board becomes
 * exit-eligible sits there until its timeout and the exit is late rather than
 * absent — the shape of defect a passing test would miss (BP-035). The
 * claimable disjunct needs no adjustment here either: an `awaiting_review` row
 * is not in the status set `hasClaimableTask` scans.
 */
export function whenBoardClaimable(
  collection: TaskCollectionRef,
  options: {
    onIdle: "wait" | "complete" | "complete-or-blocked";
    shouldExit?: (collection: TaskCollectionRef) => boolean;
    /**
     * Rows a Workstream is running (FIX-982). Forwarded verbatim to
     * `boardQuiescence`; this predicate adds no reading of its own, so the
     * wake test and the exit check keep answering out of one definition.
     */
    runsElsewhere?: RunsElsewhere;
    /**
     * The board declared `onReview: "exit"` (FIX-1234). Forwarded verbatim on
     * the same terms as `runsElsewhere`, and by the same board that hands it
     * to the exit check.
     */
    excuseParked?: boolean;
  }
): (items: readonly OutputItem[]) => boolean {
  return () =>
    hasClaimableTask(collection) ||
    boardQuiescence(collection, options) !== "continue";
}
