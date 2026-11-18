// FIX-443 §2.
/**
 * Task status enum + state-machine validators.
 *
 * Transitions are enforced by
 * `assertTransitionAllowed` so callers cannot drop a `completed` task
 * back into `in_progress`, etc. The substrate uses these helpers from
 * the lifecycle methods on TaskCollectionRef so both backings share
 * the same rules.
 */
import { z } from "zod";

export const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "held",
  "completed",
  "errored",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

const TASK_STATUSES: ReadonlySet<string> = new Set(taskStatusSchema.options);

/** True when `status` is one the state machine knows. */
export function isTaskStatus(status: string): status is TaskStatus {
  return TASK_STATUSES.has(status);
}

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "errored", "cancelled"]);

/** True when the status is terminal (no further transitions allowed). */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// FIX-2080 D1.
/**
 * `held` sits beside `pending`, before any start: a held row
 * starts only once it is released back to `pending`, and may be cancelled.
 * Nothing after a start reaches it.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
  pending: ["in_progress", "held", "cancelled"],
  in_progress: ["completed", "errored", "pending", "cancelled"],
  held: ["pending", "cancelled"],
  completed: [],
  errored: [],
  cancelled: [],
};

/**
 * Returns the set of statuses reachable from `from` in a single transition.
 * Terminal statuses return an empty array.
 */
export function allowedTransitionsFrom(from: TaskStatus): ReadonlyArray<TaskStatus> {
  // A status the table does not know reaches no other status. Indexing
  // straight into the record threw a TypeError inside the CAS. A write
  // against that row is declined `unknown-status` before this runs; the
  // empty array is what a direct call returns instead of throwing.
  return ALLOWED_TRANSITIONS[from] ?? [];
}

/** True when `from → to` is permitted by the state machine. Same-status is allowed (idempotent updates). */
export function isTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return allowedTransitionsFrom(from).includes(to);
}

/**
 * A lifecycle method refused a status change the state machine does not permit.
 * Thrown by {@link assertTransitionAllowed} from inside the collection's CAS
 * write, so nothing is committed.
 *
 * Carries the three facts a caller needs to react without re-parsing the
 * message. The `taskTools` boundary catches this by type and returns
 * a recoverable `{ ok: false, error }` result naming what the model can do
 * instead; **every other caller still gets the throw** — driving a collection
 * directly (a drain's rescue path, user code) is expected to handle or
 * propagate it, which is why this class is exported rather than module-private.
 *
 * The message text is deliberately unchanged from the plain `Error` this
 * replaced: only the type is new.
 */
export class IllegalTaskTransitionError extends Error {
  /** The task whose transition was refused. */
  readonly taskId: string;
  /** The status the task was in when the guard ran. */
  readonly from: TaskStatus;
  /** The status the caller tried to move it to. */
  readonly to: TaskStatus;

  constructor(options: { taskId: string; from: TaskStatus; to: TaskStatus }) {
    super(
      `[tasks] illegal status transition for task "${options.taskId}": ${options.from} → ${options.to}`
    );
    this.name = "IllegalTaskTransitionError";
    this.taskId = options.taskId;
    this.from = options.from;
    this.to = options.to;
  }
}

/**
 * Throws if the transition is not allowed. Used by lifecycle methods to
 * surface contract violations early instead of silently writing illegal
 * states.
 *
 * @throws {IllegalTaskTransitionError} when `from → to` is not permitted.
 */
export function assertTransitionAllowed(from: TaskStatus, to: TaskStatus, taskId: string): void {
  if (!isTransitionAllowed(from, to)) {
    throw new IllegalTaskTransitionError({ taskId, from, to });
  }
}
