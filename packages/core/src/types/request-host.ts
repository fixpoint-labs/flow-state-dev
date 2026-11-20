// FIX-2129; FIX-2078 D1; FIX-2082; FIX-2160 D2; FIX-999.
/**
 * The request host — the single declared seam through which a capability reaches
 * facilities only the runtime can provide.
 *
 * A capability's helper functions are typed against the context `core` declares,
 * and `core` must not depend on `engine`. Some helpers need to start a child
 * request, settle a durable row owned by another session, or ask whether work
 * they dispatched is still running — all of which live on the engine's context
 * type. Before this seam the only route was a cast, and a cast holds nothing:
 * nothing warns when the shape it asserts stops being true.
 *
 * So `core` names the interface and `engine` implements it. The package graph is
 * untouched.
 *
 * **What crosses is behaviour, not handles.** No type in this file names a store,
 * a flow instance, a session record, or a task. A value read from another
 * session crosses as `unknown` and the consumer parses it with its own schema —
 * `core` cannot name `orchestration`'s types either. The one read of another
 * session's record, `sessions.read`, answers only what that session's flow
 * declares readonly, never the record.
 *
 * **Identity is never a parameter, and neither is a session id**, but for a
 * target the running principal already owns: the dispatch seam's `{ id }`
 * target, and `sessions.read`. Both refuse any session but the principal's own,
 * in its tenant and org, and answer such a one as absent. Every operation
 * closes over the running request's server-derived identity (tenant, user, org,
 * session, flow). A caller supplies the *target* of an operation and never the
 * *authority* for it: it hands over a routing seed and the seam derives the child
 * session key from that seed together with the running request's principal *and*
 * parent session. Another user's session is not a value a capability can produce,
 * and neither is another parent session's child.
 *
 * The seam is **closed at eight verbs**. The fifth, `resumeWait`, was added by
 * a reviewed decision (a wait: a dispatched task the caller waits on), with one
 * fact beside it, `hasWaitSweeper`, which says whether a wait can be bounded
 * here; a later decision widened it to cancel a wait for a user, rather than
 * add a verb. The sixth, `wakes`, by another (a debt's due time is a wake the
 * engine keeps). The seventh, `waits`, by another (one wait gate: its deadline
 * bounds and the depth the engine counts). The eighth, `sessions`, by another:
 * a message's server checks a target session of the
 * principal's before anything is written. Adding a ninth verb is a decision
 * someone reviews, not a surface that grows by transitivity; a later lookup of
 * the principal's sessions extends `sessions` instead.
 */

import type { WaitGateBinding, WaitOutcome, TaskAddress } from "./wait-gate";
import type { HistoryTurn, MessageLimit } from "./scope";
import type { RequestStatus } from "./request";
import type { PendingUserSuspension, PendingUserSuspensionCursor } from "./suspension";
import type { InternalBlockContext } from "./block";

/** How a parent-board row is being settled. */
export type ParentTaskOutcome = "complete" | "fail";

/** Arguments to {@link RequestHost.settleParentTask}. */
export type SettleParentTaskInput = {
  readonly outcome: ParentTaskOutcome;
  /** Result payload for a completion. Opaque to the seam. */
  readonly output?: unknown;
  /** Failure detail for a failed settlement. */
  readonly error?: string;
};

/**
 * Outcome of a settlement. A refusal means the substrate's fence rejected the
 * write — normally because this child's lease was reclaimed and a successor holds
 * the current attempt.
 */
export type SettleParentTaskResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refused: "fence-rejected" | "no-parent-task"; readonly detail: string };

/**
 * Per-id liveness answers, keyed by the request ids the caller supplied.
 *
 * **`false` means "no live registration was found", never "definitely dead."** A
 * request that completed, one that was never registered, and one whose
 * registration was lost are indistinguishable here by construction, because
 * terminal requests are deregistered. Treat `false` as permission to stop
 * waiting — never as proof the work did not happen. Re-dispatching on a `false`
 * answer alone is how double execution ships; corroborate against durable state
 * you own first.
 */
export type LivenessAnswers = Readonly<Record<string, boolean>>;

/** A suspension by where it is: its request and its id, the pair every store keys a suspension by. */
export type SuspensionAddress = {
  readonly requestId: string;
  readonly suspensionId: string;
};

