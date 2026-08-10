/**
 * `TaskCollectionRef` — uniform API across both backings (FIX-443 §3.3).
 *
 * The same shape is returned from `getOrCreateTaskCollection` regardless
 * of how the collection is stored (sequencer-state vs resource-collection).
 * Patterns and dispatchers consume `TaskCollectionRef` and never reach for
 * the underlying storage directly.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { TaskClaimTicket } from "../claim-ticket";
import type { Task, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import type { TaskWriteToken } from "../write-provenance";

/**
 * Why a write was refused (FIX-976; `not-my-task` added by FIX-981;
 * `immutable-assignee` by FIX-982). Resolved in a **fixed precedence order** —
 * `immutable-assignee` → `terminal` → `not-my-task` → `disallowed` →
 * `lost-claim` — so a decline where two conditions hold always reports the same
 * one, and two callers cannot render two different messages for the same
 * refusal.
 *
 * - `immutable-assignee` — the board runs detached work, where a task's
 *   assignee is fixed at admission. Reassignment is refused whatever the task's
 *   status is.
 * - `terminal` — the task had already reached `completed` / `errored` /
 *   `cancelled`. The majority of the exposure, but not all of it.
 * - `not-my-task` — the presented `claim` names a different board, a different
 *   task, or a task since recreated under the same id. The write targets a row
 *   the caller never held.
 * - `disallowed` — the state machine rejects the move from a **non**-terminal
 *   status (`pending → errored`, `blocked → errored`).
 * - `lost-claim` — the presented `claim` names this task but no longer owns it:
 *   it was reclaimed, re-queued, or parked while the caller was working.
 *
 * **Why `not-my-task` sits above `disallowed`, and below `terminal`.** The
 * guard runs inside the atomic write, but a decline aborts that write *before*
 * it is attempted, so the conditional write never conflicts, never refreshes,
 * and never re-runs the guard. Whatever basis the caller resolved the
 * collection on is therefore the basis the arms read. Two of the four arms are
 * safe under that: `not-my-task` reads no mutable task state at all, and
 * terminality is absorbing, so a task observed terminal on *any* basis is
 * terminal. `disallowed` is not — it compares two statuses, and a stale
 * `pending` makes an ordinary settlement look illegal. Left last, the ownership
 * arm would report `disallowed` on one interleaving and `not-my-task` on
 * another for the same cross-task write: accidental protection, not a
 * guarantee, and a reason no caller can act on.
 *
 * **Why `immutable-assignee` sits above `terminal`.** It reads no mutable task
 * state at all — the board either runs detached work or it does not — so it is
 * safe at any position by the argument above. It goes first because it is the
 * only arm true of *every* status: reporting `terminal` for a finished task on a
 * detached board would imply a pending one could be reassigned, which is exactly
 * the wrong thing to tell a caller that is about to retry.
 */
export type TaskWriteDeclineReason =
  | "immutable-assignee"
  | "terminal"
  | "not-my-task"
  | "disallowed"
  | "lost-claim";

/**
 * What a write actually did (FIX-976).
 *
 * Produced **inside** the same atomic write that made the decision, so the
 * verdict cannot race the write it describes and no caller has to re-read task
 * state to find out what happened. Re-deriving it from a post-write read would
 * be a check-after-write race — the thing the guards were moved inside the CAS
 * to avoid.
 *
 * Three variants, and all three are load-bearing:
 *
 * - `recorded` — a task field changed. Every verb that moves a task through its
 *   lifecycle also emits a `task-change` item; `renewLease` is the one
 *   exception and emits none, because a renewal is not a lifecycle change — the
 *   task did not move, the holder only said "still here". Do not wait on a
 *   `task-change` to observe a renewal; read `leaseUntil`.
 * - `unchanged` — the desired state already held, so nothing was written and no
 *   `task-change` item was emitted. This is a **task-level** outcome: on the
 *   resource backing the underlying `updateState` still runs, so a
 *   `resource_change` may still fire (unchanged from before FIX-976).
 * - `declined` — the write was refused, carrying why and the status observed
 *   inside the write. A decline is a **value, not an error**: it never throws.
 *
 * `unchanged` is not a nicety. Without it an idempotent `setAssignee` (the
 * assignee already matches) would have to report `recorded`, claiming a write
 * that did not happen — the same dishonesty FIX-976 exists to remove.
 *
 * Discarding the return value is a supported way to call these methods
 * (BP-030). The substrate's own containment write-backs do exactly that, which
 * is what keeps FIX-951's behaviour intact: reporting a decline and acting on
 * one are deliberately separate.
 */
