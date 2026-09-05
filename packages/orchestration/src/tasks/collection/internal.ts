/**
 * Shared helpers used by both TaskCollection backings.
 *
 * Centralizing init/transition logic here keeps the two backings in
 * lockstep on default values, claim eligibility, and the post-mutation
 * task shape that ends up on the emitted `task-change` component item.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { ticketNamesTask } from "../claim-ticket";
import { generateId } from "../generate-id";
import { initialWriteProvenance } from "../write-provenance";
import type { Task, TaskClaimIdentity, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import { matchesFilter } from "../schema/task-init";
import {
  IllegalTaskTransitionError,
  isTerminalStatus,
  isTransitionAllowed,
} from "../schema/task-status";
import { extractTaskItems } from "../items/extract-window";
import type { TaskChangeKind } from "./change-event";
import type {
  ClaimOptions,
  TaskHandle,
  TaskTransitionOptions,
  TaskWriteDeclineReason,
} from "./types";

function generateTaskId(): string {
  return generateId("task");
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

/**
 * Build a fresh task from a `TaskInit`, stamping defaults and timestamps.
 *
 * The convergence point for a task's *initial* write provenance (FIX-989):
 * every add path on both backings builds its task here, so revision 1, the
 * truncation marker, and the incarnation nonce are set once rather than at
 * four call sites.
 *
 * `incarnationId` is minted here rather than folded into
 * `initialWriteProvenance()` because it answers a different question — task
 * *identity* across delete/recreate, not write bookkeeping — but it is
 * stamped at the same site for the same reason: one place, covering all four
 * add paths, so a recreated row can never end up sharing an incarnation with
 * the row it replaced.
 *
 * Minted with `crypto.randomUUID()`, not `generateId` — the nonce is persisted
 * and compared across processes (a resource-backed board on SQLite/Postgres is
 * explicitly multi-process), and `generateId`'s own header says nothing about
 * it compares across machines: its counter is per-process and its random tail
 * is only 24 bits, so two processes can mint the same value. `generateId` stays
 * for task ids themselves — that scheme is pre-existing and changing it would
 * alter an already-persisted id format — but the nonce is new in this PR and
 * has no such compatibility concern.
 */