// FIX-2129.
/**
 * Arguments to {@link RequestHost.resumeWait}: a wait gate in this session
 * and its outcome, or a wait for a user to cancel.
 */
export type ResumeWaitInput =
  | {
      /** The wait gate's id, as the waited-on row records it. */
      readonly gateId: string;
      /** The answer, or the error naming how the wait ended. */
      readonly outcome: WaitOutcome;
    }
  | {
      /**
       * A suspension that waits for a user, as a task's record of its
       * stop names it (server-written, never input). It must be this
       * principal's: the same user, tenant and organization as the running
       * request. Any other answers `gate-not-found`.
       */
      readonly suspension: SuspensionAddress;
      /** Cancelled: the block reads `{ cancelled: true }` and runs to its end. */
      readonly outcome: { readonly cancelled: true };
      /**
       * Runs under the suspension's fence, once it is found pending and before
       * it resolves: the write that cancels the task, so an answer can't land
       * between the two. Not run when the call is refused. A throw resolves
       * nothing and is rethrown.
       */
      readonly first?: () => Promise<void>;
      /**
       * The task the run works is cancelled with this stop: the continued
       * run asks nobody again, so a later wait for a user in it resolves
       * `cancelled` at once. Absent, only this stop ends, and the run's next
       * wait for a user suspends as usual.
       */
      readonly taskCancelled?: boolean;
    };

/**
 * Outcome of a resume. A refusal resumes nothing:
 *
 * - `gate-not-found` — no wait gate with that id is on record in this session.
 *   A gate in another session, another principal's, and a gate that is not an
 *   ask (a person's approval) all answer this, so the verb is not an oracle.
 *   So does a gate whose turn has since finished: a finished turn's gates are
 *   cleaned up with it. Not-found is therefore never proof that the gate is
 *   yet to be created.
 * - `already-resolved` — the gate was resumed before and its turn has not
 *   finished. The first answer stands.
 * - `busy` — another resume of the same turn holds its lease right now, or
 *   the turn has not finished parking on the gate. Retryable: the gate is
 *   still pending, so try again shortly.
 * - `ambiguous` — more than one turn in this session is parked on a gate with
 *   that id. Neither is resumed: guessing would hand one wait's answer to the
 *   other. Gate ids must be unique within the session (see `parkOnWait`).
 */
export type ResumeWaitResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refused: "gate-not-found" | "already-resolved" | "busy" | "ambiguous";
      readonly detail: string;
    };

/** A wake as a pass reads it: when it is due, its fence, and the version a settle is conditional on. */
export type WakeView = {
  readonly dueAt: number;
  /** When the write the wake guards must have landed by (the writer's request lease). */
  readonly landBy: number;
  readonly version: number;
};

/** What {@link RequestWakes.settle} did. */
export type WakeSettleResult = "moved" | "cleared" | "stale";

// FIX-2078 D1.
/**
 * A debt's due time, kept by the engine: one wake per session
 * and internal entry, fired by the durability sweeper as its owner until a pass
 * in that session clears it. A writer owes the wake BEFORE the write that owes
 * the debt, so a crash between them leaves a wake that pays nothing, never a
 * debt with no wake.
 *
 * The owner, its org and tenant, and the session's flow are never parameters:
 * they come from the running request's identity, or, for another session, from
 * that session's stored record after it is checked to be this principal's.
 */
export interface RequestWakes {
  /**
   * Owe the wake that runs `entry` in `sessionId` (this request's own session
   * when omitted) at `dueAt`: written, or coalesced into the one kept there
   * (the earlier due time wins). Its fence is this request's lease.
   *
   * @returns `false` when the session is not one this request may reach: gone,
   *   another principal's, another tenant's or another org's. Nothing is written.
   */
  owe(spec: { readonly entry: string; readonly dueAt: number; readonly sessionId?: string }): Promise<boolean>;
  /** This session's wake for `entry`, as a pass reads it at its start, or `undefined`. */
  read(entry: string): Promise<WakeView | undefined>;
  /**
   * After a pass: move this session's wake for `entry` to `next`, or clear it
   * when `next` is `null`, if it is still the version the pass read. A clear
   * before the wake's fence (`landBy`) moves it to the fence instead, so a
   * writer still landing its write can't lose it. `stale` when a write landed
   * during the pass: the wake stays as that write left it.
   */
  settle(entry: string, read: WakeView, next: number | null): Promise<WakeSettleResult>;
  /**
   * How long past its due time a debt may stay outstanding before a pass ends
   * it (settles it undeliverable and logs it): a host setting, 24 hours by
   * default.
   */
  readonly maxDebtAgeMs: number;
}