export type TaskWriteOutcome =
  | { outcome: "recorded" }
  | { outcome: "unchanged" }
  | {
      outcome: "declined";
      reason: TaskWriteDeclineReason;
      /** The status the task was in when the write was refused. */
      status: TaskStatus;
    };

/** Options for `claim` — let the dispatcher narrow eligibility and tweak ordering. */
export interface ClaimOptions {
  /**
   * Per-task predicate that **narrows** the substrate's candidates. It does not
   * replace them: the substrate admits a task first, then CAS-claims the first
   * admitted task that also passes this. Default: no narrowing.
   *
   * **The candidate set is no longer `pending` only (FIX-1005).** It is every
   * task the substrate considers claimable, which since lease-based recovery
   * includes an `in_progress` row whose lease has run out — a task whose worker
   * died. So the predicate sees both, and the obvious-looking assertion is the
   * one thing not to write here:
   *
   * ```ts
   * // WRONG since FIX-1005 — silently opts out of abandoned-job recovery.
   * eligibility: (t) => t.status === "pending" && t.assignee === "researcher"
   *
   * // Right: narrow on what you care about, and leave claimability alone.
   * eligibility: (t) => t.assignee === "researcher"
   * ```
   *
   * A status assertion compiles, reads correctly, and quietly makes stranded
   * jobs unrecoverable for that dispatcher, because the row it must match is
   * `in_progress`. Claimability is the substrate's call — `isClaimable` — and
   * composing rather than replacing is what stops the newest invariant being
   * the one most easily switched off by accident.
   */
  eligibility?: (task: Task) => boolean;
  /**
   * Sort comparator over candidates. Default: ascending `createdAt`.
   */
  order?: (a: Task, b: Task) => number;
  /**
   * How long the claimant may be gone before its work is handed to someone
   * else. Stamped onto the claimed task's `leaseUntil`; defaults to two
   * minutes.
   *
   * **This is the recovery-latency knob** (FIX-1005). A worker the substrate
   * drives renews this while it works, so a lease that lapses means no live
   * worker is holding the row and the next claim takes it back. Pass less and
   * a dead job comes back sooner, at the cost of taking work from a worker
   * that merely stalled; size it to the whole job and nobody takes it back
   * until then. A row you claim by hand gets no renewal — you hold it, so you
   * renew it.
   *
   * Validated rather than normalized: a value below one second, above ~74
   * days, or non-finite **throws**, because each would turn the renewal
   * cadence derived from it into a write storm or an overflowed timer.
   */
  leaseDurationMs?: number;
}

