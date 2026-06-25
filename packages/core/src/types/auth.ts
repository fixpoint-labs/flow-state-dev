/**
 * Authentication contract types.
 *
 * The framework owns the contract; the host owns credential verification.
 * Every inbound transport (HTTP, MCP, webhook, scheduled, custom) translates
 * its native auth into a `ResolvedPrincipal` via a `ResolvePrincipalFn`.
 *
 * These types live in core because `defineFlow` accepts an `authentication`
 * config and the principal contract is the runtime's authoritative caller
 * identity. Server re-exports the same names from `@flow-state-dev/engine`
 * so adapter authors can import them next to `InboundRequestEnvelope`.
 */

/**
 * Stable provenance identifier for inbound requests. Open string — adapters
 * may use any value. The documented known-set is `http`, `mcp`, `webhook`,
 * `scheduled`, `notification`; custom transports pick their own.
 */
export type InboundSource = string;

/**
 * Resolved caller principal stamped onto every dispatched envelope. The
 * runtime treats the `userId` here as authoritative for state-scope routing.
 *
 * `requireUser: false` flows may produce a principal with no `userId` so
 * long as no user-scope state, clientData, or resources are declared. The
 * host is then expected to provide a `defaultUserId` for the runtime path
 * that still expects an identity (e.g., `RequestRecord.userId`).
 */
export interface ResolvedPrincipal {
  userId: string;
  orgId?: string;
}

/**
 * Context passed to `ResolvePrincipalFn`. `request` is set for HTTP-shaped
 * transports; non-HTTP transports use `envelope` and `rawBody`.
 *
 * `envelope` is intentionally a structural subset of the inbound envelope
 * shape — the auth resolver runs *before* dispatch and so should not depend
 * on stream emitters or signal semantics carried by the full envelope.
 */
export interface PrincipalResolutionContext {
  source: InboundSource;
  /** Native HTTP request, when the transport is HTTP-shaped. */
  request?: Request;
  envelope: {
    flowKind: string;
    action: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
    input: unknown;
  };
  /**
   * Raw HTTP body bytes, preserved by HTTP-shaped adapters for adapters
   * that need pre-parse access (webhook signature verification).
   */
  rawBody?: Uint8Array;
}

/**
 * Caller-supplied principal resolver. May return a fully resolved principal,
 * a partial `{ userId?, orgId? }` (the framework will then apply
 * `defaultUserId` and enforce `requireUser`), or `null` when the request is
 * unauthenticated and the flow opts out of user requirement.
 *
 * Throwing a `PrincipalResolutionError` (from `@flow-state-dev/engine`) lets
 * the resolver pick the HTTP status code surfaced to clients (e.g., 401 for
 * invalid signature, 403 for valid signature on a forbidden resource).
 */
export type ResolvePrincipalFn = (
  context: PrincipalResolutionContext
) =>
  | Promise<ResolvedPrincipal | { userId?: string; orgId?: string } | null>
  | ResolvedPrincipal
  | { userId?: string; orgId?: string }
  | null;

/**
 * Per-flow authentication config. Hosts compose their own `resolvePrincipal`
 * function inside `defineFlow`; the framework wires it into the principal
 * resolution path for every inbound transport.
 *
 * ```ts
 * defineFlow({
 *   kind: "billing",
 *   authentication: {
 *     resolvePrincipal: async (ctx) => readSession(ctx.request),
 *     requireUser: true
 *   }
 * });
 * ```
 *
 * `requireUser: false` is incompatible at build time with user-scope state,
 * user-scope clientData, and any user-scoped resource (block-declared or
 * flow-level) — the framework throws at registration with a clear error
 * naming the offending field.
 *
 * `requireOrg` is reserved for the org-scope state model (future). It has
 * no runtime effect today; its presence on the type lets hosts future-proof
 * their authentication configs.
 */
export interface AuthenticationConfig {
  /**
   * Called once per inbound request after the adapter constructs the
   * principal-resolution context. Return the caller's principal, a partial
   * `{ userId?, orgId? }`, or `null`.
   */
  resolvePrincipal?: ResolvePrincipalFn;

  /**
   * Substituted when `resolvePrincipal` returns no `userId`. Useful for
   * machine-driven transports (webhooks, schedules) that have no end user
   * — the host names a system principal once and the framework fills it in.
   */
  defaultUserId?: string;

  /**
   * When `true` (default), the framework rejects requests that don't yield
   * a `userId` after `defaultUserId` fallback. When `false`, the flow opts
   * out of user-scope identity entirely; user-scope state, clientData, and
   * resources are forbidden at build time.
   */
  requireUser?: boolean;

  /**
   * Reserved. The org-scope state model is a separate future issue; the
   * flag exists so hosts can declare intent without churn when it lands.
   */
  requireOrg?: boolean;
}
