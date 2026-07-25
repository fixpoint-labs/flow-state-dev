/**
 * Task-creation caps (FIX-931) — the two bounds a collection enforces on
 * insertion, plus the typed breach every caller must reckon with.
 *
 * Three bounds sit at three scopes on a board. `concurrency` (the task-board
 * pattern's existing knob) bounds how many tasks run *at once*. The two here
 * bound creation:
 *
 * - `maxEnqueuedTasks` — how many tasks may be *added* while others are still
 *   waiting in `pending`. Checked at creation against the resulting `pending`
 *   count, so it refreshes as tasks drain: a task leaving `pending` frees a slot
 *   for a later `addTask`. It bounds a single up-front fan-out burst.
 * - `maxTotalTasks` — the board's lifetime size: the count of *all* tasks in the
 *   ledger, terminal ones included. Never refunded on drain, so it is the
 *   backstop that catches a drain-then-re-enqueue runaway.
 *
 * Roughly *in-flight ⊆ enqueued ⊆ total*, but only **at creation time**. Tasks
 * also re-enter `pending` through the lifecycle (a retry under `maxAttempts`, an
 * `unblock`, a `resumeFromReview`, a reclaimed lease), and those paths are
 * deliberately **not** capped — so `pending` can transiently exceed
 * `maxEnqueuedTasks`. The hard runaway bound is `maxTotalTasks`.
 *
 * Caps are a property of the COLLECTION, not the board: they are applied where a
 * collection is constructed. A board handed a collection it did not build
 * applies none.
 */

/** Which bound a {@link TaskCapExceededError} reports. */
export type TaskCapKind = "total" | "enqueued";

/**
 * A task creation was refused because it would cross one of the collection's
 * caps. Thrown from `addTask`/`addTasks` after the CAS write no-ops, so nothing
 * is inserted. The delegation `addTask` tool catches this and returns a soft
 * error; internal batch callers (seed, replan) let it propagate.
 */
export class TaskCapExceededError extends Error {
  /** Which bound was crossed. */
  readonly cap: TaskCapKind;
  /** The configured limit for that bound. */
  readonly limit: number;
  /** The count the insertion would have produced. */
  readonly attempted: number;

  constructor(options: { cap: TaskCapKind; limit: number; attempted: number; collectionId: string }) {
    super(
      options.cap === "enqueued"
        ? `[tasks] collection "${options.collectionId}" allows at most ${options.limit} enqueued ` +
            `task(s) at creation time (this would make ${options.attempted} pending) — drain the ` +
            `board to free enqueue slots, then add more`
        : `[tasks] collection "${options.collectionId}" allows at most ${options.limit} task(s) ` +
            `in total (this would make ${options.attempted}) — the lifetime ceiling counts every ` +
            `task ever created, including completed ones, and is never refunded by draining`,
    );
    this.name = "TaskCapExceededError";
    this.cap = options.cap;
    this.limit = options.limit;
    this.attempted = options.attempted;
  }
}

/**
 * The two creation caps, as accepted by every construction point. A finite
 * positive integer sets the bound; `null` means explicitly unbounded on that
 * axis; omitting the option leaves it to whatever default the construction point
 * applies (which is why `null` exists — omission is not an off switch).
 */
export interface TaskCapOptions {
  /** Lifetime task count, terminal tasks included. `null` = unbounded. */
  maxTotalTasks?: number | null;
  /** Enqueued-at-creation `pending` count. `null` = unbounded. */
  maxEnqueuedTasks?: number | null;
}

/** Default lifetime ceiling applied where a board/library constructs a collection. */
export const DEFAULT_MAX_TOTAL_TASKS = 500;

/** Default enqueue-burst ceiling applied where a board/library constructs a collection. */
export const DEFAULT_MAX_ENQUEUED_TASKS = 100;

function assertCapValue(label: string, name: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${label} ${name} must be a positive integer, or null for explicitly unbounded (got ${value})`,
    );
  }
}

/**
 * Reject a nonsensical cap configuration at construction, mirroring the
 * `concurrency`/`maxIterations` throws. `NaN`/`Infinity`/`0`/negative/fractional
 * are rejected rather than silently disabling the guard, and an enqueue bound
 * above the lifetime ceiling is meaningless so it is rejected too (not clamped).
 *
 * @param label Prefix identifying the construction site in the error message.
 */
export function validateTaskCaps(label: string, caps: TaskCapOptions): void {
  assertCapValue(label, "maxTotalTasks", caps.maxTotalTasks);
  assertCapValue(label, "maxEnqueuedTasks", caps.maxEnqueuedTasks);
  if (
    typeof caps.maxTotalTasks === "number" &&
    typeof caps.maxEnqueuedTasks === "number" &&
    caps.maxEnqueuedTasks > caps.maxTotalTasks
  ) {
    throw new Error(
      `${label} maxEnqueuedTasks (${caps.maxEnqueuedTasks}) must be <= maxTotalTasks ` +
        `(${caps.maxTotalTasks}) — an enqueue bound above the lifetime ceiling can never bind`,
    );
  }
}
