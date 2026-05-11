/**
 * Bearer-secret principal resolver.
 *
 * Convenience helper for transports authenticated via a single shared
 * bearer token (the canonical pattern for scheduled dispatch and many
 * webhook providers). Verifies the `Authorization: Bearer <secret>`
 * header with a constant-time comparison and returns a fixed principal —
 * typically a system user.
 *
 * Hosts that need richer auth (per-tenant schedule keys, OIDC token
 * verification) implement `resolvePrincipal` directly. This helper is
 * intentionally minimal: one secret in, one principal out, on a header
 * mismatch it throws `PrincipalResolutionError({ status: 401 })`.
 *
 * Returns `null` when the header is absent so the host can apply the
 * configured `defaultUserId` fallback (e.g., for unauthenticated
 * heartbeat probes that don't need a principal).
 */
import { timingSafeEqual } from "node:crypto";
import { PrincipalResolutionError } from "../errors";
import type {
  PrincipalResolutionContext,
  PrincipalResolver,
  ResolvedPrincipal
} from "../types";
import { extractBearerToken } from "./createBearerTokenVerifier";

export interface CreateBearerSecretPrincipalResolverOptions {
  /**
   * Shared bearer secret. Compared in constant time against the token
   * extracted from the request header.
   */
  secret: string;
  /**
   * Principal returned on a successful match. Typically a system user
   * (`{ userId: "system" }`) when the resolver fronts a scheduled or
   * webhook transport.
   */
  principal: ResolvedPrincipal;
  /**
   * HTTP header name to read. Default: `"authorization"`. Header lookup
   * is case-insensitive (the underlying `Headers` API normalizes names).
   */
  headerName?: string;
}

/**
 * Build a principal resolver that authenticates via a shared bearer
 * secret. On match, returns the configured principal. On mismatch,
 * throws `PrincipalResolutionError` with status 401. When the header is
 * absent or the scheme isn't Bearer, returns `null` so the host can
 * apply `defaultUserId` fallback semantics.
 */
export function createBearerSecretPrincipalResolver(
  options: CreateBearerSecretPrincipalResolverOptions
): PrincipalResolver {
  if (typeof options.secret !== "string" || options.secret.length === 0) {
    throw new Error(
      "createBearerSecretPrincipalResolver: `secret` must be a non-empty string."
    );
  }
  if (
    typeof options.principal?.userId !== "string" ||
    options.principal.userId.length === 0
  ) {
    throw new Error(
      "createBearerSecretPrincipalResolver: `principal.userId` must be a non-empty string."
    );
  }

  const expected = Buffer.from(options.secret, "utf8");
  const headerName = (options.headerName ?? "authorization").toLowerCase();

  return (context: PrincipalResolutionContext): ResolvedPrincipal | null => {
    const headerValue = readHeader(context, headerName);
    const token = extractBearerToken(headerValue);
    if (token === null) return null;

    const given = Buffer.from(token, "utf8");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new PrincipalResolutionError("Invalid scheduler secret.", {
        status: 401
      });
    }

    return options.principal;
  };
}

function readHeader(
  context: PrincipalResolutionContext,
  headerName: string
): string | null {
  const req = context.request;
  if (req && typeof req.headers?.get === "function") {
    return req.headers.get(headerName);
  }
  // Non-HTTP transports may set headers on metadata as a plain record.
  const meta = context.envelope.metadata;
  if (meta && typeof meta === "object") {
    const fromMeta = (meta as { headers?: Record<string, unknown> }).headers;
    if (fromMeta && typeof fromMeta === "object") {
      for (const [key, value] of Object.entries(fromMeta)) {
        if (key.toLowerCase() === headerName && typeof value === "string") {
          return value;
        }
      }
    }
  }
  return null;
}
