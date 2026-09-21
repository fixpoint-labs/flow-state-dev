/**
 * Default body-userId principal resolver.
 *
 * Reads `body.userId` from the parsed request body — exactly the model the
 * pre-FIX-438 router used at `routes/action-routes.ts`. Returns `null` when
 * the body has no `userId`; the host then applies `authentication.defaultUserId`
 * fallback and enforces `authentication.requireUser` (FIX-23). Throwing is
 * reserved for explicit auth failures (e.g., custom resolvers verifying a
 * signature); a missing field is not, by itself, an auth failure here.
 */
import type {
  PrincipalResolutionContext,
  PrincipalResolver,
  ResolvedPrincipal
} from "../types";

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Resolve a principal from a body-shaped object. The HTTP adapter already
 * parses the body for action input, so the resolver looks at:
 *   1. `context.envelope.metadata.body` (set by the HTTP adapter)
 *   2. fall back to `context.envelope.input` when metadata is absent
 *
 * Returns `null` when no userId is present so the host can apply the
 * configured fallback (`defaultUserId`) and `requireUser` enforcement.
 */
export const defaultBodyUserIdPrincipalResolver: PrincipalResolver = (
  context: PrincipalResolutionContext
): { userId?: string } | null => {
  const body = pickBody(context);
  const userId = getString(body?.userId);
  if (userId === undefined) {
    return null;
  }
  // Deliberately no `orgId`. The body is caller-controlled, so it is not a
  // source an organization may come from (BP-031, FIX-1442) — an app running
  // on this resolver has no verified organization at all, and the host
  // supplies `DEFAULT_ORG_ID` instead. A body that still carries the old field
  // is reported once per host by `hasLegacyBodyOrgId` and otherwise ignored.
  return { userId };
};

/**
 * Whether this request's body still carries the obsolete caller-supplied
 * `orgId` field (FIX-1442).
 *
 * Presence only — the host warns that a wire client is still sending it and
 * never logs the value, which names somebody's organization.
 */
export function hasLegacyBodyOrgId(context: PrincipalResolutionContext): boolean {
  return getString(pickBody(context)?.orgId) !== undefined;
}

/**
 * Brand marking the framework default resolver. Keyed via the global symbol
 * registry (`Symbol.for`) so it survives across duplicate `@flow-state-dev/engine`
 * module instances — a consumer whose `fsdev.config.*` resolves the framework
 * through a different copy still carries the same brand, so identity comparison
 * against one instance's sentinel is not required.
 */
const DEFAULT_PRINCIPAL_RESOLVER_BRAND = Symbol.for(
  "@flow-state-dev/engine/defaultBodyUserIdPrincipalResolver",
);
(defaultBodyUserIdPrincipalResolver as unknown as Record<symbol, boolean>)[
  DEFAULT_PRINCIPAL_RESOLVER_BRAND
] = true;

/**
 * Whether `resolver` is the framework default body-userId resolver — i.e. it
 * trusts a caller-supplied `body.userId` with no real authentication. Checks the
 * package-instance-stable brand (not function identity), so it holds even when
 * the resolver came from a different `@flow-state-dev/engine` instance. Callers
 * that treat "no resolver configured" as unauthenticated must handle `undefined`
 * separately — this predicate is about an actual default-resolver value.
 *
 * A hand-written resolver that merely delegates to the default is NOT detected
 * (it is a distinct, unbranded function); that is out of scope for this check.
 */
export function isDefaultBodyUserIdPrincipalResolver(resolver: unknown): boolean {
  return (
    typeof resolver === "function" &&
    (resolver as unknown as Record<symbol, unknown>)[DEFAULT_PRINCIPAL_RESOLVER_BRAND] === true
  );
}

function pickBody(
  context: PrincipalResolutionContext
): Record<string, unknown> | undefined {
  const meta = context.envelope.metadata;
  const fromMetadata = meta && typeof meta.body === "object" && meta.body !== null
    ? (meta.body as Record<string, unknown>)
    : undefined;
  if (fromMetadata !== undefined) {
    return fromMetadata;
  }
  const input = context.envelope.input;
  return input && typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : undefined;
}
