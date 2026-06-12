/**
 * Error classification and shaping for the fetch tool. Turns the two failure
 * modes of `globalThis.fetch` — a non-2xx HTTP response (which does NOT throw)
 * and a transport failure (a bare `TypeError: fetch failed` with the real
 * reason buried in `error.cause`) — into a `FlowError` carrying structured,
 * devtool-renderable detail: an `errorType` classification, the HTTP status and
 * a truncated response body when available, and the original `cause` so the
 * chain survives to the transcript (FIX-723).
 */
import { FlowError } from "@flow-state-dev/core";

/** Failure category surfaced in `error.details.errorType`. */
export type FetchErrorType = "http" | "network" | "timeout" | "abort" | "parse" | "unknown";

/** Max characters of a non-2xx response body retained for error reporting. */
const BODY_LIMIT = 1000;

/** Walk the `cause` chain for the first string `code` (undici / system code). */
function findCode(err: unknown, depth = 4): string | undefined {
  let e: unknown = err;
  while (e !== null && typeof e === "object" && depth >= 0) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    e = (e as { cause?: unknown }).cause;
    depth -= 1;
  }
  return undefined;
}

/**
 * Classify a thrown (transport-level) fetch failure from its name and the
 * `code` carried on its `cause` chain. HTTP non-2xx responses are handled
 * separately by {@link httpFetchError} — they never reach this path because
 * `fetch` resolves rather than throwing for them.
 */
export function classifyFetchFailure(err: unknown): FetchErrorType {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "AbortError") return "abort";
  if (name === "TimeoutError") return "timeout";
  // The bundled adapters only route transport throws (always a `TypeError`)
  // here, so `parse` is not reached today; it keeps the classifier complete for
  // an adapter that parses a response body inside its own transport guard.
  if (err instanceof SyntaxError) return "parse";

  const code = findCode(err);
  if (code === undefined) return "unknown";
  if (code === "UND_ERR_ABORTED" || code === "ABORT_ERR") return "abort";
  if (code.includes("TIMEOUT") || code === "ETIMEDOUT") {
    return "timeout";
  }
  // ENOTFOUND / EAI_AGAIN (DNS), ECONNRESET, ECONNREFUSED, UND_ERR_SOCKET,
  // TLS codes, etc. — all transport-level, retryable network failures.
  return "network";
}

/**
 * Read and length-cap a response body for error reporting. Safe to call once
 * (the body stream is single-consumption); returns `""` if the body cannot be
 * read (e.g. the connection reset mid-read).
 */
export async function readTruncatedBody(res: Response, max = BODY_LIMIT): Promise<string> {
  try {
    const text = await res.text();
    return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
  } catch {
    return "";
  }
}

/**
 * Build the `FlowError` thrown for a non-2xx HTTP response. Carries the status,
 * status text, the (already truncated) response body, and the URL in
 * `details`. 5xx is retryable; 4xx is not.
 */
export function httpFetchError(
  provider: string,
  url: string,
  res: Response,
  body: string
): FlowError {
  // 5xx is transient; 429 (rate limited) and 408 (request timeout) are too.
  const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
  return new FlowError(
    `${provider} fetch failed: ${res.status} ${res.statusText} for ${url}`,
    {
      code: "fetch_http_error",
      retryable,
      details: {
        errorType: "http" satisfies FetchErrorType,
        httpStatus: res.status,
        httpStatusText: res.statusText,
        ...(body ? { responseBody: body } : {}),
        url,
      },
    }
  );
}

/**
 * Build the `FlowError` thrown for a transport-level failure (DNS, socket, TLS,
 * timeout, abort). Classifies the failure, attaches the original error as
 * `cause` (serialized into `details.cause` downstream), and marks network /
 * timeout failures retryable.
 */
export function transportFetchError(provider: string, url: string, cause: unknown): FlowError {
  const errorType = classifyFetchFailure(cause);
  const retryable = errorType === "network" || errorType === "timeout";
  // The underlying code (e.g. ECONNRESET) is preserved on the serialized
  // `cause` chain downstream, so it isn't duplicated as a flat detail key.
  return new FlowError(`${provider} fetch failed (${errorType}) for ${url}`, {
    code: "fetch_transport_error",
    retryable,
    cause,
    details: {
      errorType,
      url,
    },
  });
}

/**
 * Build the `FlowError` thrown when a provider SDK reports failure without an
 * HTTP `Response` to inspect (e.g. Firecrawl's `{ success: false, error }`).
 *
 * Defaults to `retryable: false` (fail fast): with no status to inspect, the
 * failure could be permanent (bad API key, blocked content, invalid URL), and
 * retrying an opaque SDK error just burns the retry budget before surfacing it.
 * `errorType` is `"unknown"` — there is no HTTP status to justify `"http"`, and
 * `"unknown"` renders an honest badge in the devtool instead of an empty one.
 */
export function providerFetchError(provider: string, url: string, message: string): FlowError {
  return new FlowError(`${provider} fetch failed: ${message} for ${url}`, {
    code: "fetch_provider_error",
    retryable: false,
    details: {
      errorType: "unknown" satisfies FetchErrorType,
      url,
    },
  });
}