// FIX-2082.
/** A wait's deadline, as the host bounds it: milliseconds from the call. */
export type WaitDeadlines = {
  /** A wait that names none waits this long: five minutes unless the host sets it. */
  readonly defaultMs: number;
  /** The shortest a wait may name: the sweep's resolution, since a shorter one can't come due sooner. */
  readonly minMs: number;
  /** The longest a wait may name: 24 hours unless the host sets it. */
  readonly maxMs: number;
};

// FIX-2082.
/**
 * Waits on this host: every wait parks on the one wait gate, and
 * each passes the same two checks before it does.
 */
export interface RequestWaits {
  /** The deadline bounds a wait is held to. */
  readonly deadlines: WaitDeadlines;
  /**
   * How many waits the chain a new wait joins would hold, the new one
   * included: the live waits above the running request (what waits on its own
   * work, and on that waiter's work, and so on up) plus the new wait plus the
   * live waits below the work it would wait on (the work's own request waiting,
   * and so on down). Read from the waits parked now, never from a count copied
   * when a request started. A wait whose chain would pass `MAX_WAIT_DEPTH` is
   * refused before anything is written.
   *
   * @param input.binding What the new wait would wait on; omitted for work
   *   not started yet (a dispatch about to be sent), which has nothing below it.
   * @param input.own The row the running request works, when it works one:
   *   server-derived by the caller (its claim), never input.
   */
  depth(input: { readonly binding?: WaitGateBinding; readonly own?: TaskAddress }): Promise<number>;
  /**
   * Whether each request has stopped running its own work: it ended, or its
   * process died while it ran (`interrupted`). `false` for one running or
   * parked, and for a request of another session. A request with no record
   * reads `true`. A board's pass reads it to release a wait slot that lapsed
   * for a request that ended without reading the task.
   */
  ended?(requestIds: readonly string[]): Promise<Readonly<Record<string, boolean>>>;
  // FIX-2166; FIX-2123.
  /**
   * Whether each request is running its own work now (`in_progress`): neither
   * parked (`suspended`) nor ended. `false` for one parked
   * on a person or a wait, for one that ended or whose process died, for a
   * request of another session, and for one with no record. Also `false` for
   * one still recorded `in_progress` whose registry heartbeat has been silent
   * past the host's stale-request threshold: its process died before the sweep
   * marked it interrupted. Where heartbeats can't tell (off, or
   * slower than half the threshold), the record alone answers. A board reads it
   * to hold a task's notice while the request that filed the task still runs,
   * and not while that request is parked.
   */
  running?(requestIds: readonly string[]): Promise<Readonly<Record<string, boolean>>>;
  // FIX-2239.
  /**
   * The running session's open stop for the user: a request of
   * this session, other than the running one, parked on a user's suspension
   * (`isUserSuspension`). `undefined` when none is. Read from the suspensions
   * pending now. A message to a session stopped for the user queues behind
   * that request until it ends.
   */
  userStop?(): Promise<{ readonly requestId: string } | undefined>;
  // FIX-2269.
  /**
   * Run `work`, which starts what the running request will then park on, and
   * parks on it: a call's send and its wait. If the process dies
   * after `work` starts and before the park is written, the engine continues
   * the request, as the continue route does, with no one asking, and its
   * replay parks on what it already started.
   *
   * The caller's effect must be safe to repeat. `runOnce` records a result
   * only after its function returns, so a process that dies between the effect
   * and that record runs the effect again on the replay: owe a park only where
   * the effect carries an identity kept before it (a call's message id, which
   * the recipient takes once). The obligation is the running request's own,
   * kept by the engine, and cleared when the request parks, when `work`
   * returns or throws anything but the park, and when the request ends.
   */
  owingPark?<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * A session of the running principal as {@link RequestSessions.read} answers it:
 * which flow it runs and its readonly state, and nothing else of its record.
 */
export type PeerSessionView = {
  /** The definition kind of the session's flow. */
  readonly flowKind: string;
  /** The flow instance the session belongs to; absent on a record written before instances had ids. */
  readonly flowId?: string;
  /**
   * The session's state, cut to the fields its flow declares readonly
   * (server-written markers). Empty when the flow is not registered in this
   * process. Untyped: parse it with your own schema.
   */
  readonly state: Readonly<Record<string, unknown>>;
  // FIX-2725 D1.
  /**
   * Which session this is, among every session that has held its id: a new
   * one is minted when the session is recreated under the same id. Server
   * only: key a partition by it, never answer it to a client.
   */
  readonly lineageId: string;
};

// FIX-2725 D1.
/** Which of the running principal's sessions {@link RequestSessions.list} reads. */
export type SessionListQuery = {
  /** Only sessions of flows of this kind. */
  readonly flowKind?: string;
  /** Only sessions owned by this flow instance. */
  readonly flowId?: string;
  /**
   * Exact match on readonly state fields the flow `flowId` (else the
   * registered flow of kind `flowKind`) declares. Any other field throws,
   * an exposed one included: a filter is trusted to pick sessions by what the
   * server set at birth and nothing changes, unlike the display data
   * {@link ListedSession.state} carries.
   */
  readonly fields?: Readonly<Record<string, string>>;
  // FIX-2754.
  /**
   * Only these sessions, by id, at most the first 100. The other filters
   * still apply, and each session passes the same rule as the rest of the
   * list: another principal's, a refused and a missing session are left out
   * alike, and the read is heard as the list is, never on an asked-for
   * session's own topic.
   */
  readonly ids?: readonly string[];
  /** How many rows, newest first. Defaults to and at most 100. */
  readonly limit?: number;
  /**
   * How many of the newest matching sessions to pass over first, to read on
   * where `more` said a page stopped. Counted before the list leaves out a
   * session it doesn't answer, so a page can hold fewer than `limit`.
   */
  readonly offset?: number;
};

/** One session as {@link RequestSessions.list} answers it: no items, no state but what the HTTP session list shows. */
export type ListedSession = {
  readonly id: string;
  readonly flowKind: string;
  /** The flow instance that owns it; absent on a record written before instances had ids. */
  readonly flowId?: string;
  /** As {@link PeerSessionView.lineageId}: server only. */
  readonly lineageId: string;
  /** Its title, once one is set. */
  readonly title?: string;
  readonly createdAt: number;
  /** When the session last changed: a request starting in it, a title. */
  readonly updatedAt: number;
  // FIX-2754.
  /**
   * Its state as the HTTP session list shows the same caller: the fields its
   * flow exposes to the client (`session.client.expose`) and the ones it
   * declares readonly. Display data, for a screen to label the session by: an
   * exposed field may change after the session is made, so a block that
   * decides on a session reads {@link RequestSessions.read}, whose state is
   * readonly fields only, and filters by {@link SessionListQuery.fields}.
   */
  readonly state: Readonly<Record<string, unknown>>;
};

/** The running principal's top-level sessions, newest first. */
export type SessionList = {
  readonly sessions: readonly ListedSession[];
  /** Whether more sessions matched than the limit let through. */
  readonly more: boolean;
};

/** Which requests {@link RequestSessions.turns} reads. */
export type SessionTurnsQuery = {
  /** Only requests in one of these statuses, filtered at the store. */
  readonly status?: readonly RequestStatus[];
  /** Only requests of one of these actions. */
  readonly actions?: readonly string[];
  /** How many of each session's newest requests. Defaults to and at most 50. */
  readonly limit?: number;
};

/** One request of a session, as {@link RequestSessions.turns} answers it: its status, never its words. */
export type SessionTurn = {
  readonly id: string;
  readonly sessionId: string;
  readonly action: string;
  readonly status: RequestStatus;
  /** What started it: `http`, `mcp`, `scheduled`, `notification`, and so on. */
  readonly source: string;
  readonly startedAtMs: number;
  readonly completedAtMs?: number;
  // FIX-2771.
  /** When it ended, completed, failed or aborted: a failed turn has no `completedAtMs`. Absent while it runs or waits. */
  readonly endedAtMs?: number;
  readonly updatedAt: number;
  /** Why it failed, when it did. */
  readonly error?: { readonly code: string; readonly message: string };
  /** The first turn its history window held, when earlier turns had left it: the request record's mark. */
  readonly historyStart?: { readonly requestId: string } | null;
  // FIX-2848 D3.
  /**
   * Whether the engine's retry route runs this turn again for its caller: the
   * route's own rule on `source`, with the host's `publicReentrySources`. A
   * screen offers Retry on a failed turn from this, never from a copy of the
   * source list. Absent from an engine older than this field: read it as `false`.
   */
  readonly retryable?: boolean;
};

/** Which of another session's settled turns {@link RequestSessions.history} reads. */
export type SessionHistoryQuery = {
  /**
   * How many of the most recent settled turns: a count of turns (`n` or
   * `{ turns: n }`), or `{ tokens: n }`, which packs whole turns from the newest
   * back as a history window does. The newest turn is always read, even when
   * it alone is over a `{ tokens }` limit, so this is not a hard cap on what a
   * caller hands a model. Defaults to `{ turns: 20 }`; at most 50 turns are read.
   */
  limit?: MessageLimit;
};

/**
 * Another session's settled turns, as {@link RequestSessions.history} reads
 * them: what a model may read of that conversation, and how fresh it is.
 */
export type SessionHistory = {
  /**
   * The settled turns read, oldest first, and any turn waiting on a call, as
   * far as it got (`settled: false`). Each carries its messages.
   */
  readonly turns: readonly HistoryTurn[];
  /** The first turn read, when earlier settled turns were left out. */
  readonly startRequestId?: string;
  /**
   * The newest settled turn read, and when it settled. Absent when the session
   * has no settled turn.
   */
  readonly asOf?: { readonly requestId: string; readonly atMs: number };
  /**
   * Whether a turn of that session is open now: running, suspended, or
   * interrupted and parked to run again. What it says is not read, except a
   * turn waiting on a call, which `turns` holds as far as it got.
   */
  readonly running: boolean;
};

// FIX-2770.
/** Which of the running principal's pending suspensions {@link RequestSessions.userSuspensions} reads. */
export type UserSuspensionsQuery = {
  /**
   * Only suspensions of requests of these flow kinds: 0 to 50, never every
   * flow. Pass the flows your screen covers, from server code, never from a
   * caller's input. An empty list reads nothing; more than 50 throws.
   */
  readonly flowKinds: readonly string[];
  /** Read on from a page's `next`. */
  readonly after?: PendingUserSuspensionCursor;
};

/** One page of the running principal's pending suspensions, oldest first. */
export type UserSuspensionPage = {
  readonly suspensions: readonly PendingUserSuspension[];
  /**
   * Whether more matched than this page read. A page can hold fewer rows than
   * the page size, even none, while `more` is set: rows the instance's own
   * sign-in refuses are left out after the store read them.
   */
  readonly more: boolean;
  /** When `more`: pass it back as `after` to read on. */
  readonly next?: PendingUserSuspensionCursor;
};

// FIX-2160 D2; FIX-2173.
/**
 * Sessions of the running principal: a check on a target session
 * before anything is written to it, and a read of what it has said.
 */
export interface RequestSessions {
  /**
   * The session `sessionId`, when it is the running principal's: the same
   * user, tenant and organization as the running request. `undefined` for any
   * other, and for one that doesn't exist: the two read alike, so the verb is
   * not an existence oracle. Any flow's session answers; the caller checks the
   * flow it needs.
   */
  read(sessionId: string): Promise<PeerSessionView | undefined>;

