/**
 * HMAC signature verifier — convenience helper for webhook resolvers.
 *
 * Hosts compose this inside their `authentication.resolvePrincipal` to
 * verify webhook signatures before returning the principal. The framework
 * stores no secrets; the verifier is a pure function over `(rawBody,
 * signatureHeader, secret)`. Constant-time comparison guards against
 * timing-oracle attacks even when the verifier returns `false`.
 *
 * Two header formats are supported out of the box:
 *
 *   - Raw: `sha256=<hex>` — GitHub-style. The header carries one signature
 *     prefixed by the algorithm. Verifier signs the raw body and compares.
 *
 *   - Versioned with timestamp: `t=<ts>,v1=<hex>` — Stripe-style. The
 *     header carries a timestamp and one or more `vN` signatures. Verifier
 *     signs `<ts>.<rawBody>` and compares against the matching version.
 *     Optional `toleranceSeconds` rejects stale timestamps; default 300s.
 *
 * Custom formats are supported by passing a `parseSignature` function that
 * extracts the timestamp (optional) and signature(s) from the header.
 */
import { createHmac } from "node:crypto";
import { constantTimeStringEqual } from "./constant-time";

export type HmacAlgorithm = "sha256" | "sha1" | "sha512";

export type HmacEncoding = "hex" | "base64" | "base64url";

/**
 * Parsed signature components. `timestamp` is the UNIX seconds value when
 * the header carries one (Stripe-style); `signatures` lists every candidate
 * signature found, all of which are checked.
 */
export interface ParsedHmacSignature {
  timestamp?: number;
  signatures: string[];
}

export type HmacSignatureParser = (headerValue: string) => ParsedHmacSignature | null;

export interface CreateHmacVerifierOptions {
  /** Shared secret used to compute the HMAC. */
  secret: string;
  /** Hash algorithm. Default: `sha256`. */
  algorithm?: HmacAlgorithm;
  /** Signature encoding. Default: `hex`. */
  encoding?: HmacEncoding;
  /**
   * Header format. `raw` matches `[prefix=]<sig>`; `stripe` matches
   * `t=<ts>,v1=<sig>[,vN=<sig>...]`. For other formats, pass `custom` and
   * supply `parseSignature`.
   */
  format?: "raw" | "stripe" | "custom";
  /**
   * Signature prefix for `raw` format (e.g. `sha256=` for GitHub). Stripped
   * before comparison. Ignored when `format` is not `raw`. Default: empty.
   */
  prefix?: string;
  /**
   * For `stripe` format: maximum allowed age (seconds) of the signed
   * timestamp. Older timestamps are rejected even if the signature
   * matches, defending against replay. Default: 300 (5 minutes). Set to
   * `Infinity` to disable.
   */
  toleranceSeconds?: number;
  /**
   * Custom parser when `format: "custom"`. Required in that mode. Receives
   * the raw header value, returns the parsed signature(s) or `null` if the
   * header is malformed. Returning `null` causes verification to fail.
   */
  parseSignature?: HmacSignatureParser;
  /** Clock used for timestamp tolerance checks. Test seam. */
  now?: () => number;
}

/**
 * Returned verifier. Returns `true` when at least one parsed signature
 * matches the computed HMAC over the canonical signed payload.
 */
export type HmacVerifier = (
  rawBody: Uint8Array,
  signatureHeader: string | null | undefined
) => boolean;

/**
 * Build a webhook HMAC signature verifier. Returns a function that hosts
 * call inside `resolvePrincipal` with the request's raw body and signature
 * header value.
 */
export function createHmacVerifier(options: CreateHmacVerifierOptions): HmacVerifier {
  const algorithm: HmacAlgorithm = options.algorithm ?? "sha256";
  const encoding: HmacEncoding = options.encoding ?? "hex";
  const format = options.format ?? "raw";
  const prefix = options.prefix ?? "";
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  const parser: HmacSignatureParser =
    format === "custom"
      ? requireCustomParser(options.parseSignature)
      : format === "stripe"
        ? parseStripeSignature
        : (header) => parseRawSignature(header, prefix);

  return (rawBody, signatureHeader) => {
    if (typeof signatureHeader !== "string" || signatureHeader.length === 0) {
      return false;
    }
    const parsed = parser(signatureHeader);
    if (parsed === null || parsed.signatures.length === 0) {
      return false;
    }

    if (parsed.timestamp !== undefined && Number.isFinite(toleranceSeconds)) {
      const age = Math.abs(now() - parsed.timestamp);
      if (age > toleranceSeconds) {
        return false;
      }
    }

    const signedPayload = buildSignedPayload(rawBody, parsed.timestamp);
    const expected = createHmac(algorithm, options.secret)
      .update(signedPayload)
      .digest(encoding);

    for (const candidate of parsed.signatures) {
      if (constantTimeStringEqual(candidate, expected)) {
        return true;
      }
    }
    return false;
  };
}

/**
 * Parse `sha256=<hex>` style headers. The `prefix` (e.g. `sha256=`) is
 * stripped before comparison. Returns `null` on malformed input.
 */
function parseRawSignature(headerValue: string, prefix: string): ParsedHmacSignature | null {
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return null;
  if (prefix.length > 0) {
    if (!trimmed.startsWith(prefix)) return null;
    return { signatures: [trimmed.slice(prefix.length)] };
  }
  return { signatures: [trimmed] };
}

/**
 * Parse Stripe-style `t=<ts>,v1=<sig>[,vN=<sig>...]` headers. Every `vN`
 * signature is collected; verification accepts any matching version so
 * Stripe rotations don't break callers. Returns `null` if no timestamp or
 * no signatures parse.
 */
function parseStripeSignature(headerValue: string): ParsedHmacSignature | null {
  const parts = headerValue.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const ts = Number.parseInt(value, 10);
      if (Number.isFinite(ts)) timestamp = ts;
    } else if (/^v\d+$/.test(key)) {
      signatures.push(value);
    }
  }
  if (timestamp === undefined || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function requireCustomParser(parser: HmacSignatureParser | undefined): HmacSignatureParser {
  if (parser === undefined) {
    throw new Error(
      "createHmacVerifier({ format: \"custom\" }) requires a parseSignature function"
    );
  }
  return parser;
}

function buildSignedPayload(rawBody: Uint8Array, timestamp: number | undefined): Uint8Array {
  if (timestamp === undefined) return rawBody;
  // Stripe canonicalization: `<timestamp>.<rawBody>`.
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const out = new Uint8Array(prefix.length + rawBody.length);
  out.set(prefix, 0);
  out.set(rawBody, prefix.length);
  return out;
}
