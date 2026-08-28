/**
 * Task status enum + state-machine validators.
 *
 * The status set comes from FIX-443 §2. Transitions are enforced by
 * `assertTransitionAllowed` so callers cannot drop a `completed` task
 * back into `in_progress`, etc. The substrate uses these helpers from
 * the lifecycle methods on TaskCollectionRef so both backings share
 * the same rules.
 */
import { z } from "zod";

export const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "blocked",
  "parked",
  "completed",
  "errored",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * The member `parked` replaced (FIX-1245). Rows persisted before that change
 * still carry it, so it stays readable — as a value on the way in, never one a
 * caller may write.
 */
const LEGACY_PARKED_STATUS = "awaiting_review";

/**
 * The status as it is read back off a **persisted** row: `taskStatusSchema`,
 * plus the legacy member mapped forward.
 *
 * This is not politeness about a name. Persisted resource state is parsed on
 * every read, and a value that fails its schema is never surfaced — the engine
 * substitutes the resource's default (`normalizeResourceState`). An enum that
 * simply dropped the old member would therefore not mislabel a task written
 * before the rename; it would silently reset the whole collection instance.
 *
 * The mapping is a **fixed point**, which is what makes it safe to use on a
 * persisted schema at all: `assertStableResourceState` re-parses any value a
 * schema rewrote and rejects the write if the second parse moves it again.
 * Parsing `parked` yields `parked`, so the second parse is a no-op.
 *
 * Use this wherever a stored row is decoded. Use {@link taskStatusSchema} for
 * everything a caller writes or a type is derived from.
 */
export const persistedTaskStatusSchema = z.preprocess(
  (value) => (value === LEGACY_PARKED_STATUS ? "parked" : value),
  taskStatusSchema
);

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "errored", "cancelled"]);

/** True when the status is terminal (no further transitions allowed). */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
  pending: ["in_progress", "blocked", "cancelled"],
  in_progress: ["completed", "errored", "parked", "pending", "cancelled"],
  blocked: ["pending", "cancelled"],
  parked: ["pending", "completed", "cancelled", "errored"],
  completed: [],
  errored: [],
  cancelled: [],
};

/**
 * Returns the set of statuses reachable from `from` in a single transition.
 * Terminal statuses return an empty array.
 */
export function allowedTransitionsFrom(from: TaskStatus): ReadonlyArray<TaskStatus> {
  return ALLOWED_TRANSITIONS[from];
}

/** True when `from → to` is permitted by the state machine. Same-status is allowed (idempotent updates). */
export function isTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * A lifecycle method refused a status change the state machine does not permit.
 * Thrown by {@link assertTransitionAllowed} from inside the collection's CAS
 * write, so nothing is committed.
 *
 * Carries the three facts a caller needs to react without re-parsing the
 * message. The delegation `taskTools` boundary catches this by type and returns
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