  /**
   * The settled turns of the session `sessionId`, when it is the running
   * principal's by the rule of {@link read}; `undefined` for any other session
   * and for one that doesn't exist. Reads only: nothing is written to the
   * session and nothing runs in it. A turn the session runs now, a suspended
   * turn and a parked one are left out, and `running` says one is open.
   * It returns the transcript, so a view that reads it hears `items` and runs
   * again per streamed chunk; a view meant to stay quiet during a reply reads
   * {@link turns}, not `history`.
   */
  history(sessionId: string, query?: SessionHistoryQuery): Promise<SessionHistory | undefined>;

  // FIX-2725 D1.
  /**
   * The running principal's top-level sessions, by the rule of {@link read},
   * filtered at the store, newest first: at most 100, with `more` set when
   * more matched.
   */
  list(query?: SessionListQuery): Promise<SessionList>;

  /**
   * The requests of the session `sessionId`, newest first, at most 50, when
   * it is the running principal's by the rule of {@link read}; `undefined`
   * otherwise. Status, times, source and error only, never the words.
   */
  turns(sessionId: string, query?: SessionTurnsQuery): Promise<SessionTurn[] | undefined>;
  /**
   * The requests of each of `sessionIds` (at most 100) the running principal
   * may read, newest first, at most 50 a session. A session it may not read
   * adds nothing.
   */
  turns(sessionIds: readonly string[], query?: SessionTurnsQuery): Promise<SessionTurn[]>;

