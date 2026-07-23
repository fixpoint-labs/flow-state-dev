/**
 * `TaskDispatcher` interface (FIX-443 §4).
 *
 * A dispatcher's `claim` does select+CAS as one operation: it scans the
 * collection for an eligible task and atomically flips the winning task
 * to `in_progress` against the worker's id. This avoids the TOCTOU
 * window that a pure selector would expose between scan and commit.
 *
 * All standard dispatchers in this directory are thin wrappers around
 * `collection.claim(workerId, { eligibility, order })` — the substrate
 * supplies the CAS retry and the per-task lease stamping; each
 * dispatcher only chooses the `eligibility` predicate and `order`
 * comparator.
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
