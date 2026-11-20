/**
 * Plain-object serialization for Error `cause` chains. Lives in core so the
 * framework's failure seams (tool-output capture in `emit-tool-output`, the
 * server's block-trace and terminal-error builders) can attach a JSON-safe
 * view of an error's underlying cause to `item.error.details.cause` without
 * the cause being silently dropped when the item is serialized over SSE.
 *
 * `JSON.stringify(error)` returns `{}` because `name`/`message`/`stack`/`cause`
 * are non-enumerable, so the chain has to be walked and copied explicitly.
 */

/**
 * JSON-safe shape of a serialized error and its `cause` chain. `stack` is
 * intentionally absent — it is large and leaks server paths over the wire;
 * `code` carries undici / Node system codes (e.g. `ECONNRESET`,
 * `UND_ERR_CONNECT_TIMEOUT`) when present.
 */
export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  /** HTTP status a model provider answered with (AI SDK `APICallError`). */
  statusCode?: number;
  cause?: SerializedError;
}

/**
 * Credential shapes a provider may echo back in an error message: OpenAI /
 * Anthropic `sk-…` keys, bearer tokens, Google `AIza…` keys, GitHub tokens,
 * xAI and Groq keys. OpenAI masks most of a rejected key itself; this covers
 * the providers and gateways that don't.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxai-[A-Za-z0-9]{16,}/g,
  /\bgsk_[A-Za-z0-9]{16,}/g,
];

/**
 * Replace API keys and bearer tokens in `text` with `[redacted]`. Applied to
 * every message that leaves the server on an error item, since a provider's
 * refusal can quote the credential it refused.
 */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, "[redacted]"), text);
}

/**
 * Serialize an error (and its `cause` chain) into a plain, JSON-safe object.
 *
 * - Copies the non-enumerable `name`/`message` explicitly.
 * - Includes a string `code` when present (undici / system error codes), and a
 *   numeric `statusCode` when present (a provider's HTTP refusal).
 * - Redacts API keys and bearer tokens from every message (`redactSecrets`).
 * - Recurses into `cause`, bounded by `depth` so a deep or circular chain can
 *   never produce unbounded output (default depth 4).
 * - Null-safe: a missing or non-object `cause` (some Node versions strip it
 *   from `fetch failed`) yields a best-effort `{ name, message }`.
 */
export function serializeError(err: unknown, depth = 4): SerializedError {
  if (depth < 0 || err === null || typeof err !== "object") {
    return { name: "Error", message: redactSecrets(String(err)) };
  }
  const e = err as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  const out: SerializedError = {
    name: typeof e.name === "string" ? e.name : "Error",
    message: redactSecrets(typeof e.message === "string" ? e.message : String(err)),
  };
  if (typeof e.code === "string") {
    out.code = e.code;
  }
  if (typeof e.statusCode === "number") {
    out.statusCode = e.statusCode;
  }
  if (e.cause !== null && e.cause !== undefined) {
    out.cause = serializeError(e.cause, depth - 1);
  }
  return out;
}

/**
 * Build the `error.details` payload for a failed item, folding the error's
 * `cause` chain into `details.cause` so intermediate causes are never swallowed
 * at the item boundary. Returns:
 * - the error's own `details` unchanged when it already carries a `cause` or the
 *   error has no walkable `cause`,
 * - `details` merged with a serialized `cause` when a cause is present,
 * - `undefined` when there is neither `details` nor a `cause` (nothing to attach).
 *
 * A thrower that already serialized its own `cause` into `details` is never
 * overwritten. Shared by the core tool-output seam and the server's block-trace
 * / terminal-error builders so all three produce the same shape.
 */
export function errorDetailsWithCause(err: {
  details?: Record<string, unknown>;
  cause?: unknown;
}): Record<string, unknown> | undefined {
  const base = err.details;
  const hasCause = err.cause !== undefined && err.cause !== null;
  if (hasCause && base?.cause === undefined) {
    return { ...(base ?? {}), cause: serializeError(err.cause) };
  }
  return base;
}
