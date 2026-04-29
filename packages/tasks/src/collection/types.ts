/**
 * `TaskCollectionRef` — uniform API across both backings (FIX-443 §3.3).
 *
 * The same shape is returned from `getOrCreateTaskCollection` regardless
 * of how the collection is stored (sequencer-state vs resource-collection).
 * Patterns and dispatchers consume `TaskCollectionRef` and never reach for
 * the underlying storage directly.
 */
import type { Task } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";

/** Options for `claim` — let the dispatcher narrow eligibility and tweak ordering. */
export interface ClaimOptions {
  /**
   * Per-task predicate. The substrate iterates `pending` candidates in
   * `order`, then CAS-claims the first that passes `eligibility`. Default:
   * accepts every pending task whose `deps` are all `completed`.
   */
  eligibility?: (task: Task) => boolean;
  /**
   * Sort comparator over candidates. Default: ascending `createdAt`.
   */
  order?: (a: Task, b: Task) => number;
  /**
   * Lease duration in ms applied to the claimed task's `leaseUntil`. When
   * unset the substrate picks a sensible default per backing.
   */
  leaseDurationMs?: number;
}

/**
 * Runtime ref onto a TaskCollection. All mutations are CAS-safe and emit a
 * `task-change` component item via the configured `onChange` callback (the
 * `getOrCreateTaskCollection` factory wires this to `ctx.emitComponent`).
 * Queries (`get`, `list`, `count`) are synchronous reads of the latest
 * committed view.
 */
export interface TaskCollectionRef<TInput = unknown, TOutput = unknown> {
  /** Stable identifier — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;

  // creation
  addTask(task: TaskInit<TInput>): Promise<Task<TInput, TOutput>>;
  addTasks(tasks: TaskInit<TInput>[]): Promise<Task<TInput, TOutput>[]>;

  // lifecycle
  claim(workerId: string, options?: ClaimOptions): Promise<Task<TInput, TOutput> | null>;
  complete(id: string, output: TOutput): Promise<void>;
  /**
   * Mark the task failed.
   *
   * - When the task carries a `maxAttempts` budget that has not yet
   *   been exhausted, this is a *soft* fail: status flips back to
   *   `pending`, the error is captured on `feedback`, and the next
   *   claim increments `attempts` for a fresh attempt. Emits a
   *   `task-change` item with `kind: "retried"`.
   * - Otherwise this is a *hard* fail: status transitions to terminal
   *   `errored` with the error captured on `task.error`.
   */
  fail(id: string, error: string): Promise<void>;
  block(id: string, reason?: string): Promise<void>;
  unblock(id: string): Promise<void>;
  awaitReview(id: string, feedback?: string): Promise<void>;
  resumeFromReview(id: string, feedback?: string): Promise<void>;
  cancel(id: string, reason?: string): Promise<void>;
  /**
   * Reset stale leases. Tasks whose `leaseUntil` has passed are returned
   * to `pending`. Returns the number of tasks reclaimed; emits one
   * `task-change(kind: 'resumed', prevStatus: 'in_progress')` per reset
   * — the same kind used by `resumeFromReview` since the lifecycle UI
   * cares only that the task is back to pending.
   */
  reclaim(now?: number): Promise<number>;

  // mutation
  setAssignee(id: string, assignee: string): Promise<void>;
  setPriority(id: string, priority: number): Promise<void>;
  addLabel(id: string, label: string): Promise<void>;
  removeLabel(id: string, label: string): Promise<void>;
  patchMetadata(id: string, patch: Record<string, unknown>): Promise<void>;

  // query
  get(id: string): Task<TInput, TOutput> | undefined;
  list(filter?: TaskFilter): Task<TInput, TOutput>[];
  count(filter?: TaskFilter): number;
}
