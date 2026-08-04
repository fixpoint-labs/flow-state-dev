/**
 * Shared helpers used by both TaskCollection backings.
 *
 * Centralizing init/transition logic here keeps the two backings in
 * lockstep on default values, claim eligibility, and the post-mutation
 * task shape that ends up on the emitted `task-change` component item.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { Task, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import { matchesFilter } from "../schema/task-init";
import { isTerminalStatus, isTransitionAllowed } from "../schema/task-status";
import { extractTaskItems } from "../items/extract-window";
import type {
  ClaimOptions,
  TaskHandle,
  TaskTransitionOptions,
  TaskWriteDeclineReason,
} from "./types";

let idCounter = 0;
function generateTaskId(): string {
  idCounter += 1;
  return `task_${Date.now().toString(36)}_${idCounter}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * Build a `TaskHandle` factory closed over the collection's id and item-log
 * accessor (FIX-480). Both backings call this once at construction.
 *
 * Data fields are snapshot at wrap time (matches the pre-FIX-480 `Task`
 * read contract). `items()` is live — re-reads the item log at call time
 * so synthesizers running after worker completion see the latest window.
 */
export function createTaskHandleWrapper<TInput, TOutput>(
  collectionId: string,
  getItems: (() => readonly OutputItem[]) | undefined,
): (task: Task<TInput, TOutput>) => TaskHandle<TInput, TOutput> {
  return (task) => ({
    ...task,
    items: () => {
      if (getItems === undefined) return [];
      return extractTaskItems(getItems(), collectionId, task.id);
    },
  });
}