/**
 * Opt-in guards for the lifecycle write-backs (FIX-951; widened to every
 * worker-callable transition by FIX-981).
 *
 * Both guards are evaluated **inside** the same atomic write that performs
 * the transition, so there is no window between checking and writing. Both
 * are advisory in the sense that matters for containment: a rejected write
 * is skipped and **never throws**, so a late worker cannot abandon its
 * siblings by losing a race.
 *
 * It is *not* silent, and that is the FIX-976 change. The call returns a
 * {@link TaskWriteOutcome}; a rejected write yields `outcome: "declined"`
 * carrying `reason` — which guard fired — so a caller that wants to know can
 * read it without re-reading the task. A caller that doesn't care may keep
 * ignoring the return value, which is why this stayed source-compatible.
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
   * Record the outcome only if the caller still **owns** the task it is
   * writing to.
   *
   * The ticket is minted by the substrate at claim time (`ticketForClaim`) and
   * names the board, the task, the attempt, and the task's `createdAt`. It
   * answers two questions the write cannot answer for itself:
   *
   * - **Is this the task I claimed?** Declines `not-my-task` when the ticket
   *   names another board, another task, or a task since recreated under the
   *   same id. This is the question a bare attempt number could not ask, which
   *   is why it replaced one.
   * - **Do I still hold it?** Declines `lost-claim` unless `task.attempts`
   *   equals the ticket's attempt *and* the task is still `in_progress` or
   *   `awaiting_review`. The status half is not belt-and-braces: `reclaim()`
   *   returns a task to `pending` without advancing `attempts`, so between a
   *   reclaim and the next claim a displaced worker matches the counter by
   *   construction — and since `blocked` is reachable only from `pending`, a
   *   counter-only guard would let a stale worker silently unblock work a
   *   coordinator parked.
   *
   * Omit it and no ownership question is asked, which is the correct posture
   * for a coordinator writing to a board it never claimed from.
   */
  claim?: TaskClaimTicket;
  /**
   * Record this write on the task, so the caller can find out afterwards
   * whether it committed — **even if this call throws** (FIX-989).
   *
   * Mint one with `beginTaskWrite(tasks.get(id))` *before* the write and read
   * the answer with `didWriteLand(tasks.get(id), write)` after. The returned
   * {@link TaskWriteOutcome} already says what a call that *returned* did; this
   * covers the path it cannot reach, where the durable write commits and the
   * change announcement then rejects.
   *
   * Three answers come back, and the third is the point: landed, did not land,
   * or **cannot tell**. See `didWriteLand` for the rule and for what a `false`
   * precisely means.
   *
   * Correlation is available on the seven methods that take this options
   * object. `addTask`, `addTasks`, `claim`, `reclaim` and the five field
   * mutators still bump the task's `revision` but mint no receipt, so a caller
   * of those cannot correlate its own write. Widening means adding an options
   * argument to nine more methods on an already-large interface; it waits for a
   * consumer that needs it.
   *
   * A `TaskCollectionRef` written by hand maintains no provenance, and needs no
   * migration to stay correct: absence of a record reads as "cannot tell", not
   * as "your write did not land".
   */
  write?: TaskWriteToken;
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
 * If you write one, every worker-callable transition — `complete`, `fail`,
 * `block`, `unblock`, `awaitReview`, `resumeFromReview`, `cancel` — **must**
 * accept and honour the optional `TaskTransitionOptions` argument. The type
 * system cannot hold you to this: an implementation taking only `(id, output)`
 * structurally satisfies the interface, and JavaScript discards the extra
 * argument in silence. A ref that ignores the options throws on a task someone
 * else already settled, and that throw escapes the task board's per-worker
 * rescue and abandons every sibling task on the board — the exact failure the
 * options exist to contain. It also leaves ownership unchecked, so a worker's
 * write lands on whichever task the caller named. See `TaskTransitionOptions`
 * for the two guards, and evaluate both inside your atomic write so the check
 * cannot race the write it guards.
 */
export interface TaskCollectionRef<TInput = unknown, TOutput = unknown> {
  /** Stable identifier — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;

  /**
   * The clock this collection stamps and judges leases against (FIX-1005).
   *
   * **Exposed because a lease is a comparison, and a comparison needs one
   * clock.** `leaseUntil` is written by the claim write against this clock, so
   * anything asking "has this lease run out" — the board's wake probe, the
   * ready-task preview, a dispatcher's candidate scan, the renewal driver
   * deciding when to write next — has to ask the same one. Reading
   * `Date.now()` instead works right up until a collection is built on an
   * injected clock, at which point the two sides silently answer different
   * questions: a live task can read as abandoned and an abandoned one as live.
   *
   * That divergence is invisible in production, where every clock is the wall
   * clock. It is *only* visible under an injected clock — which is what tests
   * use. So the failure mode is a lease test that passes without exercising a
   * coherent timeline at all, which is the last test you want to be wrong.
   *
   * Implementing this interface yourself? `now: () => Date.now()` is the right
   * answer unless you have a reason for another.
   */
  readonly now: () => number;

  /**
   * The cumulative retry budget this ref actually enforces (FIX-948), or `null`
   * when none is in force.
   *
   * Read by the board's completion item so the retry count it reports is never
   * mistaken for evidence that a budget applied. It is exposed **here**, where
   * enforcement lives, rather than derived from the board's own config, because
   * a board handed a collection it did not construct knows nothing about that
   * collection's caps — and a caller who builds one deliberately
   * (`getOrCreateTaskCollection({ backing: "request", maxTotalRetries: 5 })`)
   * would otherwise be told "no limit" about a limit they set themselves.
   *
   * `null` means exactly one thing everywhere: no limit is in force. That covers
   * both an explicit opt-out and a backing that counts retries without enforcing
   * them (the resource backing), so there is no third "unknown" state. If you
   * implement this interface yourself and enforce no budget, report `null`.
   */
  readonly maxTotalRetries: number | null;

