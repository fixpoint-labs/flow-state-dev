/**
 * `TaskCollectionRef` — uniform API across both backings (FIX-443 §3.3).
 *
 * The same shape is returned from `getOrCreateTaskCollection` regardless
 * of how the collection is stored (sequencer-state vs resource-collection).
 * Patterns and dispatchers consume `TaskCollectionRef` and never reach for
 * the underlying storage directly.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
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
 * Opt-in guards for the `complete` / `fail` write-backs (FIX-951).
 *
 * Both guards are evaluated **inside** the same atomic write that performs
 * the transition, so there is no window between checking and writing. Both
 * are advisory: when a guard rejects the write, the call is a silent no-op
 * and returns normally. Nothing reports which guard fired.
 *
 * The enumerated failure set is exactly that — a rejected transition and a
 * lost claim. **Everything else still throws**: a missing task, a store
 * failure, CAS exhaustion, an ordinary bug. This is a containment guard for
 * task-state conflicts, not a blanket error suppressor.
 *
 * Omit the options entirely (the default for every direct caller) and both
 * methods behave exactly as before, throwing on an illegal transition.
 *
 * Intended for the substrate's own write-backs — a task board's result
 * recorders, a dispatcher's claim/execute cycle — where the task may have
 * been settled by someone with better information (a coordinator cancelled
 * it, the worker settled it through its own task tools, a lease reclaim
 * re-queued it for another attempt) while the worker was still running.
 */
export interface TaskTransitionOptions {
  /**
   * Record the outcome only if the task's state machine will accept it.
   *
   * Declines when the task is already terminal, **or** when the transition
   * is rejected. Both arms are load-bearing: the state machine treats
   * same-status as allowed, so `cancelled → cancelled` is legal *and*
   * terminal, and without the terminal arm an incidental repeat write would
   * clobber the reason and timestamp an explicit settlement recorded.
   */
  ifAllowed?: boolean;
  /**
   * Record the outcome only if the caller still **owns** the task.
   *
   * Declines unless `task.attempts` equals the attempt the caller claimed
   * under *and* the task is still `in_progress` or `awaiting_review`.
   *
   * The status half is not belt-and-braces. `reclaim()` returns a task to
   * `pending` without advancing `attempts`, so between a reclaim and the
   * next claim a displaced worker matches the counter by construction — and
   * since `blocked` is reachable only from `pending`, a counter-only guard
   * would let a stale worker silently unblock work a coordinator parked.
   */
  expectAttempt?: number;
}

/**
 * `Task` plus a runtime accessor for the items the worker emitted while it
 * held the claim window (FIX-480 §3.1). Returned from `list` / `get` so
 * pattern aggregators (synthesizers, reviewers, replanners) can pick from
 * a worker's natural emissions — messages, sources, tool calls, reasoning
 * — instead of relying solely on `task.output`.
 *
 * Mixed staleness contract:
 *   - Data fields (`status`, `output`, `goal`, ...) are snapshot at the
 *     moment `list` / `get` returned, matching the pre-FIX-480 `Task` read
 *     contract. Holding a handle past a mutation reads stale data fields
 *     — re-call `get(id)` to refresh.
 *   - `items()` is live — re-reads the response item log on every call.
 *     This is intentional so synthesizers running after worker completion
 *     pick up emissions that landed during their own pre-execution.
 *
 * Sync, throw-free. Returns `[]` when the task has not been claimed yet.
 *
 * Window: `[first claimed event ts, terminal event ts]` for this taskId
 * under this collection. Retries do NOT reset the start; all attempts
 * append to the same window. Bookend `task-change` events and
 * `task-board-meta` items are excluded — they are substrate scaffolding,
 * not worker emissions.
 *
 * Mutators (`claim`, `addTask`, ...) still return raw `Task`. The
 * just-claimed task has no items in its window yet, so a handle would be
 * empty by construction; re-fetch via `get(id)` post-completion if a
 * handle is needed.
 */
export type TaskHandle<TInput = unknown, TOutput = unknown> = Task<TInput, TOutput> & {
  items(): readonly OutputItem[];
};

/**
 * Runtime ref onto a TaskCollection. All mutations are CAS-safe and emit a
 * `task-change` component item via the configured `onChange` callback (the
 * `getOrCreateTaskCollection` factory wires this to `ctx.emit.component`).
 *
 * Queries (`get`, `list`, `count`) are synchronous reads of the latest
 * committed view. For the resource backing — whose underlying
 * `ResourceCollectionRef` reads are async — this synchronous view is a
 * mirror of resource refs hydrated once at construction time over the
 * collection. Because resource refs are live getters, reads through the
 * mirror still reflect the latest committed state for every task the
 * mirror knows about.
 *
 * ## Implementing this interface yourself
 *
 * `taskBoard({ collection: (ctx) => ... })` accepts a caller-supplied ref, so
 * this is a real extension point for an external or custom store — not just
 * the shape the two built-in backings happen to return.
 *
 * If you write one, `complete` and `fail` **must** accept and honour the
 * optional `TaskTransitionOptions` third argument. The type system cannot
 * hold you to this: an implementation taking only `(id, output)` structurally
 * satisfies the interface, and JavaScript discards the extra argument in
 * silence. A ref that ignores the options throws on a task someone else
 * already settled, and that throw escapes the task board's per-worker rescue
 * and abandons every sibling task on the board — the exact failure the
 * options exist to contain. See `TaskTransitionOptions` for the two guards,
 * and evaluate both inside your atomic write so the check cannot race the
 * write it guards.
 */
export interface TaskCollectionRef<TInput = unknown, TOutput = unknown> {
  /** Stable identifier — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;

  // creation
  addTask(task: TaskInit<TInput>): Promise<Task<TInput, TOutput>>;
  addTasks(tasks: TaskInit<TInput>[]): Promise<Task<TInput, TOutput>[]>;

  // lifecycle
  claim(workerId: string, options?: ClaimOptions): Promise<Task<TInput, TOutput> | null>;
  /**
   * Mark the task completed with `output`.
   *
   * Throws on an illegal transition. Pass `options` to make the write
   * advisory instead — see `TaskTransitionOptions`.
   */
  complete(id: string, output: TOutput, options?: TaskTransitionOptions): Promise<void>;
  /**
   * Mark the task failed.
   *
   * Throws on an illegal transition. Pass `options` to make the write
   * advisory instead — see `TaskTransitionOptions`. Both branches below
   * honour the guards, so a settled task with retry budget left declines
   * rather than throwing on its way to `pending`.
   *
   * - When the task carries a `maxAttempts` budget that has not yet
   *   been exhausted, this is a *soft* fail: status flips back to
   *   `pending`, the error is captured on `feedback`, and the next
   *   claim increments `attempts` for a fresh attempt. Emits a
   *   `task-change` item with `kind: "retried"`.
   * - Otherwise this is a *hard* fail: status transitions to terminal
   *   `errored` with the error captured on `task.error`.
   */
  fail(id: string, error: string, options?: TaskTransitionOptions): Promise<void>;
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
  get(id: string): TaskHandle<TInput, TOutput> | undefined;
  list(filter?: TaskFilter): TaskHandle<TInput, TOutput>[];
  count(filter?: TaskFilter): number;
}
