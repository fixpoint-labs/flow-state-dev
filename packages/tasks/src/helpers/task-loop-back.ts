/**
 * `taskLoopBack` — termination predicate helper for sequencer-driven
 * task loops (FIX-443 §7).
 *
 * Loop shapes are sequencer compositions, not codified primitives. This
 * helper packages the canonical "drain until all tasks settled" exit
 * condition so patterns don't reinvent it. Returned shape integrates
 * with `sequencer.loopBack({ when, maxIterations })`.
 *
 * Default termination: stop when no `pending` and no `in_progress`
 * tasks remain. `awaiting_review` tasks count as in-flight (the loop
 * waits, doesn't terminate) per FIX-443 §10.1 — the substrate refuses
 * to exit while a human review is outstanding.
 */
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";

export interface TaskLoopBackOptions {
  /**
   * Optional override for the termination check. Receives the latest
   * task list and returns `true` to continue, `false` to exit. The
   * default counts `pending`, `in_progress`, and `awaiting_review`
   * tasks as in-flight.
   */
  until?: (tasks: ReadonlyArray<Task>) => boolean;
  /** Hard cap on iterations. Wires through to `sequencer.loopBack({ maxIterations })`. */
  maxIterations?: number;
}

export interface TaskLoopBackHandle {
  /**
   * Predicate to wire into `sequencer.loopBack({ when })`. Returns
   * `true` while the loop should continue; `false` to terminate.
   */
  shouldContinue: (collection: TaskCollectionRef) => boolean;
  /** Forwarded `maxIterations` from options (defaults to 10_000). */
  maxIterations: number;
}

export const DEFAULT_TASK_LOOP_MAX_ITERATIONS = 10_000;

/** Default termination predicate — see module doc. */
export function defaultTaskLoopUntil(tasks: ReadonlyArray<Task>): boolean {
  for (const task of tasks) {
    if (
      task.status === "pending" ||
      task.status === "in_progress" ||
      task.status === "awaiting_review"
    ) {
      return true;
    }
  }
  return false;
}

export function taskLoopBack(options: TaskLoopBackOptions = {}): TaskLoopBackHandle {
  const until = options.until ?? defaultTaskLoopUntil;
  return {
    shouldContinue: (collection) => until(collection.list()),
    maxIterations: options.maxIterations ?? DEFAULT_TASK_LOOP_MAX_ITERATIONS,
  };
}
