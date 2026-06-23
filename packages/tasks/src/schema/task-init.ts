/**
 * Task creation and filter helpers.
 *
 * `TaskInit` is the input shape accepted by `addTask`. Every field except
 * `goal` is optional — sensible defaults are stamped in by the
 * collection (`status: 'pending'`, `attempts: 0`, timestamps, etc).
 *
 * `TaskFilter` is the predicate shape accepted by `list` / `count`.
 * Filters are AND'd; an unset field is unconstrained.
 */
import type { Task, TaskStatus } from "./task";

/** Caller-supplied fields when creating a task. `id` is auto-generated when omitted. */
export type TaskInit<TInput = unknown> = {
  id?: string;
  goal: string;
  /** Concise label, distinct from `goal`. Surfaced as the plan-UI row label. */
  title?: string;
  /** Readable per-task support text handed to the worker. See `Task.context`. */
  context?: string;
  status?: TaskStatus;
  assignee?: string;
  deps?: string[];
  priority?: number;
  /**
   * Optional retry budget. When set and `attempts < maxAttempts`,
   * `collection.fail(id, ...)` re-pends the task (with the error
   * captured as `feedback`) instead of transitioning to terminal
   * `errored`. Unset is single-attempt — `fail` goes terminal.
   */
  maxAttempts?: number;
  input?: TInput;
  labels?: string[];
  metadata?: Record<string, unknown>;
};

/**
 * Filter predicate used by `list` / `count`. All conditions are AND'd.
 * Pass `{ status: ['pending', 'in_progress'] }` to match either status.
 */
export type TaskFilter = {
  status?: TaskStatus | TaskStatus[];
  assignee?: string;
  hasLabel?: string;
  /** Match tasks that carry every label in this list. */
  hasAllLabels?: string[];
};

/** Returns true when `task` matches every set field on `filter`. */
export function matchesFilter(task: Task, filter?: TaskFilter): boolean {
  if (filter === undefined) return true;

  if (filter.status !== undefined) {
    const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!allowed.includes(task.status)) return false;
  }

  if (filter.assignee !== undefined && task.assignee !== filter.assignee) {
    return false;
  }

  const labels = task.labels ?? [];

  if (filter.hasLabel !== undefined && !labels.includes(filter.hasLabel)) {
    return false;
  }

  if (filter.hasAllLabels !== undefined) {
    for (const label of filter.hasAllLabels) {
      if (!labels.includes(label)) return false;
    }
  }

  return true;
}
