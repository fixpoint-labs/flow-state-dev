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
 * The seam is **closed at four verbs**. Adding a fifth is a decision someone
 * reviews, not a surface that grows by transitivity.
 */

/**
 * The caller's routing intent for a detached child. Never a session id: the seam
 * hashes this together with the running request's principal and parent session to
 * derive the child key, so the caller cannot name — or collide with — a session it
 * does not own.
 */
export type DetachedRoutingSeed = {
  /** Primary routing coordinate (e.g. a board topic). */
  readonly topic: string;
  /** Optional further discrimination within a topic. */
  readonly key?: string;
};

/** Arguments to {@link RequestHost.startDetached}. */
export type StartDetachedInput = {
  /** Routing seed the child key is derived from. */
  readonly seed: DetachedRoutingSeed;
  /** Input handed to the dispatched request. */
  readonly input?: unknown;
  /** Caller's own bookkeeping, persisted on the child session record. */
  readonly record?: Readonly<Record<string, unknown>>;
};

/**
 * Why a detached start was refused. Each is a name the caller can branch on
 * rather than a message it has to parse.
 *
 * - `key-occupied` — the derived key holds a child whose routing tuple does not
 *   match this seed. No record crosses the seam; the discrimination happens
 *   inside.
 * - `no-workstream-core` — the current flow declares no workstream core, so there
 *   is nothing to dispatch into. Resolution never falls through to `flow.actions`.
 * - `no-start-operation` — this process executes requests but was not wired to
 *   start one. Normally a construction-time failure; this is the residual case.
 *
 * Note there is **no bound-related refusal**. This seam makes "a running request
 * starts another request" expressible, and ships no ceiling on it. A spend brake
 * is deferred to a cost/token budget rather than a concurrency count.
 */
export type StartDetachedRefusal =
  | "key-occupied"
  | "no-workstream-core"
  | "no-start-operation";

/**
 * Outcome of {@link RequestHost.startDetached}. `adopted` distinguishes a child
 * that already existed and was started again from one this call created — the
 * ordinary second-task-same-topic path, and what makes a failed enqueue
 * recoverable rather than permanently occupying the derived key.
 */
export type StartDetachedResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly requestId: string;
      readonly adopted: boolean;
    }
  | {
      readonly ok: false;
      readonly refused: StartDetachedRefusal;
      /** Operator-facing detail. Not a stable contract; branch on `refused`. */
      readonly detail: string;
    };

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

/**
 * Request-bound operations the engine binds to the running request and attaches
 * to the block context. Every verb closes over the caller's identity.
 *
 * Reached through {@link requireRequestHost}, which throws by name when no host
 * wired one, rather than failing as `undefined is not a function`.
 */
export interface RequestHost {
  /**
   * Start a detached request in a derived child session, creating the child if
   * absent and adopting it if it already exists.
   *
   * The child session key is derived from `[principal, parent session, seed]` —
   * the caller supplies only the seed. The child inherits tenant, user, org and
   * flow kind from the running request and records it as its parent. Dispatch
   * enters the current flow's workstream core; there is no flow or action
   * parameter, so `flow.actions` is not reachable.
   *
   * Resolves only once the host has *accepted* the dispatch, so a `Started`
   * result means the request is discoverable — not merely that a record was
   * written.
   */
  startDetached(input: StartDetachedInput): Promise<StartDetachedResult>;

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
   * Ask whether requests you dispatched are still running.
   *
   * Takes a batch and answers per id. Identity filters *before* the answer is
   * built: an id outside the caller's descendant chain, or under a different
   * principal, comes back indistinguishable from an unknown id. There is no
   * enumeration and no existence oracle.
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
