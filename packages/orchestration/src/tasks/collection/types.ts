/**
 * `TaskCollectionRef` — uniform API across both backings (FIX-443 §3.3).
 *
 * The same shape is returned from `getOrCreateTaskCollection` regardless
 * of how the collection is stored (atomic state — a ref, or the request — vs
 * resource).
 * Patterns and claim orders consume `TaskCollectionRef` and never reach for
 * the underlying storage directly.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { TaskClaimTicket } from "../claim-ticket";
import type { Task, TaskRunLink, TaskStatus } from "../schema/task";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import type { TaskSettingsPatch } from "./internal";
import type { SteerInput } from "../steers";
import type { QuestionInit, SuspensionHold } from "../schema/hold";
import type { QuestionAnswer } from "./holds";
import type { NoticeEnding as TaskNoticeEnding } from "../notice/task-notice";

/**
 * How a cancel was made (FIX-2081), as `Task.cancelledVia` records it:
 * `"tool"`, a model's `updateTask` inside its filer's turn; `"action"`, a
 * public `updateTask_<board>` action, a screen's or an app's.
 */
export type TaskCancelSource = "tool" | "action";

/** {@link TaskCollectionRef.cancel}'s options: the guards, and how the cancel was made. */
export type CancelOptions = TaskTransitionOptions & {
  /**
   * Written on the row as `cancelledVia`. Set by the `updateTask` block from
   * how it was built (a tool, or an action), never from input (BP-031).
   */
  readonly via?: TaskCancelSource;
  /**
   * The cancel is a confirm's No (FIX-2133, owner 2026-10-25): it lands only
   * while this row hold is open, decided on the committed row in the cancel's
   * own write, as an answer is. Declines `answered` once the hold has an
   * answer (a yes first, say), and `no-such-question` for an id that isn't a
   * question or a confirm on the row.
   */
  readonly whileHoldOpen?: string;
};

/** What a running task waits on (`Task.keptOpenBy`, FIX-2077). */
export type TaskKeptOpenBy = NonNullable<Task["keptOpenBy"]>;

/** What a running task's worker reports (FIX-2081, `reportProgress`). */
export interface TaskProgress {
  /** A one-line note for task views. Never the task's status. */
  readonly statusNote?: string;
  /** A checkpoint of the result so far: the task's output from then on. */
  readonly output?: unknown;
}
import type { TaskWriteToken } from "../write-provenance";
import type { TaskSpendWrite } from "../spend";

/**
 * Why a write was refused (FIX-976; `not-my-task` added by FIX-981;
 * `immutable-assignee` by FIX-982). Resolved in a **fixed precedence order** —
 * `immutable-assignee` → `terminal` → `not-my-task` → `disallowed` →
 * `lost-claim` — so a decline where two conditions hold always reports the
 * same one, and two callers cannot render two different messages for the same
 * refusal.
 *
 * - `immutable-assignee` — the board dispatches work, and an attempt holds the
 *   task (`in_progress`): its dispatch is keyed by the assignee it was claimed
 *   with. A pending or held task can change hands (FIX-1780).
 * - `terminal` — the task had already reached `completed` / `errored` /
 *   `cancelled`. The majority of the exposure, but not all of it.
 * - `not-my-task` — the presented `claim` names a different board, a different
 *   task, or a task since recreated under the same id. The write targets a row
 *   the caller never held.
 * - `disallowed` — the state machine rejects the move from a **non**-terminal
 *   status (`pending → errored`, `held → errored`).
 * - `lost-claim` — the presented `claim` names this task but no longer owns it:
 *   it was reclaimed or re-queued while the caller was working, or its lease
 *   ran out while it was still `in_progress`.
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
 * **Where `immutable-assignee` sits.** It holds only for `in_progress`, and
 * `terminal` only for a settled task, so the two never compete and either order
 * reports the same reason. It reads the status inside the atomic write, like
 * `terminal`, so a claim that lands first is what the decline reports.
 */
