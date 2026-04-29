/**
 * Phase 1 stub principal resolver.
 *
 * Reads `body.userId` from the parsed request body — exactly the model the
 * pre-FIX-438 router used at `routes/action-routes.ts`. FIX-23 will replace
 * this stub with a configurable resolver hook on `createFlowApiRouter`;
 * adapter code does not change because adapters always call
 * `host.resolvePrincipal` rather than implementing auth themselves.
 */
import { PrincipalResolutionError } from "../errors";
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
 * parses the body for action input, so the resolver receives the parsed
 * value via `context.envelope.input` is *not* the body — webhook adapters
 * need the raw body for signature verification. We therefore look at:
 *   1. `context.envelope.metadata.body` (set by the HTTP adapter)
 *   2. fall back to `context.envelope.input` shape when metadata is absent
 *
 * Either way, missing or empty `userId` raises a 401-equivalent error. The
 * runtime treats the resolved `userId` as authoritative.
 */
export const defaultBodyUserIdPrincipalResolver: PrincipalResolver = (
  context: PrincipalResolutionContext
): ResolvedPrincipal => {
  const body = pickBody(context);
  const userId = getString(body?.userId);
  if (userId === undefined) {
    throw new PrincipalResolutionError(
      "Action request requires non-empty userId",
      { status: 401 }
    );
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
