/**
 * Webhook signature verifiers — the `verify` slot of a host
 * `WebhookProviderDefinition`.
 *
 * The webhook adapter passes the request's `(rawBody, headers)` to `verify`;
 * a verifier locates the provider's signature header(s) and confirms the
 * request is authentic. `createWebhookVerifier` adapts the shipped
 * `createHmacVerifier` (which takes a single header-value string) by pulling
 * the named header out of the `Headers` object. `stripe`/`github` presets are
 * thin wrappers over it; Slack needs a bespoke scheme (`v0:<ts>:<body>` with
 * the timestamp in a separate header) so it does its own HMAC.
 *
 * Secrets may be passed directly or as a getter resolved lazily on first use,
 * so a host can reference an env var that is populated after module load.
 */
import { createHmac } from "node:crypto";
import { createHmacVerifier, type CreateHmacVerifierOptions } from "./createHmacVerifier";
import { constantTimeStringEqual } from "./constant-time";

/** A webhook `verify` function: authentic request → `true`. */
export type WebhookVerifier = (rawBody: Uint8Array, headers: Headers) => boolean;

export interface CreateWebhookVerifierOptions extends Omit<CreateHmacVerifierOptions, "secret"> {
  /** Request header carrying the signature, e.g. `"stripe-signature"`. */
  header: string;
  /** Shared secret, or a getter resolved lazily on first use. */
  secret: string | (() => string);
}

/**
 * Build a webhook verifier from an HMAC scheme. Wraps `createHmacVerifier`,
 * reading the configured `header` off the request's `Headers`. The underlying
 * verifier is constructed lazily on first call so a getter `secret` can read
 * an env var populated after import.
 */
export function createWebhookVerifier(options: CreateWebhookVerifierOptions): WebhookVerifier {
  const { header, secret, ...hmacOptions } = options;
  let verifier: ReturnType<typeof createHmacVerifier> | undefined;
  return (rawBody, headers) => {
    if (verifier === undefined) {
      verifier = createHmacVerifier({
        ...hmacOptions,
        secret: typeof secret === "function" ? secret() : secret
      });
    }
    return verifier(rawBody, headers.get(header));
  };
}

/**
 * Stripe webhook verifier. Reads `Stripe-Signature` (`t=<ts>,v1=<hex>`),
 * signs `<ts>.<rawBody>`, and rejects timestamps older than `toleranceSeconds`
 * (default 300s) to defend against replay.
 */
export function stripeWebhookVerifier(
  secret: string | (() => string),
  options: { toleranceSeconds?: number } = {}
): WebhookVerifier {
  return createWebhookVerifier({
    header: "stripe-signature",
    format: "stripe",
    secret,
    ...(options.toleranceSeconds !== undefined
      ? { toleranceSeconds: options.toleranceSeconds }
      : {})
  });
}

/**
 * GitHub webhook verifier. Reads `X-Hub-Signature-256` (`sha256=<hex>`) and
 * signs the raw body. GitHub carries the event type in the `X-GitHub-Event`
 * header (read by the provider's `eventType` extractor, not here).
 */
export function githubWebhookVerifier(secret: string | (() => string)): WebhookVerifier {
  return createWebhookVerifier({
    header: "x-hub-signature-256",
    format: "raw",
    prefix: "sha256=",
    secret
  });
}

export interface SlackWebhookVerifierOptions {
  /** Max age (seconds) of the signed timestamp. Default 300. `Infinity` disables. */
  toleranceSeconds?: number;
  /** Clock used for the timestamp check. Test seam. */
  now?: () => number;
}

/**
 * Slack (Events API) webhook verifier. Slack's scheme differs from the generic
 * HMAC helper: the signed base string is `v0:<timestamp>:<rawBody>` where the
 * timestamp comes from a *separate* `X-Slack-Request-Timestamp` header and the
 * signature (`v0=<hex>`) from `X-Slack-Signature`. The timestamp check rejects
 * stale requests (default 300s window).
 */
export function slackWebhookVerifier(
  secret: string | (() => string),
  options: SlackWebhookVerifierOptions = {}
): WebhookVerifier {
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  // Resolve a getter secret once, matching createWebhookVerifier's memoization,
  // so a secrets-manager-backed getter isn't hit on every inbound webhook.
  let resolvedSecret: string | undefined;
  return (rawBody, headers) => {
    const signature = headers.get("x-slack-signature");
    const timestampHeader = headers.get("x-slack-request-timestamp");
    if (typeof signature !== "string" || signature.length === 0) return false;
    // Strict integer check: Slack signs the *literal* header value, so we must
    // sign over the original bytes (not a re-stringified parse). Reject any
    // non-canonical timestamp rather than letting parseInt silently clean it.
    if (typeof timestampHeader !== "string" || !/^\d+$/.test(timestampHeader)) return false;

    const timestamp = Number.parseInt(timestampHeader, 10);
    if (Number.isFinite(toleranceSeconds) && Math.abs(now() - timestamp) > toleranceSeconds) {
      return false;
    }

    // Base string uses the original header value verbatim: `v0:<ts>:<rawBody>`.
    const prefix = new TextEncoder().encode(`v0:${timestampHeader}:`);
    const signedPayload = new Uint8Array(prefix.length + rawBody.length);
    signedPayload.set(prefix, 0);
    signedPayload.set(rawBody, prefix.length);

    if (resolvedSecret === undefined) {
      resolvedSecret = typeof secret === "function" ? secret() : secret;
    }
    const expected = `v0=${createHmac("sha256", resolvedSecret).update(signedPayload).digest("hex")}`;
    return constantTimeStringEqual(signature, expected);
  };
}