/** Build a fresh task from a `TaskInit`, stamping defaults and timestamps. */
export function buildInitialTask<TInput, TOutput>(
  init: TaskInit<TInput>,
  now: number
): Task<TInput, TOutput> {
  return {
    id: init.id ?? generateTaskId(),
    goal: init.goal,
    title: init.title,
    context: init.context,
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
 * The two statuses an in-flight attempt can be said to *hold*.
 *
 * Everything else means the attempt was displaced (reclaimed, re-queued,
 * parked) or the task was settled by someone else.
 *
 * Exported because the retry budget (FIX-948) is scoped to exactly this set, and
 * that reuse is exact rather than coincidental — see {@link routeFailure}.
 */
export const ATTEMPT_OWNED_STATUSES = new Set<TaskStatus>([
  "in_progress",
  "awaiting_review",
]);

/**
 * Read a task's retry ledger with the BP-030 legacy guard applied (FIX-948).
 *
 * One `== null` check on the object rather than one per member, which is the
 * concrete reason the two facts live in one field. Absent means "no counted
 * history" — a task persisted before FIX-948, or one that has never failed.
 * Never let an absent ledger become `undefined` arithmetic in the sum.
 */
export function readRetryLedger(task: Task): { granted: number; deniedByBudget: boolean } {
  const ledger = task.retryLedger;
  if (ledger == null) return { granted: 0, deniedByBudget: false };
  return {
    granted: ledger.granted ?? 0,
    deniedByBudget: ledger.deniedByBudget === true,
  };
}

/**
 * The task's retry ledger with one more grant recorded (FIX-948).
 *
 * Written in the SAME patch that re-pends the task, which is the property the
 * whole bound rests on: the counted fact changes when the retry is *authorized*,
 * not when it is later observed at claim time.
 */
export function grantRetry(task: Task): { granted: number; deniedByBudget: boolean } {
  const ledger = readRetryLedger(task);
  return { granted: ledger.granted + 1, deniedByBudget: ledger.deniedByBudget };
}

/**
 * The task's retry ledger with the budget denial recorded (FIX-948).
 *
 * Written in the same patch that settles the task terminal. This is the marker
 * the board's `terminationReason` reads — it exists precisely so that reason is
 * never inferred from `retries === limit`, which does not establish that
 * anything was refused.
 */
export function denyRetry(task: Task): { granted: number; deniedByBudget: boolean } {
  return { granted: readRetryLedger(task).granted, deniedByBudget: true };
}

/** Sum the authorized-retry grants across a ledger — the board's retry total. */
export function sumGrantedRetries(tasks: Iterable<Task>): number {
  let total = 0;
  for (const task of tasks) total += readRetryLedger(task).granted;
  return total;
}

/** True once any task in the ledger had a retry refused by the budget. */
export function anyRetryDeniedByBudget(tasks: Iterable<Task>): boolean {
  for (const task of tasks) {
    if (readRetryLedger(task).deniedByBudget) return true;
  }
  return false;
}

/**
 * How `fail(id, error)` should route this failure — the one place retry-vs-
 * terminal is decided, widened by FIX-948 to also answer the collection's
 * cumulative retry budget.
 *
 * - `retry` — re-pend. `countsAgainstBudget` says whether this grant is recorded
 *   on the task and therefore consumes the board's allowance.
 * - `terminal` — settle `errored`. `deniedByBudget` distinguishes "the board's
 *   budget refused this retry" from "this task had no retry budget of its own",
 *   which is today's unchanged behaviour.
 */
export type FailRouting =
  | { action: "retry"; countsAgainstBudget: boolean }
  | { action: "terminal"; deniedByBudget: boolean };

/**
 * Decide how a `fail()` routes, given the task, the board's granted-retry total,
 * and the budget in force (FIX-948).
 *
 * **Must be called from inside the atomic write**, against the committed ledger,
 * so `grantedTotal` and the grant this decision authorizes land together. A
 * budget compared against a total read outside the write is a check-after-read
 * race, and the overshoot it admits is exactly what the bound exists to prevent.
 *
 * Two gates, in this order, and the second is a correctness requirement rather
 * than a nicety:
 *
 * 1. **The task's own `maxAttempts` still decides first.** Without one, or with
 *    it exhausted, the failure is terminal exactly as before — the budget can
 *    only ever refuse a retry that would otherwise have happened, and it can
 *    never refuse a first attempt.
 * 2. **The budget applies only to attempt-owned failures.** `errored` is
 *    reachable from `in_progress` and `awaiting_review` and from NEITHER
 *    `pending` nor `blocked`, while this routing is status-blind on the
 *    `maxAttempts` half — so a `fail()` on a pending or blocked task carrying
 *    `maxAttempts` legally re-pends today, and rerouting it to `errored` at the
 *    bound would attempt an illegal transition and THROW instead of settling, on
 *    a reachable path. So both the accounting and the denial are gated on
 *    {@link ATTEMPT_OWNED_STATUSES} — which is precisely the set from which the
 *    reroute is legal, and is also the set for which a *settlement* is
 *    meaningful at all: a task that held no attempt has nothing to settle.
 *    Widening the transition table instead was rejected — permitting
 *    `pending → errored` would let a fresh, never-attempted task be failed
 *    outright, which is a new correctness hole rather than a fix.
 *
 * @param grantedTotal Sum of granted retries across the committed ledger.
 * @param maxTotalRetries The budget in force, or `undefined` for unbounded —
 *   which is what the resource backing passes, since it counts but cannot
 *   enforce.
 */
export function routeFailure(
  task: Task,
  grantedTotal: number,
  maxTotalRetries: number | undefined
): FailRouting {
  if (!shouldRetryOnFail(task)) return { action: "terminal", deniedByBudget: false };
  if (!ATTEMPT_OWNED_STATUSES.has(task.status)) {
    return { action: "retry", countsAgainstBudget: false };
  }
  if (maxTotalRetries === undefined || grantedTotal < maxTotalRetries) {
    return { action: "retry", countsAgainstBudget: true };
  }
  return { action: "terminal", deniedByBudget: true };
}

/**
 * The error recorded on a task settled by the collection's retry budget rather
 * than by its own `maxAttempts` (FIX-948).
 *
 * Names the board's budget explicitly, because the whole point of the bound is
 * that an operator can tell "we stopped retrying because the budget ran out"
 * from "this task ran out of its own attempts". The structured fact a consumer
 * should branch on is `task.retryLedger.deniedByBudget` — this string is for a
 * human reading the failure.
 */
export function retryBudgetExhaustedError(
  error: string,
  limit: number,
  collectionId: string
): string {
  return (
    `${error} — not retried: collection "${collectionId}" has spent its retry budget of ` +
    `${limit} (maxTotalRetries). Raise it, or pass null to opt out.`
  );
}

/**
 * True when `expectAttempt` still owns `task` (FIX-951).
 *
 * Ownership is the counter **and** the status, not the counter alone.
 * `reclaim()` returns a task to `pending` without touching `attempts` — it
 * advances only on the next claim (`applyClaimToTask`) — so in the window
 * between a reclaim and the next claim a displaced worker matches the
 * counter by construction. `attempts` is a claim counter, and only
 * incidentally an ownership token while the task sits in a status an
 * attempt holds.
 */
function attemptOwnsTask(task: Task, expectAttempt: number): boolean {
  return task.attempts === expectAttempt && ATTEMPT_OWNED_STATUSES.has(task.status);
}

/**
 * Decide whether an advisory write-back should decline, and say **why**
 * (FIX-951; reason reporting added by FIX-976).
 *
 * Called from inside each backing's transition wrapper — i.e. inside the
 * atomic write — so the status it reads is authoritative and no caller has
 * to re-derive the state machine from outside the lock. Single-sourced here
 * because the two backings carry separately maintained copies of the
 * wrapper itself, and the *rules* must not drift between them.
 *
 * Returns the reason to no-op the write, or `undefined` to proceed. Which
 * calls decline is **unchanged** from FIX-951 — the return type carries the
 * condition that fired so the wrapper can report it without re-deriving the
 * state machine after the fact.
 *
 * The evaluation order *is* the documented precedence (`terminal` →
 * `disallowed` → `lost-claim`, see `TaskWriteDeclineReason`), which is the
 * order this predicate already evaluated in.
 *
 * `undefined` says nothing about legality: the wrapper still runs
 * `assertTransitionAllowed`, so a caller that passed no guards (or only
 * `expectAttempt`) keeps today's throwing contract.
 *
 * This is the **transition** hook. The assignment terminal guard is a separate
 * patch-hook on the patch helper (FIX-976 / epic constraint A1) and deliberately
 * not a fourth arm here: `setAssignee` never travels this path.
 */
export function transitionDeclineReason(
  task: Task,
  targetStatus: TaskStatus,
  options: TaskTransitionOptions | undefined
): TaskWriteDeclineReason | undefined {
  if (options === undefined) return undefined;
  // Two arms, both load-bearing. `isTransitionAllowed` treats same-status as
  // allowed, so the disallowed arm does not subsume the terminal one:
  // `cancelled → cancelled` is legal *and* terminal, and letting it through
  // would clobber the reason and timestamp of the settlement already recorded.
  if (options.ifAllowed === true) {
    if (isTerminalStatus(task.status)) return "terminal";
    if (!isTransitionAllowed(task.status, targetStatus)) return "disallowed";
  }
  if (options.expectAttempt !== undefined && !attemptOwnsTask(task, options.expectAttempt)) {
    return "lost-claim";
  }
  return undefined;
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