export type TaskWriteDeclineReason =
  | "immutable-assignee"
  | "terminal"
  | "not-my-task"
  | "disallowed"
  | "lost-claim"
  /**
   * An assignee change on a follow-up (FIX-1817): it runs in the session of
   * the task it follows, with that task's worker, so it keeps its assignee.
   */
  | "follow-up"
  /**
   * An edit of a filing's start or attempts settings on a task that has
   * already started (FIX-2080, ER-4): a retry's return to `pending` does not
   * reopen them. A started task takes a cancel.
   */
  | "started"
  /**
   * A completion fenced with `refuseUntakenSteers` on a task holding a steer
   * no request of its attempt took (FIX-2086 D2): the steer is owed a turn
   * before the task settles.
   */
  | "untaken-steers"
  /**
   * A steer past the most a task takes (`MAX_STEERS`, FIX-2086 D1): cancel
   * it and file it again, or file a follow-up once it ends. Each open question
   * keeps its answer's place under the cap (FIX-2133), so questions that
   * would take the row past it are refused this way too.
   */
  | "steer-limit"
  /**
   * The row is held (FIX-2133, `Task.questions`): a settlement, a lease renewal or
   * a turn's mirror of its stop, refused while a hold is open. A held row
   * settles only by cancel; it starts no turn and renews no lease until its
   * holds close. Its open holds come from one source at a time, so a turn that
   * waits once can't wait again.
   */
  | "open-question"
  /** An answer to a question already answered with other words, or by another sender (FIX-2133). */
  | "answered"
  /** An answer naming no question or confirm on the row (FIX-2133). */
  | "no-such-question";

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

/** What {@link TaskCollectionRef.markWait} takes the row's wait slot with (FIX-2082; see `Task.wait`). */
export interface TaskWaitSlot {
  /** The gate the waiting request parks on: unique within its session. */
  readonly gateId: string;
  /** When the wait resumes with the row still running (epoch ms). */
  readonly deadline: number;
  /** The waiting request, server-derived (`ctx.request.identity.id`). */
  readonly requestId: string;
  /** The waiting request is a plan's drain, on a row it handed over (see `Task.wait.drain`). */
  readonly drain?: true;
}

/** Options for `claim` — let the claim order narrow eligibility and tweak ordering. */
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
   * jobs unrecoverable for that claim order, because the row it must match is
   * `in_progress`. Claimability is the substrate's call — `isClaimable` — and
   * composing rather than replacing is what stops the newest invariant being
   * the one most easily switched off by accident.
   *
   * `rows` is the board as the claim write reads it (FIX-2080), so a
   * predicate that depends on other rows (one open task per session) is
   * decided against the same state as the claim.
   */
  eligibility?: (task: Task, rows: readonly Task[]) => boolean;
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
 * recorders, a claim order's claim/execute cycle — where the task may have
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
   *   equals the ticket's attempt *and* the task is still `in_progress`.
   *   The status half is not belt-and-braces: `reclaim()`
   *   returns a task to `pending` without advancing `attempts`, so between a
   *   reclaim and the next claim a displaced worker matches the counter by
   *   construction — and since `held` is reachable only from `pending`, a
   *   counter-only guard would let a stale worker silently settle work a
   *   coordinator held.
   *
   * Omit it and no ownership question is asked, which is the correct posture
   * for a coordinator writing to a board it never claimed from.
   */
  claim?: TaskClaimTicket;
  /**
   * Decline a `complete` while the task holds a steer no request of its
   * attempt took (FIX-2086 D2), reason `untaken-steers`. Decided inside the
   * write, so a steer that lands after the caller's own read still holds the
   * task open. Pass it only where something then owes the steer a turn.
   */
  refuseUntakenSteers?: boolean;
  /**
   * Let a **renewal** take back a row whose lease lapsed while the claim it
   * names stayed intact (FIX-1305).
   *
   * The lease fence declines a ticketed write on a lapsed row because a lapsed
   * lease means the row is the queue's again. That is right for a *result* — a
   * worker that ran past its lease may have been superseded, and the successor
   * owns the outcome — and it is too strong for a claimant that has not started
   * yet. A task handed to a child session is the case: nothing renews the row
   * between the parent's release and the child's first breath, so a child that
   * waits in the host's queue longer than the lease arrives to a lapsed row
   * that **no one has taken** — same `attempts`, same `createdAt`, same
   * incarnation, still `in_progress`.
   *
   * With this set, that renewal is decided by the race instead of by the
   * clock: every other guard still runs inside the same atomic write, so it is
   * recorded only while the identity the ticket names is still the row's, and
   * declines `lost-claim` the moment a reclaim has moved `attempts` or the
   * status. Winning the write **is** the takeover — the caller holds the row
   * for another lease span, on the same attempt.
   *
   * **Opt-in, because the substrate cannot tell the two lapsed claimants
   * apart.** A stalled worker whose renewal timer finally fired presents the
   * same evidence as the queued child above, and only the second should take
   * the row back: the first has been running against a row the queue may have
   * re-dispatched. So the caller asserts "I have not started yet", which is
   * something only it knows.
   *
   * Honoured **only on a renewal** — the one write that targets `in_progress`.
   * Passing it to a settlement changes nothing: `complete` and `fail` on a
   * lapsed row still decline `lost-claim`.
   */
  adoptLapsedLease?: boolean;
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
   * object. `createTask`, `createTasks`, `claim`, `reclaim` and the five field
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
  /**
   * A cancel made through a model's `updateTask` tool (FIX-2078 D2). Set by
   * the task tools only, from how the block was built, never from input: the
   * tools are blocks for a model's turn, and an app's or a person's cancel goes
   * through `taskToolActions`, which never sets it. When the running
   * session is the row's filer, the call's result is how it hears the cancel,
   * so the cancel owes it no notice.
   */
  viaTool?: boolean;
  /**
   * @internal Refuse the write `held` while the row is held (FIX-2133):
   * `"any"` hold (a lease renewal), or an open `"row"` hold (the claim gate's
   * mirror of its run's stop, one source at a time). Decided on the committed
   * row inside the write. Set by the backings' own verbs, never by a caller.
   */
  refuseWithOpenHold?: "any" | "row";
}

