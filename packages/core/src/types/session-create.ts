/**
 * Server-owned session data, decided when a session is created.
 *
 * Two declarations on a flow's `session` config, both enforced by the engine
 * on every path that writes a new session record (the create route, an action
 * sent to a session id that does not exist yet, a webhook delivery, `fsdev
 * run`, and a dispatch into a child session):
 *
 * - `createCheck` runs before the record is written. It sees the verified
 *   caller and the create's `link` input, and either refuses the create or
 *   returns the value the engine stores as the session's `link`. Nothing
 *   changes that value afterwards: no route, no action and no block writes it.
 * - `serverOwned` names session-state fields only the flow's own code writes.
 *   A create that seeds one is refused with a 400 naming the field.
 *
 * The engine attaches no meaning to `link`. It is one string the flow decided
 * at create, readable as `ctx.session.link` and filterable in the session
 * listing.
 */

/** Which path is bringing a session into existence. */
export type SessionCreatePath =
  /** The create-session route (`POST /api/flows/:flow/sessions`). */
  | "create"
  /** An action sent to a session id that does not exist yet. */
  | "action"
  /** A webhook delivery for a session id that does not exist yet. */
  | "webhook"
  /** `fsdev run`, for a session id that does not exist yet. */
  | "cli"
  /** A dispatch into a child session derived from a key. */
  | "dispatch";

/** The verified caller a session is being created for. */
export type SessionCreatePrincipal = {
  readonly userId: string;
  readonly orgId: string;
  readonly tenantId?: string;
};

/**
 * What a create check sees. Every field is server-derived except `link`,
 * which is the create's input: the request body's `link` on the create route,
 * `--worker` on `fsdev run`, or the value a dispatching block put on its
 * session target.
 */
export type SessionCreateCheckInput = {
  /** The caller the session is created for, from the verified principal. */
  readonly principal: SessionCreatePrincipal;
  /** The bare session id being created. */
  readonly sessionId: string;
  /** The flow instance the session will belong to. */
  readonly flow: { readonly kind: string; readonly id: string };
  /** The create's link input. `undefined` when the create named none. */
  readonly link: string | undefined;
  /** Which path is creating the session. */
  readonly via: SessionCreatePath;
  /**
   * Read the state of one item of a user- or org-scoped collection this flow
   * declares, at the creating principal's own scope. `ref` is the accessor key
   * in the flow's `resources`; `topic` is the item's key within the
   * collection. Resolves `undefined` when the item does not exist.
   *
   * Bound to `principal`: there is no way to name another user's or another
   * organization's scope through it.
   *
   * @throws when `ref` is not a user- or org-scoped collection of this flow.
   */
  readCollectionItem(ref: string, topic: string): Promise<Record<string, unknown> | undefined>;
};

/** A create check's answer. */
export type SessionCreateCheckResult =
  /** Create the session, storing `link` on it for its whole life. */
  | { readonly ok: true; readonly link: string }
  /**
   * Refuse the create. Nothing is written. `message` reaches the caller.
   * `status` is the HTTP status the create route answers with (default 400).
   */
  | { readonly ok: false; readonly message: string; readonly status?: 400 | 403 | 404 };

/**
 * Runs before a session of this flow is written, on every path that creates
 * one, and only then: a turn on an existing session never calls it.
 */
export type SessionCreateCheck = (
  input: SessionCreateCheckInput
) => SessionCreateCheckResult | Promise<SessionCreateCheckResult>;

/**
 * What flow code may read about one of its caller's own sessions by id, through
 * `requireRequestHost(ctx).sessionFacts(sessionId)`. Server-written values only.
 */
export type SessionFacts = {
  /** The bare session id. */
  readonly sessionId: string;
  /** The flow definition's kind the session belongs to. */
  readonly flowKind: string;
  /** The flow instance that owns the session. */
  readonly flowId: string;
  /** The value the flow's create check stored, if the flow declares one. */
  readonly link?: string;
  /**
   * The session's minted lineage id. A session deleted and created again under
   * the same id gets a new one, so `sessionId` plus this names one incarnation.
   */
  readonly lineageId: string;
  /** When the record was created, in epoch milliseconds. */
  readonly createdAt: number;
  /** The session a dispatcher was running in when it created this one. */
  readonly parentSessionId?: string;
};