export function buildInitialTask<TInput, TOutput>(
  init: TaskInit<TInput>,
  now: number
): Task<TInput, TOutput> {
  return {
    ...initialWriteProvenance(),
    incarnationId: crypto.randomUUID(),
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
 * How many times this task's work was abandoned by a dead worker and handed
 * back out (FIX-1005), with the BP-030 legacy guard applied.
 *
 * The `readRetryLedger` posture exactly, and for the same reason: **absent
 * reads as zero**. A row persisted before the upgrade — or one an older
 * writer normalized, which drops a key its schema does not know — gets the
 * full allowance rather than none. That direction is deliberate. Over-recovery
 * is in policy; withholding recovery is the bug this mechanism exists to fix,
 * so a counter that could read as *exhausted* when it is merely missing would
 * strand exactly the rows the mechanism is for.
 */
export function readAbandonments(task: Task): number {
  return task.abandonments ?? 0;
}

/**
 * How many times a task's work may be handed back out after its worker died
 * before the substrate stops recovering it and settles the row `errored`
 * (FIX-1005).
 *
 * Three, because a bad deploy or a cycling node strands a job once or twice.
 * That covers the class while still bounding duplicate side effects at a small
 * constant — and because this is its OWN budget, a job with no `maxAttempts`
 * gets these three rather than the zero a shared budget would leave it.
 */
export const DEFAULT_MAX_ABANDONMENTS = 3;

/**
 * Decide whether `fail(id, error)` should re-pend (retry path) or
 * transition the task to terminal `errored`. Centralized so both
 * backings agree on the contract.
 *
 * Semantics: when `task.maxAttempts` is set and the task's *own* failures have
 * not yet spent it, `fail` is treated as a soft fail — status flips to
 * `pending`, the error is captured on `feedback`, and the next claim picks up
 * a fresh attempt. Otherwise the call is a hard fail — terminal `errored`.
 *
 * `attempts` is incremented at claim time (`applyClaimToTask`), so
 * after the first failed attempt `attempts === 1`. With
 * `maxAttempts === 3`, the comparison `1 < 3` permits two more
 * retries before the budget is exhausted on the third failure.
 *
 * **Abandonments are discounted, and that is what makes the two budgets
 * separate rather than separate-in-name-only (FIX-1005).** Recovering an
 * abandoned row goes through `claim`, which advances `attempts` — so without
 * the discount a crashed machine would silently spend the retries the caller
 * configured for real failures. `attempts - abandonments` is the count of
 * attempts this task actually got to run out of its own budget.
 */
export function shouldRetryOnFail(task: Task): boolean {
  if (task.maxAttempts === undefined) return false;
  return task.attempts - readAbandonments(task) < task.maxAttempts;
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
  "parked",
]);

/**
 * The change kinds that mean "this attempt is reporting its result" (FIX-1234).
 *
 * Named because {@link transitionDeclineReason} refuses exactly these on a row
 * that is parked for review, and the set is not guessable from the target
 * status: a failure with retries left targets `pending`, which is also where a
 * `unpark` lands. The kind separates them; the status cannot.
 */
export const SETTLEMENT_CHANGE_KINDS = new Set<TaskChangeKind>([
  "completed",
  "errored",
  "retried",
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
  /**
   * `limit` is present exactly when `deniedByBudget` is true, so the error
   * message can name the budget without a cast the type system cannot check.
   */
  | { action: "terminal"; deniedByBudget: false }
  | { action: "terminal"; deniedByBudget: true; limit: number };

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
 *    reachable from `in_progress` and `parked` and from NEITHER
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
  grantedTotal: () => number,
  maxTotalRetries: number | undefined
): FailRouting {
  if (!shouldRetryOnFail(task)) return { action: "terminal", deniedByBudget: false };
  if (!ATTEMPT_OWNED_STATUSES.has(task.status)) {
    return { action: "retry", countsAgainstBudget: false };
  }
  // `grantedTotal` is a thunk so the O(tasks) sum is only walked once the two
  // cheap gates above have passed and a budget is actually in force.
  if (maxTotalRetries === undefined || grantedTotal() < maxTotalRetries) {
    return { action: "retry", countsAgainstBudget: true };
  }
  return { action: "terminal", deniedByBudget: true, limit: maxTotalRetries };
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
 * True when the ticket's attempt still owns `task` (FIX-951).
 *
 * Ownership is the counter **and** the status, not the counter alone.
 * `reclaim()` returns a task to `pending` without touching `attempts` — it
 * advances only on the next claim (`applyClaimToTask`) — so in the window
 * between a reclaim and the next claim a displaced worker matches the
 * counter by construction. `attempts` is a claim counter, and only
 * incidentally an ownership token while the task sits in a status an
 * attempt holds.
 *
 * This asks only *"is my attempt still the live one on this task"*. Whether
 * this is even the right task is {@link ticketNamesTask}'s question, asked
 * first — see {@link transitionDeclineReason}.
 */
function attemptOwnsTask(task: Task, attempt: number): boolean {
  return task.attempts === attempt && ATTEMPT_OWNED_STATUSES.has(task.status);
}

/**
 * Refuse a removed option loudly rather than ignoring it (BP-030).
 *
 * `expectAttempt` was replaced by `claim` in FIX-981. TypeScript catches the
 * migration for a typed caller, but an untyped one — plain JS, a `as any`, an
 * options object assembled from config — would otherwise have its guard
 * silently dropped and its write proceed unguarded. Silence is the exact shape
 * of the defect the ticket exists to close, so a leftover key throws.
 *
 * `in` rather than a value check on purpose: `{ expectAttempt: undefined }` is
 * still a caller that thinks it is passing this guard.
 */
function assertNoRemovedGuards(options: TaskTransitionOptions): void {
  if ("expectAttempt" in options) {
    throw new Error(
      `[tasks] "expectAttempt" was removed — pass "claim" instead. A bare attempt ` +
        `number names no task, so it is satisfied by any task on the same attempt. ` +
        `Mint a ticket from the task \`claim()\` returned: ` +
        `\`ticketForClaim(collection.collectionId, claimedTask)\`.`
    );
  }
}

/**
 * Decide whether an advisory write should decline, and say **why**
 * (FIX-951; reason reporting added by FIX-976; target binding by FIX-981).
 *
 * **The one convergence point for the ownership guard.** Called from inside
 * each backing's transition wrapper — i.e. inside the atomic write — so the
 * status it reads is the committed one and no caller has to re-derive the state
 * machine from outside the lock. Single-sourced here because the two backings
 * carry separately maintained copies of the wrapper itself, and the *rules*
 * must not drift between them. Every worker-callable transition on both
 * backings passes through this function; a guard added at a call site instead
 * is a guard the next call site will not have.
 *
 * Returns the reason to no-op the write, or `undefined` to proceed.
 *
 * `undefined` says nothing about legality: the wrapper still runs
 * `assertTransitionAllowed`, so a caller that passed no guards (or only a
 * `claim`) keeps today's throwing contract.
 *
 * ## The evaluation order is the contract
 *
 * It *is* the documented precedence (`terminal` → `not-my-task` → `disallowed`
 * → `lost-claim`, see `TaskWriteDeclineReason`), and the middle two are ordered
 * deliberately rather than incidentally.
 *
 * A decline aborts the write **before** it is attempted, so the conditional
 * write never conflicts, never refreshes, and never re-runs this predicate.
 * "Inside the atomic write" therefore buys freshness against *other writers
 * mid-flight*, not against a basis the caller resolved minutes ago. Two arms
 * are sound under a stale basis anyway — `not-my-task` reads no mutable task
 * state, and terminality is absorbing, so a task observed terminal on any basis
 * is terminal on every later one. `disallowed` is not: a stale `pending` makes
 * an ordinary `in_progress → completed` settlement look illegal. Leaving the
 * ownership arm last would therefore report `disallowed` for one interleaving
 * of a cross-task write and `not-my-task` for another — the same defect refused
 * for a reason that happens to be available, which no caller can act on and no
 * model can correct itself from.
 *
 * The terminal and disallowed arms remain separate for the FIX-951 reason:
 * `isTransitionAllowed` treats same-status as allowed, so `cancelled →
 * cancelled` is legal *and* terminal, and letting it through would clobber the
 * reason and timestamp of the settlement already recorded.
 *
 * This is the **transition** hook. The assignment terminal guard is a separate
 * patch-hook on the patch helper (FIX-976 / epic constraint A1) and deliberately
 * not a further arm here: `setAssignee` never travels this path.
 *
 * ## The lease fence (FIX-1005)
 *
 * The last arm is the holder's half of {@link leaseLapsed}. A ticket-fenced
 * write on an `in_progress` row whose lease has already gone is declined
 * `lost-claim` — the reason it already is, not a new one.
 *
 * This is what makes the lease a promise rather than a hope. `isClaimable`'s
 * recovery arm and this arm are **two readings of one subtraction**, both
 * evaluated on the committed row inside the same atomic write, so a row is
 * either still the claimant's or already the queue's and the two sides cannot
 * drift. It closes three holes at once: a renewal that commits after the lease
 * it held cannot install a deadline on a row nobody holds, a settlement from a
 * worker that ran past its lease is refused, and a rescue path's `fail()`
 * after a lost lease is refused so the row stays recoverable instead of being
 * terminalized `errored` by our own liveness mechanism.
 *
 * Its one opt-out is `adoptLapsedLease` on a renewal (FIX-1305): a claimant
 * that has not started yet takes the row back rather than being refused, and
 * because every other arm still runs, "took it back" and "lost it" are decided
 * by this same write. See the option for why only the caller can tell the two
 * lapsed claimants apart.
 *
 * @param collectionId The board this write is happening on — compared against
 *   the ticket's, because two boards may both hold a task id.
 * @param now The clock the write is running against. Both backings already
 *   have one in scope at the call site; taking it as a parameter rather than
 *   capturing `Date.now` is what keeps this testable with an injected clock.
 * @param requireFrom The one status this verb may run from, when the verb owns a
 *   single edge rather than every legal path to its target. Two verbs do:
 *   `unblock` (`blocked → pending`) and `unpark` (`parked → pending`, FIX-1244).
 *   The status table cannot express this — it maps status to status, not verb
 *   to edge, and `in_progress → pending` is legal for `reclaim`, so without the
 *   fence `unpark` would re-queue a row a worker is holding.
 *   Checked ahead of the general legality arm so the more specific refusal wins.
 */
export function transitionDeclineReason(
  task: Task,
  targetStatus: TaskStatus,
  options: TaskTransitionOptions | undefined,
  collectionId: string,
  now: number,
  requireFrom?: TaskStatus,
  changeKind?: TaskChangeKind
): TaskWriteDeclineReason | undefined {
  if (options === undefined) return undefined;
  assertNoRemovedGuards(options);
  const claim = options.claim;
  if (options.ifAllowed === true && isTerminalStatus(task.status)) return "terminal";
  if (claim !== undefined && !ticketNamesTask(claim, collectionId, task)) return "not-my-task";
  if (
    options.ifAllowed === true &&
    requireFrom !== undefined &&
    task.status !== requireFrom
  ) {
    return "disallowed";
  }
  if (options.ifAllowed === true && !isTransitionAllowed(task.status, targetStatus)) {
    return "disallowed";
  }
  // FIX-1234: the caller asked not to settle a row somebody parked for review.
  //
  // Nothing above refuses this on its own, and that is deliberate rather than an
  // oversight: `parked` is in ATTEMPT_OWNED_STATUSES, `terminal` does
  // not fire on a parked row, `isTransitionAllowed` permits both
  // `parked → completed` and `→ errored`, and `leaseLapsed`
  // short-circuits to `false` for any status other than `in_progress`. A holder
  // recording a review's REJECTION as a failure is a supported write, and it
  // travels exactly this path.
  //
  // So this is opt-in. What it exists for is the write-back that follows a
  // worker's own run: a worker that parked its task and then returned or threw
  // owes the substrate no result, and letting its settlement land would erase
  // the park — or, with retries left, re-queue the row in front of a sibling
  // while a human is still being asked. Those callers pass
  // `refuseWhenParked` and get a decline; every other caller sees the contract
  // it always had.
  //
  // Scoped to settlement kinds so the flag cannot refuse the verbs that legally
  // move a parked row: `unpark` targets `pending`, which a retrying
  // failure also targets, and only the kind separates them.
  if (
    options.refuseWhenParked === true &&
    task.status === "parked" &&
    changeKind !== undefined &&
    SETTLEMENT_CHANGE_KINDS.has(changeKind)
  ) {
    return "parked";
  }
  if (claim !== undefined && !attemptOwnsTask(task, claim.attempt)) return "lost-claim";
  // FIX-1305: a renewal may be the ticket-holder taking the row BACK, rather
  // than a late write against a row it has lost. The two are the same evidence
  // — everything above passed, so the identity the ticket names is still the
  // row's and nobody has reclaimed it — and only the caller knows which one it
  // is, so it says (`adoptLapsedLease`).
  //
  // Scoped to a renewal, and that scope is structural rather than a promise:
  // `renewLease` is the only write that targets `in_progress`, so a settlement
  // carrying the flag is unaffected and a lapsed worker's result is still
  // refused. Nothing else about the write changes — a reclaim that moved
  // `attempts` or the status has already declined one arm up, which is what
  // makes the takeover decided by the race instead of by the clock.
  const adopting = options.adoptLapsedLease === true && targetStatus === "in_progress";
  if (claim !== undefined && !adopting && leaseLapsed(task, now)) return "lost-claim";
  return undefined;
}

/**
 * Refuse a verb that owns ONE edge when the task is not sitting on that edge's
 * source status.
 *
 * The non-advisory half of `requireFrom` — see {@link transitionDeclineReason}
 * for why the status table cannot carry this. Throws the same error type as
 * {@link assertTransitionAllowed}, because to a caller this *is* an illegal
 * transition: `unblock` on an `in_progress` task is not a legal write that
 * happens to skip a field, it is a `reclaim` spelled wrong.
 *
 * Runs after the decline check, so an advisory write still reports
 * `disallowed` instead of throwing.
 *
 * @throws {IllegalTaskTransitionError} when `task.status !== requireFrom`.
 */
export function assertTransitionFrom(
  task: Task,
  requireFrom: TaskStatus | undefined,
  targetStatus: TaskStatus,
  taskId: string
): void {
  if (requireFrom !== undefined && task.status !== requireFrom) {
    throw new IllegalTaskTransitionError({ taskId, from: task.status, to: targetStatus });
  }
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
 * The one subtraction this whole mechanism rests on (FIX-1005): an
 * `in_progress` row whose lease deadline has already passed.
 *
 * **One fact, two readings.** The queue reads it as *"this row is available"*
 * ({@link isClaimable}); the holder reads it as *"this row is no longer mine"*
 * ({@link transitionDeclineReason}'s fence). They are the same comparison on
 * the same committed row, so nothing has to be scheduled and nothing has to
 * agree with anything — there is no window between them to get wrong.
 *
 * **Scoped to `in_progress` on purpose.** {@link ATTEMPT_OWNED_STATUSES} also
 * contains `parked`, and `awaitReview` deliberately does *not* clear
 * `leaseUntil` — so an unscoped reading would take back (and refuse writes on)
 * any task a human took longer than a lease to review. A review park is an
 * explicit park; the lease governs `in_progress` and nothing else.
 *
 * `!= null` rather than truthiness: a row persisted without a lease is not a
 * lapsed one (BP-030).
 */
export function leaseLapsed(task: Task, now: number): boolean {
  if (task.status !== "in_progress") return false;
  return task.leaseUntil != null && task.leaseUntil <= now;
}

/**
 * The lease duration the claim **committed to** — how long the claimant may be
 * gone, as the claim wrote it, not how much of it is left.
 *
 * The one number two mechanisms both rest on, which is why it is a function
 * rather than a line in each of them: the renewal driver derives its cadence
 * from it ({@link startLeaseRenewal}), and a claimant taking a lapsed row back
 * renews for it, so the two would disagree the moment either copy was edited.
 * Not the lease that is *left* — that is `leaseUntil - now`, a different
 * number, and conflating them shrinks a late-starting driver's cadence to a
 * write storm.
 *
 * **Read from `leaseDurationMs`, with `leaseUntil - updatedAt` as the fallback
 * for a row claimed before that field existed (BP-030).** The subtraction is
 * exact only at the instant of the claim, which is what made storing the
 * number necessary: `setPriority`, `addLabel`, `removeLabel` and
 * `patchMetadata` are supported on an `in_progress` row and all move
 * `updatedAt` while leaving `leaseUntil` alone, so on a legacy row a
 * coordinator's relabel shortens what this reports — and past the deadline
 * drives it non-positive. Both consumers treat that as "cannot reason about
 * this row" rather than as a short lease, which is the same conservative
 * answer those rows got before this field existed.
 *
 * `undefined` when the row holds no lease deadline — nothing is claiming to be
 * alive on it, so there is no committed span to report even if the duration a
 * past claim wrote is still on the row. A non-positive result is returned
 * as-is; what to do about it is the caller's: the driver goes inert, the
 * takeover refuses.
 */
export function committedLeaseSpan(task: Task): number | undefined {
  if (task.leaseUntil == null) return undefined;
  if (task.leaseDurationMs != null) return task.leaseDurationMs;
  return task.leaseUntil - task.updatedAt;
}

/**
 * True when `task` is ready to be claimed: status is `pending` and
 * deps are satisfied.
 *
 * Kept as the narrower "never been started" question. Since FIX-1005 the
 * substrate's admission test is {@link isClaimable}, which is this **plus**
 * a row whose worker died — dispatchers that used to spell out `isReady`
 * dropped the conjunct rather than widening it, because widening three copies
 * separately is the drift the shared predicate exists to prevent.
 */
export function isReady(
  task: Task,
  lookup: (id: string) => Task | undefined
): boolean {
  if (task.status !== "pending") return false;
  return depsSatisfied(task, lookup);
}

/**
 * **The one admission predicate** — "should the claim path look at this row?"
 * (FIX-1005).
 *
 * Shared by all three producers that used to answer it independently: the
 * claim path, the board's wake probe (`task-board/shared.ts`), and the
 * ready-task preview (`blocks/select-next-ready-task.ts`). Move a subset and a
 * board recovers rows it never wakes for, or wakes for work it will not take.
 *
 * It answers **admission only**. What to *do* with an admitted row —
 * re-dispatch it, or settle it because its abandonment allowance is spent — is
 * {@link claimDisposition}'s question, decided inside the atomic write against
 * committed state. Folding disposition in here is what produced an earlier
 * contradiction: both backings filter candidates through eligibility *before*
 * the write, so a row the predicate excluded could never reach the branch that
 * was supposed to settle it.
 *
 * There is deliberately **no attempts arm**. `maxAttempts` is optional and
 * `shouldRetryOnFail` returns `false` without one, so an "attempts remain" arm
 * would make an ordinary task unrecoverable after its first attempt — the
 * feature off by default unless every caller opted into retries.
 *
 * `now` is a parameter rather than a captured clock because the wake probe has
 * none of its own.
 */
export function isClaimable(
  task: Task,
  lookup: (id: string) => Task | undefined,
  now: number
): boolean {
  if (task.status !== "pending" && !leaseLapsed(task, now)) return false;
  return depsSatisfied(task, lookup);
}

/**
 * What the claim write should do with a row {@link isClaimable} admitted
 * (FIX-1005) — evaluated **inside** the atomic write, against committed state.
 *
 * - `claim` — hand it out. The ordinary case, and every `pending` row.
 * - `settle-abandoned` — its worker died more times than the allowance
 *   permits, so the write settles it `errored` right here rather than handing
 *   out another duplicate execution. Settling *in the claim write* is what
 *   keeps the deadlock closed: a row left `in_progress` with nobody on it
 *   still counts as in-flight, and the board would then never report `drained`
 *   or `blocked`.
 */
export function claimDisposition(
  task: Task,
  now: number,
  maxAbandonments: number
): "claim" | "settle-abandoned" {
  if (!leaseLapsed(task, now)) return "claim";
  return readAbandonments(task) < maxAbandonments ? "claim" : "settle-abandoned";
}

/** The error recorded on a row the substrate stopped recovering (FIX-1005). */
export function abandonmentExhaustedError(
  taskId: string,
  maxAbandonments: number
): string {
  return (
    `[tasks] task "${taskId}" was abandoned by its worker ${maxAbandonments} times ` +
    `without completing. Not re-dispatched.`
  );
}

/** Default ordering: ascending `createdAt`, stable on tied timestamps via id. */
export function defaultOrder(a: Task, b: Task): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

/**
 * Default lease duration applied when the dispatcher does not pass one through.
 *
 * **Two minutes (FIX-1005).** Duplicate side effects are the expensive failure
 * and slow recovery is the cheap one. At `RENEWAL_DIVISOR = 3` this puts
 * renewals 40 s apart and one missed renewal is survivable, so a worker has to
 * be unresponsive for roughly 80 s before it loses its row — which is the band
 * ordinary GC pauses, slow disks and paused containers actually fall in. The
 * cost is that a genuinely dead job waits up to two minutes to come back;
 * callers who want it sooner pass a shorter lease per claim.
 *
 * A **default**, not a guard: {@link assertValidLeaseDuration} still validates
 * whatever a caller passes, and a caller passing its own lease is unaffected.
 */
export const DEFAULT_LEASE_DURATION_MS = 120_000;

/**
 * Floor on a caller-supplied lease (FIX-1005).
 *
 * The renewal cadence is derived from the lease (`span / RENEWAL_DIVISOR`), so
 * one minimum stated in the caller's own units subsumes a separate cadence
 * floor: there is one number to justify instead of two.
 */
export const MIN_LEASE_DURATION_MS = 1_000;

/**
 * Ceiling on a caller-supplied lease (FIX-1005), and it exists for the same
 * reason the floor does.
 *
 * `setTimeout` coerces a delay past a 32-bit signed integer to **1 ms** (with a
 * `TimeoutOverflowWarning`), so a lease past `TIMEOUT_MAX × RENEWAL_DIVISOR`
 * would rebuild the renewal write storm the floor exists to prevent — out of a
 * lease nobody would call invalid. About 74.5 days.
 */
export const MAX_LEASE_DURATION_MS = 2_147_483_647 * 3;

/**
 * Refuse a lease duration outside its permissible domain (FIX-1005).
 *
 * **Throws rather than declining or normalizing**, reusing this repo's stated
 * posture for a numeric argument outside its domain (`RequestStore`'s
 * `expectedVersion`, `engine/src/stores/types.ts`): it is a programming error,
 * not a runtime condition and not a lost race, so it is never folded into a
 * write verdict. Normalizing silently is the worse option — a caller who asked
 * for a 10 ms lease and got 1,000 ms has been given a different guarantee than
 * the one they asked for.
 */
export function assertValidLeaseDuration(leaseDurationMs: number): void {
  if (!Number.isFinite(leaseDurationMs)) {
    throw new Error(
      `[tasks] leaseDurationMs must be a finite number, got ${String(leaseDurationMs)}.`
    );
  }
  if (leaseDurationMs < MIN_LEASE_DURATION_MS) {
    throw new Error(
      `[tasks] leaseDurationMs must be at least ${MIN_LEASE_DURATION_MS}ms, got ` +
        `${leaseDurationMs}ms. The lease is how long a worker may be gone before its ` +
        `work is handed to someone else; below this the renewal cadence it implies is ` +
        `a write storm.`
    );
  }
  if (leaseDurationMs > MAX_LEASE_DURATION_MS) {
    throw new Error(
      `[tasks] leaseDurationMs must be at most ${MAX_LEASE_DURATION_MS}ms, got ` +
        `${leaseDurationMs}ms. A longer lease overflows the renewal timer's delay, ` +
        `which the platform then coerces to 1ms.`
    );
  }
}

/**
 * Refuse a renewal deadline outside its permissible domain (FIX-1005).
 *
 * Same posture as {@link assertValidLeaseDuration}, and deliberately the same
 * rule rather than a second convention: the claim seam validates a *duration*
 * and cannot constrain the *absolute* deadline the renewal verb takes, so the
 * verb validates its own input at its own seam.
 */
export function assertValidLeaseDeadline(leaseUntil: number): void {
  if (!Number.isFinite(leaseUntil)) {
    throw new Error(
      `[tasks] renewLease requires a finite absolute deadline, got ${String(leaseUntil)}.`
    );
  }
}

/**
 * Apply a `claim` to a task — flip status, stamp lease, increment attempts,
 * and record where this attempt is running (FIX-1005).
 *
 * Note: `task.assignee` is the worker-registry key (set at task creation by
 * the user), not the runtime worker identity. `claim`'s `workerId` is for
 * trace attribution; the lease itself is `leaseUntil`. So we don't touch
 * `task.assignee` here.
 *
 * `claimedBy` takes a **narrowed** identity rather than a `BlockContext` on
 * purpose: the write path has no business holding a context, and a plain value
 * is what makes the field testable without one.
 *
 * It is written **unconditionally** — set when the caller has an identity,
 * cleared when it does not. A conditional spread would be wrong here even
 * though it reads as the careful option: `claimedBy` is written onto a spread
 * of the *incoming* task, so adding nothing leaves the previous attempt's
 * coordinate in place, now paired with a fresh attempt and a fresh lease. That
 * is worse than absent, because absent is a state readers are told to expect
 * and handle (BP-030) while a stale coordinate reads as current. Clearing with
 * `undefined` is the same shape the claim-clear sites use.
 *
 * `startedAt` is the deliberate contrast a few lines down: it *does* inherit,
 * because it answers "when did work on this task first begin", which a
 * re-claim does not change.
 *
 * `incarnationId` (FIX-989) inherits too, and for the same kind of reason —
 * do not "fix" it to match this field. The two are scoped differently:
 * `claimedBy` belongs to one *attempt*, so every claim must re-establish or
 * clear it, while `incarnationId` identifies the *row* for its whole life and
 * is minted once at creation. A field that is supposed to outlive the write
 * carrying it forward is correct; a per-attempt field doing so is the bug
 * above.
 */
export function applyClaimToTask<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  now: number,
  leaseDurationMs: number,
  claimedBy?: TaskClaimIdentity
): Task<TInput, TOutput> {
  // A claim that takes back a lapsed row is a RECOVERY, and it is counted
  // (FIX-1005). Counting it here rather than at a separate seam is what keeps
  // the count atomic with the hand-off: the same write that advances
  // `attempts` advances this, so there is no window in which a row has been
  // re-dispatched but not yet charged for it.
  const recovering = leaseLapsed(task as Task, now);
  return {
    ...task,
    status: "in_progress",
    attempts: task.attempts + 1,
    ...(recovering ? { abandonments: readAbandonments(task as Task) + 1 } : {}),
    startedAt: task.startedAt ?? now,
    leaseUntil: now + leaseDurationMs,
    // The duration this claim committed to, kept beside the deadline it
    // produced (FIX-1305). Every other write to a running row moves
    // `updatedAt`, so the subtraction that used to stand in for this number
    // stops being it the moment a coordinator relabels the task.
    leaseDurationMs,
    claimedBy,
    updatedAt: now,
  };
}

/**
 * The patch that settles a row whose abandonment allowance is spent
 * (FIX-1005), applied inside the same claim write that admitted it.
 *
 * `in_progress → errored` is already a legal transition, and clearing the
 * lease and the coordinate matches every other path that ends a claim.
 */
export function applyAbandonmentSettlement<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  now: number,
  maxAbandonments: number
): Task<TInput, TOutput> {
  return {
    ...task,
    status: "errored",
    error: abandonmentExhaustedError(task.id, maxAbandonments),
    completedAt: now,
    leaseUntil: undefined,
    claimedBy: undefined,
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
