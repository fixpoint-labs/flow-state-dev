/**
 * `TaskDispatcher` interface (FIX-443 §4).
 *
 * A dispatcher's `claim` selects and commits as one call: it scans the
 * collection for an eligible task, then opens a conditional write that
 * **re-checks eligibility against refreshed state** before flipping the
 * task to `in_progress`. The scan itself is outside that write, so the
 * re-check is what decides a race — the scan can be stale, and a loser
 * resolves to `null` rather than to an error or a second holder.
 *
 * That is a bound on concurrent *holders*, not exactly-once dispatch: a
 * lease reclaim deliberately re-dispatches an abandoned task, and the
 * bound is scoped to one process on a filesystem-backed store.
 *
 * All standard dispatchers in this directory are thin wrappers around
 * `collection.claim(workerId, { eligibility, order })` — the substrate
 * supplies the conditional write and the per-task lease stamping; each
 * dispatcher only chooses the `eligibility` predicate and `order`
 * comparator. Note that a supplied `eligibility` **replaces** the
 * substrate's default (pending + deps satisfied) rather than narrowing
 * it, and it is the predicate the re-check consults — so one that omits
 * the readiness condition removes the very test that decides the race.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";

export interface TaskDispatcher {
  /**
   * Atomically pick and claim the next eligible task. Returns `null`
   * when nothing is ready to dispatch right now (loop should exit or
   * back off).
   */
  claim(
    collection: TaskCollectionRef,
    workerId: string,
    ctx: BlockContext
  ): Promise<Task | null>;
}
