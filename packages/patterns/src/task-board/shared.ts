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
  priorityDispatcher,
  topologicalDispatcher,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
} from "@flow-state-dev/tasks";

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

/** Sleep for `ms` milliseconds. Used for idle-poll backoff in the worker loop. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