  // FIX-2770.
  /**
   * The running principal's pending suspensions that wait on them, across
   * every session and none, on the flow kinds named: the same user, tenant
   * and organization as the running request, read at the store in one query
   * that joins each to its request. Oldest first, at most 200 a page. Each row
   * is a projection, never the run's payload. A view that reads it hears only
   * a suspension written or deleted, never a streamed reply or a turn.
   *
   * @throws FlowStateConfigError for more than 50 flow kinds.
   */
  userSuspensions(query: UserSuspensionsQuery): Promise<UserSuspensionPage>;
}

/**
 * Request-bound operations the engine binds to the running request and attaches
 * to the block context. Every verb closes over the caller's identity.
 *
 * Reached through {@link requireRequestHost}, which throws by name when no host
 * wired one, rather than failing as `undefined is not a function`.
 */
export interface RequestHost {
  /**
   * Read the one parent-board row this request was dispatched for, or
   * `undefined` when this request was not dispatched for a task.
   *
   * The board coordinate is server-stamped into the request at spawn and closed
   * over. This is not a cross-session resource browser: one coordinate, one row,
   * both server-derived. The value is untyped — parse it with your own schema.
   */
  parentTask(): Promise<unknown | undefined>;

  /**
   * Settle that same row.
   *
   * **There is no `claim` parameter.** The fence ticket is stamped into this
   * child request at spawn and closed over, exactly as the parent session and the
   * board coordinate are. Every field of a ticket is readable off the row
   * `parentTask()` exposes, so an argument would be forgeable: a displaced child
   * could read the successor's attempt and settle over work it no longer owns.
   */
  settleParentTask(input: SettleParentTaskInput): Promise<SettleParentTaskResult>;

