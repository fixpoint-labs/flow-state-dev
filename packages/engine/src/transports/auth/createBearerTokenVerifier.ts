/**
 * Bearer-token verifier helpers.
 *
 * Hosts compose these inside `authentication.resolvePrincipal` to extract
 * and verify a bearer token from the `Authorization` header. Two helpers:
 *
 *   - `extractBearerToken` — case-insensitive scheme parser. Returns the
 *     token, or `null` if the header is absent or the scheme isn't Bearer.
 *
 *   - `createHs256JwtVerifier` — verifies HS256-signed JWTs against a
 *     shared secret. Validates the standard `exp` and `nbf` claims when
 *     present (with an optional clock skew tolerance) and returns the
 *     parsed payload. Asymmetric algorithms are out of scope here; hosts
 *     using RS256/ES256 plug in a JWKS verifier of their choice.
 *
 * Both helpers throw nothing — invalid input returns `null`. The host
 * decides whether `null` becomes `PrincipalResolutionError` or a fall-back
 * to `defaultUserId`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const BEARER_SCHEME = /^bearer\s+/i;

/**
 * Extract the bearer token from an `Authorization` header value. The match
 * is case-insensitive ("Bearer", "bearer", "BEARER" all accepted) and any
 * surrounding whitespace is trimmed. Returns `null` for malformed input.
 */
export function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (typeof headerValue !== "string") return null;
  const trimmed = headerValue.trim();
  if (!BEARER_SCHEME.test(trimmed)) return null;
  const token = trimmed.replace(BEARER_SCHEME, "").trim();
  return token.length > 0 ? token : null;
}

/**
 * Standard JWT registered claims this verifier inspects. Hosts read custom
 * claims off the returned payload directly; nothing here is opinionated
 * about identity-shape (no enforced `userId` / `sub` mapping).
 */
export interface JwtPayload {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [claim: string]: unknown;
}

export interface CreateHs256JwtVerifierOptions {
  /** Shared secret used to compute the HS256 signature. */
  secret: string;
  /**
   * Allowed `iss` value(s). When set, tokens whose `iss` is missing or not
   * in the list are rejected.
   */
  issuer?: string | string[];
  /**
   * Allowed `aud` value(s). When set, tokens whose `aud` doesn't intersect
   * the list are rejected. Tokens with no `aud` claim are rejected when
   * this option is present.
   */
  audience?: string | string[];
  /**
   * Maximum allowed clock skew (seconds) when checking `exp` and `nbf`.
   * Default: 0. Increase for distributed-system tolerance.
   */
  clockSkewSeconds?: number;
  /** Clock used for expiration checks. Test seam. */
  now?: () => number;
}

/**
 * HS256 JWT verifier. Returns the verified payload on success, `null` on
 * any verification failure (bad signature, malformed, expired, audience
 * mismatch). Use the returned payload to construct your `ResolvedPrincipal`.
 */
export type Hs256JwtVerifier = (token: string | null | undefined) => JwtPayload | null;

/**
 * Build a JWT verifier for HS256-signed tokens. Hosts call the returned
 * function with the token extracted from `Authorization`. Asymmetric
 * algorithms are not supported here — they require key resolution
 * machinery (JWKS) that's a separate concern.
 */
export function createHs256JwtVerifier(
  options: CreateHs256JwtVerifierOptions
): Hs256JwtVerifier {
  const issuer = options.issuer === undefined
    ? undefined
    : Array.isArray(options.issuer)
      ? options.issuer
      : [options.issuer];
  const audience = options.audience === undefined
    ? undefined
    : Array.isArray(options.audience)
      ? options.audience
      : [options.audience];
  const skew = options.clockSkewSeconds ?? 0;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  return (token) => {
    if (typeof token !== "string" || token.length === 0) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    const header = decodeJsonSegment(headerB64);
    if (header === null || typeof header !== "object") return null;
    if ((header as { alg?: unknown }).alg !== "HS256") return null;
    if (
      (header as { typ?: unknown }).typ !== undefined &&
      (header as { typ?: unknown }).typ !== "JWT"
    ) {
      return null;
    }

    const expectedSig = createHmac("sha256", options.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const givenSig = base64UrlToBuffer(signatureB64);
    if (givenSig === null) return null;
    if (expectedSig.length !== givenSig.length) return null;
    if (!timingSafeEqual(expectedSig, givenSig)) return null;

    const payload = decodeJsonSegment(payloadB64);
    if (payload === null || typeof payload !== "object") return null;

    const claims = payload as JwtPayload;
    const ts = now();

    if (typeof claims.exp === "number" && ts > claims.exp + skew) return null;
    if (typeof claims.nbf === "number" && ts + skew < claims.nbf) return null;

    if (issuer !== undefined) {
      if (typeof claims.iss !== "string" || !issuer.includes(claims.iss)) return null;
    }
    if (audience !== undefined) {
      const aud = claims.aud;
      const audList = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : [];
      if (!audList.some((a) => audience.includes(a))) return null;
    }

    return claims;
  };
}

function decodeJsonSegment(segment: string): unknown {
  const buf = base64UrlToBuffer(segment);
  if (buf === null) return null;
  try {
    return JSON.parse(buf.toString("utf-8"));
  } catch {
    return null;
  }
}

function base64UrlToBuffer(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  const padded = input + "===".slice((input.length + 3) % 4);
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(standard, "base64");
  } catch {
    return null;
  }
}
