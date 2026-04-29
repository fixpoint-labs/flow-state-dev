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
): ResolvedPrincipal | null => {
  const body = pickBody(context);
  const userId = getString(body?.userId);
  if (userId === undefined) {
    return null;
  }
  const orgId = getString(body?.orgId);
  return orgId === undefined ? { userId } : { userId, orgId };
};

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
