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
 * The organization every unauthenticated single-organization deployment runs
 * under (FIX-1442).
 *
 * Organization identity is never optional: a session, request or dispatched
 * child always carries one. An app that configures no `resolvePrincipal` has
 * no verified organization to carry, so the framework supplies this one and
 * the existing org scope works without an app-level wrapper.
 *
 * It is a **development and system-wiring identity, not a security boundary**.
 * The spelling is deliberately unusable as a customer id so it cannot overlap
 * with a real organization, and a configured resolver returning it is refused
 * — an authenticated app must name its own organization.
 *
 * Once written it is stored identity: changing this value after records exist
 * requires the offline migration in the persistence guide.
 */
export const DEFAULT_ORG_ID = "__fsd_default_org__";

/**
 * Whether `value` is usable as an organization id.
 *
 * Organization ids are opaque nonempty strings. A whitespace-only id is
 * rejected rather than trimmed, and a valid id is never rewritten — the
 * framework stores exactly what the trusted source supplied, so a stored id
 * and the identity that produced it compare equal.
 *
 * The one definition both the host's principal normalization and trusted
 * direct execution validate against, so the two cannot drift.
 */
export function isValidOrgId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolved caller principal stamped onto every dispatched envelope. The
 * runtime treats the `userId` here as authoritative for state-scope routing,
 * and the `orgId` as the authoritative organization boundary for everything
 * the resulting session goes on to create, read or dispatch.
 *
 * `orgId` is **required** (FIX-1442). A caller-supplied organization never
 * reaches this type: the value here came from a configured resolver's verified
 * principal, or is {@link DEFAULT_ORG_ID} for an app that configures none.
 * Body, query, header and metadata organization fields cannot override it.
 *
 * `requireUser: false` flows may produce a principal with no `userId` so
 * long as no user-scope state, clientData, or resources are declared. The
 * host is then expected to provide a `defaultUserId` for the runtime path
 * that still expects an identity (e.g., `RequestRecord.userId`).
 */
export interface ResolvedPrincipal {
  userId: string;
  orgId: string;
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
 * `defaultUserId` and enforce `requireUser`), or `null`.
 *
 * Whatever shape it returns, the framework requires a verified organization
 * before any effect: a resolver that yields no `orgId`, a whitespace-only one,
 * or the reserved {@link DEFAULT_ORG_ID} is refused at principal resolution
 * (FIX-1442). `null` is refused for the same reason — it cannot be repaired by
 * the `defaultUserId` fallback, which supplies a user and never an
 * organization. A machine transport returns `{ orgId }` and lets
 * `defaultUserId` name its system user.
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
 * A resolver must return a verified `orgId`. There is no `requireOrg` flag:
 * organization identity is unconditional (FIX-1442), so declaring it was
 * redundant. A config that still carries the old key is rejected at flow
 * definition with migration guidance rather than silently ignored.
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
}