/**
 * `fail`'s options: the ordinary transition guards, plus whether this failure
 * may be retried at all.
 */
export interface FailOptions extends TaskTransitionOptions {
  /**
   * Settle the task `errored` even though it has attempts left: the failure is
   * one no retry can change, such as a run refused before it started because
   * it names nothing it may work on. Without it, a task with attempts left is
   * re-queued and refused the same way on every one. Every guard still runs
   * inside the same write, so a stale holder's `noRetry` failure is declined
   * like any other.
   */
  noRetry?: boolean;
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
 * append to the same window. Items the substrate emitted about itself are
 * excluded — `task-change`, `task-board-meta` and
 * `task-board-recorder-failure` — because they are the board's events, not
 * the worker's.
 *
 * Mutators (`claim`, `createTask`, ...) still return raw `Task`. The
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
 * `cancel` — should
 * accept and honour the optional `TaskTransitionOptions` argument. The type
 * system cannot hold you to this: an implementation taking only `(id, output)`
 * structurally satisfies the interface, and JavaScript discards the extra
 * argument in silence. See `TaskTransitionOptions` for the guards, and evaluate
 * them inside your atomic write so the check cannot race the write it guards.
 *
 * ### What the substrate guarantees, and what you still owe
 *
 * **Guaranteed — for one class of throw, not for every failure.** The
 * substrate's advisory write-backs contain a throw they can attribute to a
 * decline a conforming store would have made before committing anything: the
 * late result is dropped and the drain finishes its other tasks. So a ref that
 * ignores the options no longer abandons every sibling task the first time a
 * worker's result arrives late — the write-back *conflict* is contained.
 *
 * That is the whole of it. A store that is unreachable, or that commits and then
 * fails on the way out, still throws through to the caller and can still fail
 * the drain, because neither is a task-state conflict and silencing them would
 * lose real failures. Don't read this as fault isolation from your store.
 *
 * **Still yours:** the write's correctness. Containment fires on a *throw*, and
 * plenty of wrong writes don't throw. A worker reporting success on a task
 * another worker has since taken over is an ordinary `in_progress → completed`,
 * so an unguarded ref commits it and overwrites the holder's result; nothing
 * outside your atomic section can see that, let alone stop it. Ownership goes
 * unchecked the same way — a worker's write lands on whichever task the caller
 * named.
 *
 * So the options are no longer what keeps a board alive. They are what keeps its
 * tasks' outcomes true.
 */
export interface TaskCollectionRef<TInput = unknown, TOutput = unknown> {
  /** Stable identifier — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;

  /**
   * The partition this ref reads and writes, on a ledger declared with
   * `partitionBy`; absent on every other ledger.
   *
   * A ref over a partitioned ledger reaches only its partition's rows, for
   * every operation. Exposed so a claim made through the ref can name the
   * partition it was made in: a board's dispatch puts it on the dispatch, and
   * the receiving gate reads the row there.
   */
  readonly partition?: string;

