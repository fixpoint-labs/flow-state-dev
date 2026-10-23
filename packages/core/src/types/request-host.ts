/**
 * The request host — the single declared seam through which a capability reaches
 * facilities only the runtime can provide (FIX-999).
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
 * a flow instance, a session record, or a task row. A value read from another
 * session crosses as `unknown` and the consumer parses it with its own schema —
 * `core` cannot name `orchestration`'s types either.
 *
 * **Identity is never a parameter, and neither is a session id.** Every operation
 * closes over the running request's server-derived identity (tenant, user, org,
 * session, flow). A caller supplies the *target* of an operation and never the
 * *authority* for it: it hands over a routing seed and the seam derives the child
 * session key from that seed together with the running request's principal *and*
 * parent session. Another user's session is not a value a capability can produce,
 * and neither is another parent session's child.
 *
 * The seam is **closed at seven verbs**. The fifth, `resumeWait`, was added by
 * a reviewed decision (a wait: a dispatched task the caller waits on), with one
 * fact beside it, `hasWaitSweeper`, which says whether a wait can be bounded
 * here. The sixth, `wakes`, by another (FIX-2078 D1: a debt's due time is a
 * wake the engine keeps). The seventh, `waits`, by FIX-2082 (one wait gate:
 * its deadline bounds and the depth the engine counts). Adding an eighth verb
 * is a decision someone reviews, not a surface that grows by transitivity.
 */

import type { WaitGateBinding, WaitOutcome, WaitRow } from "./wait-gate";

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

/** Arguments to {@link RequestHost.resumeWait}. */
export type ResumeWaitInput = {
  /** The wait gate's id, as the waited-on row records it. */
  readonly gateId: string;
  /** The answer, or the error naming how the wait ended. */
  readonly outcome: WaitOutcome;
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
 * - `busy` — another resume of the same turn holds its lease right now.
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

/**
 * A debt's due time, kept by the engine (FIX-2078 D1): one wake per session
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

/** A wait's deadline, as the host bounds it (FIX-2082): milliseconds from the call. */
export type WaitDeadlines = {
  /** A wait that names none waits this long: five minutes unless the host sets it. */
  readonly defaultMs: number;
  /** The shortest a wait may name: the sweep's resolution, since a shorter one can't come due sooner. */
  readonly minMs: number;
  /** The longest a wait may name: 24 hours unless the host sets it. */
  readonly maxMs: number;
};

/**
 * Waits on this host (FIX-2082): every wait parks on the one wait gate, and
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
  depth(input: { readonly binding?: WaitGateBinding; readonly own?: WaitRow }): Promise<number>;
  /**
   * Whether each request has stopped running its own work: it ended, or its
   * process died while it ran (`interrupted`). `false` for one running or
   * parked, and for a request of another session. A request with no record
   * reads `true`. A board's pass reads it to release a wait slot that lapsed
   * for a request that ended without reading the task.
   */
  ended?(requestIds: readonly string[]): Promise<Readonly<Record<string, boolean>>>;
  /**
   * Whether each request of this session is `in_progress` (FIX-2123). `false`
   * when parked, ended, dead, another session, or unread. A board holds a
   * notice while the request that filed the task still runs.
   */
  running?(requestIds: readonly string[]): Promise<Readonly<Record<string, boolean>>>;
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
   * **Absent when the host has no durable execution**, because nothing can
   * park there in the first place.
   */
  resumeWait?(input: ResumeWaitInput): Promise<ResumeWaitResult>;

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
   * in-process dispatcher), rather than on another one's worker (a queue).
   * A fact read when the request starts. Absent or `false` when it may run
   * elsewhere, or the host can't say: a caller that keeps process-local
   * bookkeeping about what it dispatched relies on it only when `true`.
   */
  readonly dispatchRunsHere?: boolean;

  /**
   * Debts' due times (FIX-2078 D1). **Absent when the host keeps no wakes**:
   * its stores have none, or it has no durable execution. A debt is then paid
   * on its fast paths only, and a consumer that needs a due time either keeps a
   * fast path or is refused when its flow is built.
   */
  readonly wakes?: RequestWakes;

  /**
   * Waits (FIX-2082): their deadline bounds and the depth count. **Absent when
   * the host can't hold a wait**: no durable execution, or stores that keep no
   * wakes, since a wait's deadline is a wake.
   */
  readonly waits?: RequestWaits;
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
 * Read the request host off a context, throwing by name when it is absent.
 *
 * The member is optional in the *type* so a hand-built test context still
 * type-checks; it is not optional in *deployment* — a host that executes requests
 * without one fails at construction. This accessor is what turns the residual
 * absence into a named error instead of `undefined is not a function`.
 */
export function requireRequestHost(ctx: { requestHost?: RequestHost }): RequestHost {
  const host = ctx.requestHost;
  if (host == null) throw new NoRequestHostError();
  return host;
}
