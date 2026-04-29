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
  "awaiting_review",
  "completed",
  "errored",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "errored", "cancelled"]);

/** True when the status is terminal (no further transitions allowed). */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
  pending: ["in_progress", "blocked", "cancelled"],
  in_progress: ["completed", "errored", "awaiting_review", "pending", "cancelled"],
  blocked: ["pending", "cancelled"],
  awaiting_review: ["pending", "completed", "cancelled", "errored"],
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
 * Throws if the transition is not allowed. Used by lifecycle methods to
 * surface contract violations early instead of silently writing illegal
 * states.
 */
export function assertTransitionAllowed(from: TaskStatus, to: TaskStatus, taskId: string): void {
  if (!isTransitionAllowed(from, to)) {
    throw new Error(
      `[tasks] illegal status transition for task "${taskId}": ${from} → ${to}`
    );
  }
}