  /**
   * The clock this collection stamps and judges leases against (FIX-1005).
   *
   * **Exposed because a lease is a comparison, and a comparison needs one
   * clock.** `leaseUntil` is written by the claim write against this clock, so
   * anything asking "has this lease run out" — the board's wake probe, the
   * ready-task preview, a claim order's candidate scan, the renewal driver
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
   * (`getOrCreateTaskCollection({ backing: "state", maxTotalRetries: 5 })`)
   * would otherwise be told "no limit" about a limit they set themselves.
   *
   * `null` means exactly one thing everywhere: no limit is in force. That covers
   * both an explicit opt-out and a backing that counts retries without enforcing
   * them (the resource backing), so there is no third "unknown" state. If you
   * implement this interface yourself and enforce no budget, report `null`.
   */
  readonly maxTotalRetries: number | null;

  // creation
  createTask(task: TaskInit<TInput>): Promise<Task<TInput, TOutput>>;
  createTasks(tasks: TaskInit<TInput>[]): Promise<Task<TInput, TOutput>[]>;

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
   *   `errored` with the error captured on `task.error`. `options.noRetry`
   *   makes it a hard fail whatever budget is left.
   *
   * An advisory decline is reported on the returned {@link TaskWriteOutcome},
   * from whichever branch ran; discarding it is supported and behaves exactly
   * as before.
   */
  fail(
    id: string,
    error: string,
    options?: FailOptions
  ): Promise<TaskWriteOutcome>;
  /**
   * Hold a task that hasn't started (FIX-2080): `pending → held`, so it
   * doesn't start until {@link release}. The guarded settings write
   * ({@link patchSettings}) with `held: true`, under a named entry point.
   *
   * Declines `started` on a row that has ever started (a retry's return to
   * `pending` included), and `terminal` on an ended one. `unchanged` on a row
   * already held. Publishes `held`.
   */
  hold(id: string): Promise<TaskWriteOutcome>;
  /**
   * Release a held task (FIX-2080): `held → pending`, so it starts once its
   * `deps` have finished. {@link patchSettings} with `held: false`. Every
   * release of a held row publishes `released`, whoever releases it.
   * `unchanged` on a row that isn't held.
   */
  release(id: string): Promise<TaskWriteOutcome>;
  /**
   * Change a filing's start or attempts settings while the task has never
   * started (FIX-2080, ER-4): `held`, `deps` (replaced whole), `maxAttempts`.
   * The one guard every edit of a filing goes through, inside the write.
   *
   * Declines `started` on a row that has ever started and `terminal` on an
   * ended one; `unchanged` when nothing changes. Dependencies are checked as
   * a filing's are, and a refusal throws `TaskFilingRefusedError` naming the
   * rule. Publishes `held` or `released` when the status moves, else
   * `settings_changed`.
   */
  patchSettings(id: string, patch: TaskSettingsPatch): Promise<TaskWriteOutcome>;
  /**
   * Steer an open task (FIX-2086): keep `steer` on the row (`Task.steers`),
   * for every later attempt to read. Changes nothing else: no status, no
   * claim, no lease, no attempt count, and no ending. A row running nothing
   * while it waits on work it filed (`keptOpenBy: "filed"`) waits on the steer
   * instead, in the same write: a turn is owed for it, which its caller
   * starts.
   *
   * Declines `terminal` on a finished row, so a finished task's output never
   * changes, and `steer-limit` past `MAX_STEERS`. `unchanged` for a `key`
   * already kept. Publishes `steered`.
   *
   * Optional, so a ref written before it keeps compiling (BP-030); a steer
   * is refused on a board without it.
   */
  steer?(id: string, steer: SteerInput): Promise<TaskWriteOutcome>;
  /**
   * Take the steers that arrived since the claim (FIX-2086): mark each steer
   * no request of the claim's attempt has taken as taken by it, in the read
   * named `takenIn`. Read them back with `steersTakenIn`. A steer this attempt
   * took already, in any read, stays as it is.
   *
   * Fenced like {@link linkRun}: `options.claim` is required, the row must be
   * `in_progress`, and the write declines `terminal`, `not-my-task` or
   * `lost-claim` otherwise. `unchanged` when nothing was untaken. A recorded
   * take names the steers this write took (`taken`, by id): a concurrent read
   * under the same name, or a re-run of it, took none and names none.
   * Publishes no `task-change`.
   *
   * Optional, so a ref written before it keeps compiling (BP-030).
   */
  takeSteers?(
    id: string,
    options: { claim: TaskClaimTicket; takenIn: string }
  ): Promise<TaskWriteOutcome & { readonly taken?: readonly string[] }>;
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
  cancel(id: string, reason?: string, options?: CancelOptions): Promise<TaskWriteOutcome>;
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
   * {@link TaskTransitionOptions.adoptLapsedLease} is the one opt-out of that
   * last arm, for a claimant that has not started yet — see it for why the
   * choice cannot be made down here.
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
   * Record which run is working this task — the run naming itself on the row
   * (FIX-1668). The board's claim gate calls it inside the run's own session,
   * before the worker's first step, on every dispatched attempt.
   *
   * Writes exactly **one** field, `run`, on an `in_progress` row the caller
   * holds, and publishes one `task-change` of kind `run_linked` — on the
   * session of the context the collection was resolved in, which at the gate
   * is the run's own.
   *
   * Fenced exactly like {@link renewLease}: `options.claim` is required, and
   * the write declines `terminal` on a settled row, `not-my-task` on a
   * recreated one, and `lost-claim` when a reclaim moved the attempt or the
   * lease has lapsed. `adoptLapsedLease` is ignored here: a lapsed claimant
   * takes the row back with a renewal first, then links.
   *
   * Nothing else clears the field but the next claim (`applyClaimToTask`), and
   * no caller-facing write surface reaches it.
   *
   * Throws — never declines — on a missing ticket.
   *
   * **If you implement this interface yourself, implement this verb too:** a
   * board that dispatches calls it on every attempt, and a declined or missing
   * verdict stops that attempt before the worker runs.
   */
  /**
   * Report a running task's progress (FIX-2081): `statusNote`, a one-line
   * note for task views, and `output`, a checkpoint of the result so far.
   * The worker's `reportProgress` tool calls it, for the row its request
   * holds.
   *
   * Fenced like {@link linkRun}: `options.claim` is required, the row must be
   * `in_progress`, and the write declines `terminal` on a finished row,
   * `not-my-task` on a recreated one, and `lost-claim` once a reclaim moved
   * the attempt or the lease lapsed. Neither field changes the status.
   *
   * A checkpoint is the task's output from then on (`Task.checkpointed`):
   * {@link complete} keeps it rather than writing the final result, and a
   * failed attempt keeps it for the next. Publishes `progress_reported`.
   *
   * Optional, so a ref written before it keeps compiling (BP-030); the tool
   * refuses on a board without it.
   */
  reportProgress?(
    id: string,
    progress: TaskProgress,
    options: { claim: TaskClaimTicket }
  ): Promise<TaskWriteOutcome>;
  /**
   * Record what a request admitted for the task has spent (FIX-2288): its
   * live part while it runs, or what an ending handed on, settled into the
   * request's settled part with its live part cleared, in one write. Only the
   * task's run calls it (`task-board/task-request.ts`); read it folded with
   * `taskSpendView`.
   *
   * **Fenced by the row's identity only**: `options.claim` is required and a
   * recreated row declines `not-my-task`, but a terminal row and a lapsed or
   * moved-on claim still take it. A spend is history: a failed attempt's
   * tokens land after its row may have settled, and they count. `unchanged`
   * when the write changes nothing. Publishes no `task-change`.
   *
   * Optional, so a ref written before it keeps compiling (BP-030); a task on a
   * board without it shows no spend.
   */
  recordSpend?(
    id: string,
    write: TaskSpendWrite,
    options: { claim: TaskClaimTicket }
  ): Promise<TaskWriteOutcome>;
  linkRun(
    id: string,
    run: TaskRunLink,
    options: TaskTransitionOptions & { claim: TaskClaimTicket }
  ): Promise<TaskWriteOutcome>;
  /**
   * Record what a running task waits on, or that it waits on nothing again
   * (FIX-2077 D1). The claim gate calls it for the request it admitted: at the
   * request's end when the task is not done, and at the next request's
   * admission.
   *
   * - `keptOpenBy` set: the row keeps its claim and drops its lease
   *   (`leaseUntil`), so no reclaim takes it back, unless `options.leaseUntil`
   *   is given. `options.answer` is that
   *   request's result, kept as the output (unless this attempt reported a
   *   checkpoint, which stays the output), for the settle that follows.
   * - `null`: the field clears and the row holds a lease again, to
   *   `options.leaseUntil` (required then). The committed span
   *   (`leaseDurationMs`) is the claim's, unchanged.
   *
   * Fenced like {@link linkRun}: `options.claim` is required, the row must be
   * `in_progress`, and the write declines `terminal`, `not-my-task` or
   * `lost-claim` otherwise. A clear does not require the row to be waiting:
   * the gate clears only a row it read as waiting, and that two requests never
   * clear one row at once rests on the task session running its notices and
   * messages one at a time, not on this write. Publishes no `task-change`, as
   * a renewal doesn't, so a screen showing a running row's kept `output` reads
   * it stale until the row's next change.
   *
   * Optional, so a ref written before it keeps compiling (BP-030); the gate
   * then keeps the lease as before.
   */
  setKeptOpenBy?(
    id: string,
    keptOpenBy: TaskKeptOpenBy | null,
    options: {
      claim: TaskClaimTicket;
      leaseUntil?: number;
      answer?: { output: unknown };
      /**
       * With a wait: the task run's stop for a person, mirrored on the row as
       * a suspension hold in the same write (FIX-2133). Refused `held` while a
       * row hold is open: the stop arm then cancels the stop.
       */
      hold?: SuspensionHold;
      /**
       * With `null`: the run's own resume, which closes the mirror. A later
       * request admitted while the run stays parked passes none and keeps it.
       */
      resume?: boolean;
      /**
       * With `"steer"`: the turn a steer no request took is owed (FIX-2086
       * D2), marked on the row (`turnOwed`) so the claim can take it when no
       * wake starts it (FIX-2133 D3).
       */
      owesTurn?: boolean;
    }
  ): Promise<TaskWriteOutcome>;
  /**
   * Ask questions midway (FIX-2133): the turn holding the task's claim opens
   * row holds (`Task.questions`), drops the lease and ends its turn unsettled, in
   * one write. The row stays `in_progress` on its attempt with no lease until
   * every question is answered (or a deadline the host set passes), then owes
   * one more turn on that attempt (`turnOwed`), which the claim takes.
   *
   * Fenced like {@link linkRun}: `options.claim` is required, and the write
   * declines `terminal`, `not-my-task` or `lost-claim` (a later turn's claim
   * included) otherwise. Declines `held` while a stop for a person holds the
   * row (one wait per turn), and `steer-limit` when the questions' answers
   * would take the row past `MAX_STEERS` places. A recorded ask names the new
   * holds' ids (`holds`). Publishes `asked`.
   *
   * Optional, so a ref written before it keeps compiling (BP-030); a board
   * without it can't hold a task midway.
   */
  ask?(
    id: string,
    asks: readonly QuestionInit[],
    options: { claim: TaskClaimTicket }
  ): Promise<TaskWriteOutcome & { readonly questions?: readonly string[] }>;
  /**
   * Answer one of the row's questions or confirms (FIX-2133 D1): the answer is
   * kept as a steer carrying the hold's id, from `answer.from`, and joins the
   * brief. The last open row hold's answer lets the work go on in the same
   * write: a task that hasn't started becomes claimable, its first attempt a
   * start; a running one owes one more turn on its same attempt (`turnOwed`).
   *
   * The same words from the same sender again are `unchanged`, even after the
   * task has finished. Declines `answered` for other words or another sender,
   * `terminal` on a finished row, and `no-such-question` for an id that isn't a
   * question or a confirm on it. Who may answer which hold is the caller's
   * rule (the board's `updateTask`); this write never checks a caller.
   * Publishes `answered`.
   *
   * Optional, so a ref written before it keeps compiling (BP-030).
   */
  answer?(id: string, answer: QuestionAnswer): Promise<TaskWriteOutcome>;
  /**
   * A touch of the board (FIX-2133): close every open question past the due
   * time a host set, with the board's "no answer came" steer, which lets the
   * work go on as an answer would. A question with no due time is never
   * closed here. Returns the ids of the rows it wrote, so a board wakes only
   * those.
   *
   * Optional: both built-in backings implement it.
   */
  payHoldDeadlines?(): Promise<string[]>;
  /**
   * Reset stale leases. Tasks whose `leaseUntil` has passed are returned
   * to `pending`. Returns the number of tasks reclaimed; emits one
   * `task-change(kind: 'resumed', prevStatus: 'in_progress')` per reset
   * — the lifecycle UI cares only that the task is back to pending.
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
   * That is the same stance `release` already takes, and
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
  // terminal task and — on a board that dispatches — on a task an attempt holds.
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
   * **Declines on a running task on a board that dispatches**
   * (`immutable-assignee`, FIX-982, narrowed by FIX-1780). The assignee is what
   * a dispatched task's routing key is derived from, and the child session that
   * key addresses is keyed the moment the work is dispatched. Changing it while
   * the attempt runs does not redirect anything: the work in flight keeps
   * running under the old coordinate, and the new one addresses a session
   * nothing will ever wake. So an `in_progress` task is refused. A pending or
   * held task has no attempt; its next claim reads the new assignee, so it can
   * change hands.
   */
  setAssignee(id: string, assignee: string): Promise<TaskWriteOutcome>;
  setPriority(id: string, priority: number): Promise<TaskWriteOutcome>;
  addLabel(id: string, label: string): Promise<TaskWriteOutcome>;
  removeLabel(id: string, label: string): Promise<TaskWriteOutcome>;
  patchMetadata(id: string, patch: Record<string, unknown>): Promise<TaskWriteOutcome>;
  /**
   * Clear the row's resume-owed marker (`Task.resumeOwed`) once its waiting
   * turn has its answer (FIX-1816), and with it the mirror of the stop a
   * cancelled row kept to pay it (its suspension hold, FIX-2129, FIX-2133).
   * `unchanged` when no marker is set.
   *
   * Optional: both built-in backings implement it, together with writing the
   * marker when a waited-on row ends. A hand-written ref that does neither cannot
   * host a wait, and the wait path refuses on it.
   */
  clearResumeOwed?(id: string): Promise<TaskWriteOutcome>;
  /**
   * Mark an open waited-on row as owing its cancel (`Task.cancelOwed`): its wait
   * is over and the cancel the waiting call wrote failed (FIX-1844). The
   * row's next ending, the touch's cancel among them, clears it. `unchanged`
   * on a row that has ended, isn't waited on, or is already marked.
   *
   * Optional, like `clearResumeOwed`: both built-in backings implement it.
   * On a ref without it, a failed cancel leaves the row open, as before.
   */
  markCancelOwed?(id: string): Promise<TaskWriteOutcome>;
  /**
   * The session that filed `row`, by the ledger's delivery rule (FIX-2078):
   * `Task.filer`, or, for a row filed before it, the ledger's legacy filer
   * (BP-030). Present on a ledger a board hands rows out from; absent
   * elsewhere, where `Task.filer` is the whole answer.
   */
  filerOf?(row: Task): string | undefined;
  /**
   * Tell the filer of `row` its open midway questions (FIX-2241), through the
   * ledger's declared `onMidwayQuestion`. Present only on a ledger that declares
   * one; `askMidway` calls it each time a turn asks, a replayed turn included.
   */
  tellMidwayQuestions?(row: Task): Promise<void>;
  /**
   * Take the row's wait slot for a request about to wait on it (FIX-2082):
   * one conditional write, so of two requests that read the slot free, one
   * takes it and the other is refused. A lapsed slot, or a live one this same
   * request holds (a drain waiting again at its deadline), is taken over; the
   * same gate replayed is `unchanged`. Publishes `wait_changed`.
   *
   * Declines `terminal` on a row that has ended (the waiting call reads its
   * ending at once instead), and `disallowed` while another request's wait
   * holds the slot.
   *
   * Optional, like the other wait writes: both built-in backings implement
   * them, and a ref without them can't host a wait, which refuses there.
   */
  markWait?(id: string, slot: TaskWaitSlot): Promise<TaskWriteOutcome>;
  /**
   * At a wait's deadline (FIX-2082): lapse the slot `gateId` holds for
   * `requestId`, the waiting request, in one conditional write that loses to
   * an ending already written. Declines `terminal` on a row that has ended
   * (the ending reached the waiting request, and it reads that instead);
   * `unchanged` when the slot is another gate's or already lapsed. An ending
   * written after this is held for that request, until {@link releaseWait}.
   */
  lapseWait?(id: string, gateId: string, requestId: string): Promise<TaskWriteOutcome>;
  /**
   * Release a lapsed slot (FIX-2082) for the request it was lapsed for: that
   * request read the row (`read`), so an ending it held is delivered; or it
   * ended without reading it, so the held ending is owed to the filer's
   * notice, its wake owed first. The slot clears either way. `unchanged` when
   * the slot is not a lapsed one that request holds.
   */
  releaseWait?(id: string, release: { readonly requestId: string; readonly read: boolean }): Promise<TaskWriteOutcome>;
  /**
   * The filer's wait found the row already ended and returned it (FIX-2112):
   * drop the notice the ending owes the filer, which that answer delivered.
   * `unchanged` when the row owes none for its ending, or its notice is taken
   * ({@link takeNotice}): that notice is the delivery. Server-owned, as the
   * other wait writes are: a caller's `patchMetadata` can't clear a notice.
   *
   * Optional: both built-in backings implement it. On a ref without it the
   * filer hears the ending again, as `onTaskSettled`.
   */
  dropNoticeReadByWait?(id: string): Promise<TaskWriteOutcome>;
  /**
   * Take a notice the row owes, for the `onTaskSettled` request `take.by`
   * that is about to deliver it (FIX-2123), in one conditional write: a wait's
   * drop ({@link dropNoticeReadByWait}) and a take never both go through.
   * `unchanged` when the row no longer owes it, or another request holds it,
   * other than `take.replacing` (a taker the caller found has ended). The
   * request that took it clears the marker once its block has run.
   *
   * Optional: both built-in backings implement it. On a ref without it a
   * notice is admitted with no take, as before.
   */
  takeNotice?(
    id: string,
    notice: { readonly attempt: number; readonly ending: TaskNoticeEnding },
    take: { readonly by: string; readonly replacing?: string }
  ): Promise<TaskWriteOutcome>;
  /**
   * A touch of the board: pay every cascade owed past its due time
   * (`Task.cascadeOwed`, FIX-2080 D2), so one a crash left owed is paid.
   * Returns how many were paid. Whatever touches a board calls it: a board's
   * drain, an action on it.
   *
   * Optional: both built-in backings implement it, and pay each ending's
   * cascade in that ending's own pass besides.
   */
  payOwedCascades?(): Promise<number>;

  /**
   * Bring one row up to its committed state (FIX-2082). A request reads a
   * durable board as the snapshot it first took, so an ending another request
   * wrote since is invisible to {@link get} until this runs. Reading a task
   * whole (`getTask`) calls it first. Writes nothing.
   *
   * Optional: the resource-backed board implements it. A board kept in the
   * request's own state is never behind.
   */
  refresh?(id: string): Promise<void>;

  // query
  get(id: string): TaskHandle<TInput, TOutput> | undefined;
  /**
   * The row as stored now (FIX-2086), where {@link get} reads it as this
   * request first did: another request's write (a steer sent while this one
   * runs) is read here. Optional, so a ref written before it keeps compiling
   * (BP-030); a caller falls back to `get`.
   */
  getCommitted?(id: string): Promise<TaskHandle<TInput, TOutput> | undefined>;
  list(filter?: TaskFilter): TaskHandle<TInput, TOutput>[];
  count(filter?: TaskFilter): number;
}