  /**
   * Check whether requests you dispatched are still running.
   *
   * Takes a batch and answers per id. Identity filters *before* the answer is
   * built, and an id that does not pass comes back indistinguishable from an
   * unknown id. There is no enumeration and no existence oracle.
   *
   * **What passes.** A request under this caller's own principal, tenant and
   * flow instance, whose session is either (a) in the caller's descendant chain
   * — including the caller's own session — or (b) a session a dispatcher
   * started, in the caller's organization. (b) is what lets you ask about work
   * you dispatched from another of your own conversations on this flow; it does
   * not reach a conversation nobody dispatched, another organization, another
   * tenant, another principal or another flow instance.
   *
   * **Absent when the liveness gate refused at construction** — because the
   * request registry is not shared across processes, because heartbeats cannot
   * keep pace with the stale threshold, or because stale sweeping is off. Each of
   * those makes the answer a lie in a different direction, so the verb is missing
   * and named rather than present and wrong. The other verbs are unaffected.
   *
   * See {@link LivenessAnswers} for what a `false` answer does and does not mean.
   */
  livenessOf?(requestIds: readonly string[]): Promise<LivenessAnswers>;

  // FIX-2129.
  /**
   * Resume a turn parked on a wait gate **in this session**, with the answer or
   * an error. The parked request continues under its own id, as a same-request
   * continuation; this returns once that continuation has started, not when it
   * finishes.
   *
   * Takes the gate's id and nothing else: never a session or a request id. The
   * running session is closed over, so one conversation cannot resume another's
   * turn. A gate resolves once; every later call is refused `already-resolved`.
   *
   * **Or cancel a wait for a user**: `{ suspension, outcome: {
   * cancelled: true } }` resolves a pending user's suspension `cancelled`
   * through the same fence every answer takes, and continues its request, so
   * the block reads `{ cancelled: true }` and runs to its end. A suspension
   * already recorded `cancelled` whose request is still parked (a crash after
   * the write) is continued. It is the cancel's debt payment: a board pays it
   * when a task waiting on a user is cancelled (with `taskCancelled: true`, so
   * the run asks nobody again), and to end one stop of a task that goes on
   * (without it). The request may be in another session; it must be this
   * principal's. `already-resolved` when an answer, a deadline or a stop got
   * there first, `busy` while another resume holds the request.
   *
   * **Absent when the host has no durable execution**, because nothing can
   * park there in the first place.
   */
  resumeWait?(input: ResumeWaitInput): Promise<ResumeWaitResult>;

