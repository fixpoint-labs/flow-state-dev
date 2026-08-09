/**
 * Shared helpers for the Task Board pattern.
 *
 * Centralizes dispatcher resolution, ready-task filtering, and the
 * "any-work-still-in-flight" predicate. These read-only checks are
 * non-atomic — used for selection previews and termination decisions
 * where a stale snapshot is acceptable. CAS-correct operations go
 * through `collection.claim` on the substrate.
 */
import {
  fifoDispatcher,
  isClaimable,
  priorityDispatcher,
  topologicalDispatcher,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
} from "../tasks";

/**
 * Accepted shapes for the Task Board's `dispatcher` config: either a
 * `TaskDispatcher` instance, or a string naming one of the substrate's
 * standard dispatchers.
 */
export type TaskBoardDispatcherInput =
  | TaskDispatcher
  | "fifo"
  | "topological"
  | "priority";

/** Resolve a `TaskBoardDispatcherInput` to a concrete dispatcher. */
export function resolveDispatcher(
  input: TaskBoardDispatcherInput
): TaskDispatcher {
  if (typeof input !== "string") return input;
  switch (input) {
    case "fifo":
      return fifoDispatcher;
    case "topological":
      return topologicalDispatcher;
    case "priority":
      return priorityDispatcher;
    default: {
      const _exhaustive: never = input;
      throw new Error(
        `[task-board] unknown dispatcher name "${String(_exhaustive)}"`
      );
    }
  }
}

/**
 * True when a `pending` task's deps are all `completed`. Mirrors the
 * substrate's default eligibility but reads through the collection's
 * `get` so dep status reflects the latest committed view.
 */
export function depsSatisfied(
  task: Task,
  collection: TaskCollectionRef
): boolean {
  if (task.deps === undefined || task.deps.length === 0) return true;
  for (const depId of task.deps) {
    const dep = collection.get(depId);
    if (dep === undefined || dep.status !== "completed") return false;
  }
  return true;
}

/**
 * Count tasks the loop must wait on. `pending`, `in_progress`, and
 * `awaiting_review` are all in-flight — `awaiting_review` per FIX-443
 * §10.1, the others by definition. Terminal statuses don't count.
 */
export function inFlightCount(collection: TaskCollectionRef): number {
  return collection.count({
    status: ["pending", "in_progress", "awaiting_review"],
  });
}

/**
 * Read-only probe: does the collection currently hold at least one task the
 * claim path would look at? Used by the worker idle-wait predicate to decide
 * whether a sleeping worker should wake up and re-attempt `claim`. Non-atomic
 * by design — a sibling worker may win the race; the predicate's job is only
 * to gate the wake-up, not to guarantee dispatch.
 *
 * Reads the substrate's **shared** `isClaimable` (FIX-1005) rather than a
 * second hand-written copy of it, which is what keeps this from drifting away
 * from what `claim` will actually take. That matters in both directions: a
 * probe narrower than `claim` leaves a board asleep on work it could recover,
 * and a probe wider than `claim` wakes a worker for work it will not take.
 *
 * The list query widens with it — `in_progress` rows are candidates now,
 * because one whose lease has lapsed has no live worker on it.
 *
 * **`now` is a parameter because this probe has no clock of its own**, and
 * reading the wall clock unconditionally would be wrong for a collection built
 * on an injected one: the lease was stamped against the collection's clock, so
 * a probe reading a different clock answers a different question than the claim
 * write does. A board on the default (wall-clock) collection passes nothing.
 */
export function hasClaimableTask(
  collection: TaskCollectionRef,
  now: number = Date.now()
): boolean {
  const candidates = collection.list({ status: ["pending", "in_progress"] });
  const lookup = (id: string): Task | undefined => collection.get(id);
  for (let i = 0; i < candidates.length; i += 1) {
    if (isClaimable(candidates[i], lookup, now)) return true;
  }
  return false;
}

/** Sleep for `ms` milliseconds. Used for idle-poll backoff in the worker loop. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
