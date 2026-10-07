/**
 * What a session is created with, checked once, and what of it never changes.
 *
 * Three declarations on a flow's `session` config, enforced by the engine on
 * every path that writes a new session record (the create route, an action
 * sent to a session id that does not exist yet, a webhook delivery, `fsdev
 * run`, and a dispatch into a child session):
 *
 * - `createCheck` runs before the record is written. It sees the verified
 *   caller and the session's initial state, parsed through the flow's
 *   `stateSchema`, and accepts or refuses the create.
 * - A `.readonly()` field of `stateSchema` is set at create and never changes
 *   afterwards. A write that would change one is refused, whatever writes it.
 *   Readonly fields are also the fields the session listing can filter by.
 * - `serverOwned` names session-state fields only the flow's own code writes.
 *   A create that seeds one is refused with a 400 naming the field.
 *
 * Together they let a session carry a binding a caller chooses once and can't
 * forge or move: the create check confirms it, `.readonly()` keeps it.
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
 * What a create check sees. Every field is server-derived except `state`,
 * which is the session's initial state: the create request's `state`,
 * `fsdev run --seed-session`, or the `state` a dispatching block put on its
 * session target, parsed through the flow's `stateSchema`.
 */
export type SessionCreateCheckInput = {
  /** The caller the session is created for, from the verified principal. */
  readonly principal: SessionCreatePrincipal;
  /** The bare session id being created. */
  readonly sessionId: string;
  /** The flow instance the session will belong to. */
  readonly flow: { readonly kind: string; readonly id: string };
  /** The session's initial state, after the flow's `stateSchema` parsed it. */
  readonly state: Readonly<Record<string, unknown>>;
  /** Which path is creating the session. */
  readonly via: SessionCreatePath;
  /**
   * Read the state of one item of a user- or org-scoped collection this flow
   * declares, at the creating principal's own scope. `ref` is the accessor key
   * in the flow's `resources`; `topic` is the item's key within the
   * collection: a string for a wildcard pattern (`projects/*`), or the
   * parameter values for a parameterized one (`[topic]/notes`). Resolves
   * `undefined` when the item does not exist.
   *
   * Bound to `principal`: there is no way to name another user's or another
   * organization's scope through it.
   *
   * @throws when `ref` is not a user- or org-scoped collection of this flow.
   */
  readCollectionItem(
    ref: string,
    topic: string | Record<string, string>
  ): Promise<Record<string, unknown> | undefined>;
};

/** A create check's answer. */
export type SessionCreateCheckResult =
  /** Create the session with the state it was given. */
  | { readonly ok: true }
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
