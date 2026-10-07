/**
 * Server-owned session data, decided when a session is created.
 *
 * Two declarations on a flow's `session` config, both enforced by the engine
 * on every path that writes a new session record (the create route, an action
 * sent to a session id that does not exist yet, a webhook delivery, `fsdev
 * run`, and a dispatch into a child session):
 *
 * - `createCheck` runs before the record is written. It sees the verified
 *   caller and the create's `link` input, and accepts or refuses it. An
 *   accepted `link` is stored on the session unchanged. Nothing changes it
 *   afterwards: no route, no action and no block writes it.
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
   * collection: a string for a wildcard pattern (`workers/*`), or the
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
  /** Create the session, storing the create's `link` on it unchanged, for its whole life. */
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
