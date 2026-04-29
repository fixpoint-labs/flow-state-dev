/**
 * Shared helpers used by both TaskCollection backings.
 *
 * Centralizing init/transition logic here keeps the two backings in
 * lockstep on default values, claim eligibility, and the post-mutation
 * task shape that ends up on the emitted `task-change` component item.
 */
import type { Task, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import { matchesFilter } from "../schema/task-init";
import type { ClaimOptions } from "./types";

let idCounter = 0;
function generateTaskId(): string {
  idCounter += 1;
  return `task_${Date.now().toString(36)}_${idCounter}_${Math.random().toString(16).slice(2, 8)}`;
}

/** Build a fresh task from a `TaskInit`, stamping defaults and timestamps. */
export function buildInitialTask<TInput, TOutput>(
  init: TaskInit<TInput>,
  now: number
): Task<TInput, TOutput> {
  return {
    id: init.id ?? generateTaskId(),
    goal: init.goal,
    status: init.status ?? "pending",
    attempts: 0,
    maxAttempts: init.maxAttempts,
    assignee: init.assignee,
    deps: init.deps,
    priority: init.priority,
    input: init.input,
    labels: init.labels,
    metadata: init.metadata,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Decide whether `fail(id, error)` should re-pend (retry path) or
 * transition the task to terminal `errored`. Centralized so both
 * backings agree on the contract.
 *
 * Semantics: when `task.maxAttempts` is set and `task.attempts <
 * task.maxAttempts`, the task has a retry budget remaining and `fail`
 * is treated as a soft fail — status flips to `pending`, the error is
 * captured on `feedback`, and the next claim picks up a fresh attempt.
 * Otherwise the call is a hard fail — terminal `errored`.
 *
 * `attempts` is incremented at claim time (`applyClaimToTask`), so
 * after the first failed attempt `attempts === 1`. With
 * `maxAttempts === 3`, the comparison `1 < 3` permits two more
 * retries before the budget is exhausted on the third failure.
 */
export function shouldRetryOnFail(task: Task): boolean {
  if (task.maxAttempts === undefined) return false;
  return task.attempts < task.maxAttempts;
}

/**
 * True when every dep on `task` is `completed`. Used by both the
 * default collection eligibility predicate and the dispatcher
 * eligibility variants.
 *
 * `lookup` reads the freshest task by id — pass `(id) =>
 * collection.get(id)` for the dispatcher case so dep status reflects
 * the latest committed state, not a scan-time snapshot.
 */
export function depsSatisfied(
  task: Task,
  lookup: (id: string) => Task | undefined
): boolean {
  if (task.deps === undefined || task.deps.length === 0) return true;
  for (const depId of task.deps) {
    const dep = lookup(depId);
    if (dep === undefined || dep.status !== "completed") return false;
  }
  return true;
}

/**
 * True when `task` is ready to be claimed: status is `pending` and
 * deps are satisfied. The substrate's default eligibility wraps this.
 * Skips `awaiting_review` naturally because the status check requires
 * `pending` (FIX-443 §10.1).
 */
export function isReady(
  task: Task,
  lookup: (id: string) => Task | undefined
): boolean {
  if (task.status !== "pending") return false;
  return depsSatisfied(task, lookup);
}

/**
 * Default eligibility predicate against a task lookup. Used by `claim`
 * when no custom `eligibility` is supplied.
 */
export function defaultEligibility(
  lookup: (id: string) => Task | undefined
): (task: Task) => boolean {
  return (task) => isReady(task, lookup);
}

/** Default ordering: ascending `createdAt`, stable on tied timestamps via id. */
export function defaultOrder(a: Task, b: Task): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

/** Default lease duration applied when the dispatcher does not pass one through. */
export const DEFAULT_LEASE_DURATION_MS = 30_000;

/**
 * Apply a `claim` to a task — flip status, stamp lease, increment attempts.
 *
 * Note: `task.assignee` is the worker-registry key (set at task creation by
 * the user), not the runtime worker identity. `claim`'s `workerId` is for
 * trace attribution; the lease itself is `leaseUntil`. So we don't touch
 * `task.assignee` here.
 */
export function applyClaimToTask<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  now: number,
  leaseDurationMs: number
): Task<TInput, TOutput> {
  return {
    ...task,
    status: "in_progress",
    attempts: task.attempts + 1,
    startedAt: task.startedAt ?? now,
    leaseUntil: now + leaseDurationMs,
    updatedAt: now,
  };
}

/**
 * Apply a generic field-level patch + status transition to a task. Does
 * not validate the transition itself — callers run `assertTransitionAllowed`
 * inside the CAS mutator.
 */
export function applyTransition<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  patch: Partial<Task<TInput, TOutput>>,
  now: number
): Task<TInput, TOutput> {
  return {
    ...task,
    ...patch,
    updatedAt: now,
  };
}

/** Filter and clone tasks for query results — keeps consumers from mutating internal state. */
export function listTasks<TInput, TOutput>(
  tasks: ReadonlyArray<Task<TInput, TOutput>>,
  filter?: TaskFilter
): Task<TInput, TOutput>[] {
  return tasks.filter((task) => matchesFilter(task, filter));
}