  // FIX-2129, epic D3.
  /**
   * The deadline a wait for a user gets when its call names none, in
   * milliseconds: the host's setting for a user's stop,
   * which a held question reads too. Absent when the host sets none: such a
   * stop waits until it is answered, stopped or cancelled. A fact read when
   * the request starts, not a verb.
   */
  readonly userDeadlineMs?: number;

  /**
   * Whether a wait parked on this host is bounded: `true` when this process
   * runs a durability sweeper that resumes a pending wait at its deadline
   * (`waitDeadline` wakes). A wait is offered only where this is `true`, so no
   * request waits forever. Absent or `false` otherwise: no durable execution, no
   * sweeper (a host that never built one, or one whose sweep is turned off).
   *
   * A fact read when the request starts, not a verb; the waker side
   * (`resumeWait`) does not depend on it.
   */
  readonly hasWaitSweeper?: boolean;

  /**
   * Whether a request this one dispatches runs in this process (the host's
   * in-process runner), rather than on another one's worker (a queue).
   * A fact read when the request starts. Absent or `false` when it may run
   * elsewhere, or the host can't say: a caller that keeps process-local
   * bookkeeping about what it dispatched relies on it only when `true`.
   */
  readonly dispatchRunsHere?: boolean;

  // FIX-2078 D1.
  /**
   * Debts' due times. **Absent when the host keeps no wakes**:
   * its stores have none, or it has no durable execution. A debt is then paid
   * on its fast paths only, and a consumer that needs a due time either keeps a
   * fast path or is refused when its flow is built.
   */
  readonly wakes?: RequestWakes;

  // FIX-2082.
  /**
   * Waits: their deadline bounds and the depth count. **Absent when
   * the host can't hold a wait**: no durable execution, or stores that keep no
   * wakes, since a wait's deadline is a wake.
   */
  readonly waits?: RequestWaits;

  // FIX-2160 D2.
  /**
   * Sessions of the running principal. Absent on a host that
   * can't read its session records, such as a hand-built test context.
   */
  readonly sessions?: RequestSessions;
}

/**
 * Thrown by {@link requireRequestHost} when a capability reaches for the runtime
 * in a context that has none — a unit test, a hand-built mock, or a host that was
 * never wired.
 */
export class NoRequestHostError extends Error {
  readonly code = "no-request-host";

  constructor(detail?: string) {
    super(
      detail ??
        "This capability needs a runtime host, and none is wired on this context. " +
          "A host built through the shipped entry points supplies one; a hand-built " +
          "test context must provide `requestHost` explicitly."
    );
    this.name = "NoRequestHostError";
  }
}

/**
 * Read the request host off a context, or `undefined` when none is wired: a
 * hand-built test context, or a block run outside a request.
 *
 * `requestHost` is a member of the engine's {@link InternalBlockContext}, not
 * of the public `BlockContext`, so a framework package holding a public `ctx`
 * reads it here. Takes any context.
 */
export function requestHostOf(ctx: object): RequestHost | undefined {
  return (ctx as Pick<InternalBlockContext, "requestHost">).requestHost;
}

/**
 * Read the request host off a context, throwing by name when it is absent.
 *
 * The member is optional in the *type* so a hand-built test context still
 * type-checks; it is not optional in *deployment* — a host that executes requests
 * without one fails at construction. This accessor is what turns the residual
 * absence into a named error instead of `undefined is not a function`. The
 * non-throwing form is {@link requestHostOf}.
 */
export function requireRequestHost(ctx: object): RequestHost {
  const host = requestHostOf(ctx);
  if (host == null) throw new NoRequestHostError();
  return host;
}
