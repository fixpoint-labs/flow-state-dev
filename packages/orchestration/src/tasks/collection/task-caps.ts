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
 *
 * ## Lifetime — the canonical statement (cite this, don't restate it)
 *
 * Neither cap is a stored counter. Both are DERIVED from the ledger's contents
 * at check time (`maxTotalTasks` = the task map's size, `maxEnqueuedTasks` = its
 * `pending` count). So they persist exactly as far as the ledger does, and no
 * further:
 *
 * - **Request-backed** — the ledger lives on `ctx.request`, so it ends with the
 *   request. A new request starts empty and both counts start from zero.
 * - **Sequencer-backed, resumed from a checkpoint** — the sequencer restores its
 *   whole accumulator on resume (`ctx.sequencer.setState(resumeState.state)` in
 *   `packages/core/src/blocks/sequencer.ts`), and the task map is part of it. The
 *   counts come back with the ledger; a post-resume wave is checked against the
 *   pre-suspension tasks, NOT against an empty board.
 * - **Resource-backed** — not enforced at all (deferred, see FIX-939/FIX-917).
 *
 * "The caps reset on resume" is false for the sequencer backing and was wrong in
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

  const resolved: TaskCapOptions = { maxTotalTasks, maxEnqueuedTasks };
  // Re-validate the resolved pair. The clamp above makes this unreachable for a
  // derived enqueue bound, so what it still catches is an EXPLICIT enqueue bound
  // above a defaulted total — which is a real contradiction worth naming.
  validateTaskCaps(label, resolved);
  return resolved;
}
