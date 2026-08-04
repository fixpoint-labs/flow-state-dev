/**
 * Collection caps — the two bounds a collection enforces on insertion
 * (FIX-931), the cumulative retry budget (FIX-948), and the typed breach every
 * caller must reckon with.
 *
 * Four bounds sit at four scopes on a board. `concurrency` (the task-board
 * pattern's existing knob) bounds how many tasks run *at once*. Two bound
 * creation, and one bounds re-running what already exists:
 *
 * - `maxEnqueuedTasks` — how many tasks may be *added* while others are still
 *   waiting in `pending`. Checked at creation against the resulting `pending`
 *   count, so it refreshes as tasks drain: a task leaving `pending` frees a slot
 *   for a later `addTask`. It bounds a single up-front fan-out burst.
 * - `maxTotalTasks` — the board's lifetime size: the count of *all* tasks in the
 *   ledger, terminal ones included. Never refunded on drain, so it is the
 *   backstop that catches a drain-then-re-enqueue runaway.
 *
 * - `maxTotalRetries` — how many times, in total, this collection may put a
 *   FAILED task back in the queue (FIX-948). Not a creation bound: it counts
 *   re-runs of tasks that already exist, which is exactly what the two above
 *   cannot see. Enforced inside `fail()`'s atomic write; at the bound the
 *   failing task settles terminal `errored` instead of re-pending.
 *
 * Roughly *in-flight ⊆ enqueued ⊆ total*, but only **at creation time**. Tasks
 * also re-enter `pending` through the lifecycle (a retry under `maxAttempts`, an
 * `unblock`, a `resumeFromReview`, a reclaimed lease). Of those, only the RETRY
 * is bounded, and only by `maxTotalRetries`; `unblock` / `resumeFromReview` /
 * `reclaim` remain deliberately uncapped and do not consume the retry budget —
 * so `pending` can still transiently exceed `maxEnqueuedTasks`. The hard runaway
 * bounds are `maxTotalTasks` on creation and `maxTotalRetries` on re-runs.
 *
 * Caps are a property of the COLLECTION, not the board: they are applied where a
 * collection is constructed. A board handed a collection it did not build
 * applies none.
 *
 * ## Lifetime — the canonical statement (cite this, don't restate it)
 *
 * No cap is a stored counter. All three are DERIVED from the ledger's contents
 * at check time (`maxTotalTasks` = the task map's size, `maxEnqueuedTasks` = its
 * `pending` count, `maxTotalRetries` = the sum of every task's granted-retry
 * count). So they persist exactly as far as the ledger does, and no further:
 *
 * - **Request-backed** — the ledger lives on `ctx.request`, so it ends with the
 *   request. A new request starts empty and both counts start from zero.
 * - **Sequencer-backed, resumed from a checkpoint** — the sequencer restores its
 *   whole accumulator on resume (`ctx.sequencer.setState(resumeState.state)` in
 *   `packages/core/src/blocks/sequencer.ts`), and the task map is part of it. The
 *   counts come back with the ledger; a post-resume wave is checked against the
 *   pre-suspension tasks, NOT against an empty board.
 *
 *   The trap, because this bullet gets cited: `backing: "sequencer"` names the
 *   STATE REF's shape, not the block it hangs off. `SequencerBackingSpec.sequencer`
 *   accepts any `StateRef` (`get-or-create.ts`), and the delegation surface passes
 *   `ctx.self` — the executive GENERATOR's own state (`delegation-surface.ts`).
 *   Only a sequencer block checkpoints: the lone `state_snapshot` emitter bails
 *   when `ctx.sequencer` is undefined, and that resolves only through a parent
 *   whose `kind === "sequencer"`. A generator's own-state container is rebuilt
 *   from `stateSchema` per scope entry with no persist callback, so a DELEGATION
 *   board's ledger — and its counts — start over. Durable non-sequencer block
 *   state is FIX-917's deferred follow-up.
 * - **Resource-backed** — no cap is enforced. The nearest durable analogue
 *   is `defineTaskCollection({ maxInstances })`, but it is a CAPACITY limit and
 *   NOT a lifetime ceiling, so it does not substitute for `maxTotalTasks`. The
 *   registry checks it with `countInstances` over the LIVE instances
 *   (`engine/src/context/resource-registry.ts`) and throws once the namespace is
 *   full (`eviction` defaults to `"none"`). The collection's public `delete()`
 *   frees a slot, so a delete-and-requeue loop can create more tasks over the
 *   board's lifetime than `maxInstances` — it is not a runaway backstop.
 *   Neither is it all-or-nothing: resource-backed `addTasks` awaits one
 *   `collection.create` per task (`resource-backed.ts`), so a batch crossing the
 *   limit leaves every task before the throw in place — unlike the single CAS
 *   write that makes this file's caps atomic on the sequencer/request backings.
 *   Bounding the `pending` subset stays deferred: the registry counts instances
 *   and has no notion of a task's status (see FIX-939).
 *
 *   **Counting and enforcing are separate on this backing, and the distinction
 *   is deliberate.** The retry COUNT is maintained here — `fail()`'s retry patch
 *   increments the granted count exactly as the sequencer backing does — because
 *   the count is a public `Task` field feeding the board's report, and a durable
 *   board reporting zero retries having actually retried is a false statement,
 *   not a coverage gap. What is absent is ENFORCEMENT: the budget check must be
 *   atomic against the whole ledger, and the resource layer has no CAS across
 *   instances. So `maxTotalRetries` is kept off `ResourceBackingSpec` (asking
 *   for it there is a compile error, not an accepted-and-ignored ceiling), and
 *   the ref reports `maxTotalRetries: null` so no caller can read a non-zero
 *   count as evidence a budget applied.
 *
 * ## Counting begins at upgrade (`maxTotalRetries` only)
 *
 * A task persisted before FIX-948 carries no granted-retry count, so it reads as
 * zero and its pre-upgrade retries are not in the sum. The count means
 * "authorized retries since the upgrade", not "since the task was created".
 * Backfilling from `attempts` is deliberately NOT done: `attempts` also moves
 * for re-claims that were never failure retries, so a backfill would put
 * non-retries into both the enforcement and the report — the exact quantity this
 * budget was designed not to count.
 *
 * The exposure is narrow because enforcement and long-lived legacy records never
 * coincide: request-backed ledgers die with their request, resource-backed ones
 * live indefinitely but do not enforce, and the single real case — a sequencer
 * board resumed across a deploy — overshoots by at most one budget, once.
 *
 * "The caps reset on resume" is false for a true sequencer host and was wrong in
 * the docs before FIX-931 landed. What the spec actually scoped out was a
 * cross-resume cumulative *guarantee* — we do not promise the counts survive,
 * because that depends on the backing and on whether a checkpoint was restored.
 * We equally do not promise they reset.
 *
 * ## Enforcement boundary (the other thing not to restate wrongly)
 *
 * The caps are closed over by ONE resolved `TaskCollectionRef`, and
 * `getOrCreateTaskCollection` never caches — every call builds a fresh ref. A
 * second ref over the same ledger built WITHOUT these options enforces nothing
 * and can insert straight past the bounds. "Intrinsic to the collection"
 * therefore means intrinsic to a ref, not to the underlying storage. Every
 * writer for a bounded board must resolve through the board's own
 * `collectionFactory`/`capability`, or be handed `board.caps`.
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
 * The collection's caps, as accepted by every construction point. A finite
 * integer sets the bound; `null` means explicitly unbounded on that axis;
 * omitting the option leaves it to whatever default the construction point
 * applies (which is why `null` exists — omission is not an off switch).
 */