  // creation
  addTask(task: TaskInit<TInput>): Promise<Task<TInput, TOutput>>;
  addTasks(tasks: TaskInit<TInput>[]): Promise<Task<TInput, TOutput>[]>;

  // lifecycle
  claim(workerId: string, options?: ClaimOptions): Promise<Task<TInput, TOutput> | null>;
  /**
   * Mark the task completed with `output`.
   *
   * Throws on an illegal transition. Pass `options` to make the write
   * advisory instead — see `TaskTransitionOptions`. An advisory decline is
   * reported on the returned {@link TaskWriteOutcome}; discarding it is
   * supported and behaves exactly as before.
   */
  complete(
    id: string,
    output: TOutput,
    options?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome>;
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
   *
   * An advisory decline is reported on the returned {@link TaskWriteOutcome},
   * from whichever branch ran; discarding it is supported and behaves exactly
   * as before.
   */
  fail(
    id: string,
    error: string,
    options?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome>;
  // The four parking/review transitions. Each takes the same optional
  // `TaskTransitionOptions` the settlement methods take (FIX-981) — a worker
  // parking or resuming its own task is as much an ownership-dependent write as
  // completing it, and before the ticket these four had no parameter to carry
  // one. All four report a {@link TaskWriteOutcome}; discarding it behaves
  // exactly as the previous `void` return did.
  block(id: string, reason?: string, options?: TaskTransitionOptions): Promise<TaskWriteOutcome>;
  unblock(id: string, options?: TaskTransitionOptions): Promise<TaskWriteOutcome>;
  awaitReview(
    id: string,
    feedback?: string,
    options?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome>;
  resumeFromReview(
    id: string,
    feedback?: string,
    options?: TaskTransitionOptions
  ): Promise<TaskWriteOutcome>;
  /**
   * Cancel the task (terminal).
   *
   * Advisory by construction: cancelling an already-settled task writes
   * nothing. Since FIX-976 it also **says so** — the returned
   * {@link TaskWriteOutcome} is `declined` with reason `terminal`, instead of
   * returning silently and leaving the caller to infer success. Discard the
   * verdict and behaviour is exactly as before.
   *
   * `options.ifAllowed` is forced on regardless of what you pass, which is what
   * "advisory by construction" means here. `options.claim` is honoured, so a
   * worker cancelling through this method is held to the same ownership check
   * as one completing through `complete` (FIX-981).
   */
  cancel(id: string, reason?: string, options?: TaskTransitionOptions): Promise<TaskWriteOutcome>;
  /**
   * Push this task's lease out to `leaseUntil` — the worker saying "still
   * here" about a row it already proved it owns (FIX-1005).
   *
   * This is what makes an expired lease mean something. Nothing used to renew
   * a lease, so an expired one was the *normal* condition of a perfectly
   * healthy worker and could not be acted on. Once the holder keeps it alive,
   * silence means the holder is gone, and `claim` can simply hand the row out
   * again.
   *
   * Writes exactly **one** field. Not `attempts`, not `status`, and nothing a
   * consumer reads as progress. It publishes no `task-change` item, because a
   * renewal is not a lifecycle change — the task did not move.
   *
   * `options.claim` is **required**: renewal is an ownership assertion, so an
   * unfenced one would let anything keep anyone's lease open. The write runs
   * the same guards every other worker-callable write runs, so it declines
   * `terminal` on a cancelled task, `not-my-task` on a recreated row, and
   * `lost-claim` when the caller no longer holds it — **including the case
   * that motivated the verb: a renewal that commits *after* the lease it was
   * extending.** Without that arm a late renewal would install a fresh
   * deadline on a row somebody else now holds.
   *
   * Throws — never declines — on a non-finite `leaseUntil` or a missing
   * ticket. Both are programming errors rather than lost races, matching this
   * repo's posture for a numeric argument outside its domain.
   *
   * **If you implement this interface yourself, the obligation is three-sided
   * and the last two are easy to miss.** You implement this write; your own
   * `claim()` must consider expired rows, fence the takeover on the attempt,
   * and settle a row whose abandonment allowance is spent instead of running
   * it; and every ticket-fenced write you accept must refuse a claimant whose
   * lease has already lapsed. A ref that implements only this verb compiles,
   * renews correctly, and silently never recovers anything.
   */
  renewLease(
    id: string,
    leaseUntil: number,
    options: TaskTransitionOptions & { claim: TaskClaimTicket }
  ): Promise<TaskWriteOutcome>;
  /**
   * Reset stale leases. Tasks whose `leaseUntil` has passed are returned
   * to `pending`. Returns the number of tasks reclaimed; emits one
   * `task-change(kind: 'resumed', prevStatus: 'in_progress')` per reset
   * — the same kind used by `resumeFromReview` since the lifecycle UI
   * cares only that the task is back to pending.
   *
   * Not the recovery path. Since FIX-1005 an abandoned row is recovered inside
   * `claim`, so nothing has to call this for you; the verb is unchanged and
   * stays available for a caller that wants to reset leases by hand.
   *
   * **It is the UNBOUNDED way back to `pending`, and deliberately so.** The
   * automatic recovery `claim` performs is bounded — `DEFAULT_MAX_ABANDONMENTS`
   * re-dispatches, after which the row settles `errored` rather than being
   * handed out again. This verb does not count against that budget, so a
   * caller that keeps calling it on a row whose worker keeps dying will keep
   * re-dispatching it past the bound, and the failure will present as a spent
   * `maxAttempts` instead of an abandonment cap.
   *
   * That is the same stance `unblock` and `resumeFromReview` already take, and
   * for the same reason: a bound exists to make a judgment nobody is present to
   * make, and a caller invoking this verb by hand *is* present. Counting it
   * would settle a task an operator explicitly asked to requeue.
   *
   * So the promise is precise: recovery **the substrate performs on its own**
   * is bounded. A sweeper built on this verb opts out of that bound — which was
   * the only way to recover anything before FIX-1005, and is now a manual
   * override rather than the mechanism. If bounded recovery is what you want,
   * delete the sweeper and let `claim` do it.
   */
  reclaim(now?: number): Promise<number>;

  // mutation
  //
  // All five report a {@link TaskWriteOutcome}, so ONE return convention covers
  // the whole patch surface rather than two conventions on five methods sharing
  // one helper.
  //
  // Exactly ONE of them refuses anything: `setAssignee`, which declines on a
  // terminal task and — on a board that runs detached work — on every task.
  // The other four deliberately keep writing to terminal tasks — labelling,
  // re-prioritizing, or annotating a finished task is a real and used thing (a
  // post-drain failure audit, a cascade's `skipped` marker) — so they can only
  // ever answer `recorded` or `unchanged`.
  /**
   * Set the task's assignee.
   *
   * **Declines on a terminal task** (`completed` / `errored` / `cancelled`) —
   * reassigning work that will never run again is a write no caller can act on.
   * Returns `unchanged` when the assignee already matches, `recorded` when it is
   * written.
   *
   * **Declines every reassignment on a board that runs detached work**
   * (`immutable-assignee`, FIX-982). The assignee is what a detached task's
   * routing coordinate is derived from, and the child session that coordinate
   * addresses is keyed the moment the work is dispatched. Changing it afterwards
   * does not redirect anything: the work already in flight keeps running under
   * the old coordinate, and the new one addresses a session nothing will ever
   * wake. The failure is invisible from the caller's side — the write succeeds,
   * the task simply never runs — so the write is refused instead.
   */
  setAssignee(id: string, assignee: string): Promise<TaskWriteOutcome>;
  setPriority(id: string, priority: number): Promise<TaskWriteOutcome>;
  addLabel(id: string, label: string): Promise<TaskWriteOutcome>;
  removeLabel(id: string, label: string): Promise<TaskWriteOutcome>;
  patchMetadata(id: string, patch: Record<string, unknown>): Promise<TaskWriteOutcome>;

  // query
  get(id: string): TaskHandle<TInput, TOutput> | undefined;
  list(filter?: TaskFilter): TaskHandle<TInput, TOutput>[];
  count(filter?: TaskFilter): number;
}
