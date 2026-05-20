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
import type { TaskCollectionRef } from "@flow-state-dev/tasks";
import { hasClaimableTask, inFlightCount } from "./shared";

/**
 * Wake-up predicate for the worker idle-wait. Semantics depend on
 * `onIdle`:
 *
 * - `"complete"`: wake when the collection has at least one claimable
 *   task (a worker should re-attempt `claim`) OR has fully drained
 *   (the worker should wake up, observe the drain, and exit via
 *   `checkBoard`). Stays asleep while the only remaining work is
 *   `in_progress` on a sibling or parked in `awaiting_review`.
 *
 * - `"wait"`: wake only when the collection has a claimable task or
 *   the caller-supplied `shouldExit` predicate says to terminate.
 *   A fully-drained `wait`-mode board must NOT wake on drained-ness
 *   alone, or the worker would busy-spin until `shouldExit` flips.
 *
 * Reads collection state directly; the items array is ignored. Cheap
 * on every fan-out — at most a couple of count/list reads.
 */
export function whenBoardClaimable(
  collection: TaskCollectionRef,
  options: {
    onIdle: "wait" | "complete";
    shouldExit?: (collection: TaskCollectionRef) => boolean;
  }
): (items: readonly OutputItem[]) => boolean {
  return () => {
    if (hasClaimableTask(collection)) return true;
    if (options.onIdle === "complete") {
      return inFlightCount(collection) === 0;
    }
    return options.shouldExit?.(collection) === true;
  };
}