export interface TaskCapOptions {
  /** Lifetime task count, terminal tasks included. `null` = unbounded. */
  maxTotalTasks?: number | null;
  /** Enqueued-at-creation `pending` count. `null` = unbounded. */
  maxEnqueuedTasks?: number | null;
  /**
   * Cumulative failure retries this collection may authorize, across every task
   * (FIX-948). Default {@link DEFAULT_MAX_TOTAL_RETRIES}. `null` = unbounded.
   *
   * Three things about it are surprising and all three are deliberate:
   *
   * - **`0` is legal** and means "run every task once, never retry". Unlike the
   *   two creation caps — where `0` would mean "this board can do nothing" and
   *   is rightly refused — a zero retry budget is a coherent configuration, and
   *   without accepting it there would be no way to express one: omission gives
   *   the default and `null` gives unbounded. A first attempt is never refused
   *   at any budget value, by construction.
   * - **The budget is spent at AUTHORIZATION**, not at execution. If a re-pended
   *   task is never re-claimed (the worker died, the lease expired) the grant
   *   stays spent. That errs conservative — the bound can only under-spend
   *   relative to real model calls, never over-spend — and refunding it would
   *   mean inferring abandonment from lease expiry, which the task substrate
   *   does not treat as evidence.
   * - **Only failure retries count.** `unblock`, `resumeFromReview`, and
   *   `reclaim` also return a task to `pending` and do NOT consume the budget.
   *
   * Enforced only on the backings that can check atomically against the whole
   * ledger (sequencer / request). The resource backing still COUNTS retries but
   * does not enforce, and reports `maxTotalRetries: null` so a caller can never
   * read a non-zero count as evidence a budget applied.
   */
  maxTotalRetries?: number | null;
}

/** Default lifetime ceiling applied where a board/library constructs a collection. */
export const DEFAULT_MAX_TOTAL_TASKS = 500;

/** Default enqueue-burst ceiling applied where a board/library constructs a collection. */
export const DEFAULT_MAX_ENQUEUED_TASKS = 100;

/**
 * Default cumulative retry budget applied where a board/pattern constructs a
 * collection (FIX-948).
 *
 * Sized to be invisible in normal operation and decisive on a storm: a 25-task
 * board whose tasks each retry twice produces exactly 50 retries, so ordinary
 * work on a small board never reaches it, while a single task looping on a
 * permissive `maxAttempts` hits it in seconds.
 *
 * It is deliberately far tighter than the *implicit* bound it replaces
 * (`maxTotalTasks × maxAttempts` ≈ 1000 at the defaults), and it WILL bind large
 * boards under ordinary flakiness — a 500-task board on a bad day reaches 50
 * retries legitimately. That is the accepted cost of a bound an operator can
 * actually see and set: raise it with `maxTotalRetries`, or pass `null` to opt
 * out entirely.
 */
export const DEFAULT_MAX_TOTAL_RETRIES = 50;

function assertCapValue(label: string, name: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${label} ${name} must be a positive integer, or null for explicitly unbounded (got ${value})`,
    );
  }
}

/**
 * Validate the retry budget — **nonnegative**, deliberately asymmetric with
 * {@link assertCapValue}'s positive rule.
 *
 * `maxTotalTasks: 0` means "this board can do nothing", which is nonsense.
 * `maxTotalRetries: 0` means "run every task once, never retry", which is a
 * coherent and probably common configuration, and is the only way to express it.
 * `NaN` / `Infinity` / negative / fractional stay refused on both.
 */
function assertRetryBudgetValue(
  label: string,
  name: string,
  value: number | null | undefined
): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label} ${name} must be a nonnegative integer (0 means "never retry"), or null for ` +
        `explicitly unbounded (got ${value})`,
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
  assertRetryBudgetValue(label, "maxTotalRetries", caps.maxTotalRetries);
  // No cross-cap ordering rule involves the retry budget. It counts a different
  // quantity (re-runs, not tasks), so no pairing with either creation cap is
  // contradictory — `maxTotalRetries: 1000` on a 5-task board is a legitimate
  // request for a board that retries hard.
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

/**
 * Apply the defaults to a caller's partial caps and validate the result — the
 * ONE place 500/100 is turned into a concrete configuration.
 *
 * Every site that constructs a collection on a caller's behalf (`taskBoard`'s
 * declarative branch, the delegation surface) goes through here rather than
 * spelling out its own defaulting. Two sites holding one definition is how a
 * default silently diverges: they agree the day they are written and nothing
 * fails when one is later changed alone.
 *
 * `null` must survive: it is the explicit unbounded opt-out, so it is NOT the
 * same as omission. `?? DEFAULT` would collapse the two and quietly delete the
 * only in-place migration a capped board has.
 *
 * @param label Prefix identifying the construction site in a validation error.
 * @param caps The caller's partial options; omitted axes take their default.
 */
export function resolveTaskCapDefaults(label: string, caps: TaskCapOptions): TaskCapOptions {
  // Validate what the CALLER actually supplied first. The ordering rule exists
  // to catch a contradiction the caller wrote; it must not fire on a pairing
  // this function itself invented.
  validateTaskCaps(label, caps);

  const maxTotalTasks =
    caps.maxTotalTasks === undefined ? DEFAULT_MAX_TOTAL_TASKS : caps.maxTotalTasks;

  // An omitted enqueue bound is DERIVED from the resolved total, not chosen
  // independently. `taskBoard({ maxTotalTasks: 50 })` is a request for a smaller
  // board, not a contradiction — supplying the 100 default beside it and then
  // rejecting the pair would refuse a plainly reasonable configuration.
  //
  // The clamp is deliberately one-directional. Lowering the softer bound (the
  // burst) to fit a ceiling the caller chose is always safe. Raising the harder
  // bound to fit an explicit burst is not: it would quietly weaken a lifetime
  // ceiling the caller never touched, so an explicit `maxEnqueuedTasks` above
  // the resolved total still throws.
  const maxEnqueuedTasks =
    caps.maxEnqueuedTasks === undefined
      ? typeof maxTotalTasks === "number"
        ? Math.min(DEFAULT_MAX_ENQUEUED_TASKS, maxTotalTasks)
        : DEFAULT_MAX_ENQUEUED_TASKS
      : caps.maxEnqueuedTasks;

  const maxTotalRetries =
    caps.maxTotalRetries === undefined ? DEFAULT_MAX_TOTAL_RETRIES : caps.maxTotalRetries;

  const resolved: TaskCapOptions = { maxTotalTasks, maxEnqueuedTasks, maxTotalRetries };
  // Re-validate the resolved pair. The clamp above makes this unreachable for a
  // derived enqueue bound, so what it still catches is an EXPLICIT enqueue bound
  // above a defaulted total — which is a real contradiction worth naming.
  validateTaskCaps(label, resolved);
  return resolved;
}

/**
 * The retry-budget opt-out a surface passes when its tasks can never retry
 * (FIX-948) — the delegation board and `eventActors`.
 *
 * It is `null`, not omission, and the difference is the whole point. Omitting
 * the axis means "take the default", so every defaulting site downstream —
 * `resolveTaskCapDefaults` here, and `resolveBoardCaps` again inside
 * `taskBoard` — re-applies the finite default. A surface that merely leaves the
 * option undeclared therefore still installs a real, non-configurable cap, with
 * no way to raise it or turn it off, that starts binding the day that surface
 * gains `maxAttempts`. `null` is the value that survives every defaulting site,
 * which is exactly why it exists.
 *
 * Spelled as a named constant so the refusal is one greppable decision rather
 * than a bare `null` at two call sites.
 */
export const RETRY_BUDGET_NOT_APPLICABLE = null;
