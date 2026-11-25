/**
 * The single network policy for the built-in fetch and crawl providers.
 *
 * Both open sockets to a URL chosen by the model or scraped from a page, so
 * both need the same bounds, and they live here rather than once per provider:
 * two copies of a security decision drift, and the next tweak would only land
 * on one of them.
 *
 * - Every hop is checked, against the public-address policy and, when the app
 *   set one, its allowed hosts. Redirects are followed by hand rather than with
 *   `redirect: "follow"`, which would hide the hop that matters: a public front
 *   door that redirects to `127.0.0.1` is the standard way past a check that
 *   only looks at the URL it was handed.
 * - The address checked is the address connected to. The dispatcher's
 *   `connect.lookup` is {@link publicAddressLookup}, so a hostname that
 *   re-resolves to a private address after a check (DNS rebinding) is refused
 *   at the socket.
 * - Time and size are bounded. One deadline, combined with the caller's signal,
 *   covers the whole redirect chain and the body; the body is streamed and cut
 *   off at a byte cap instead of buffered whole.
 */
import { Agent } from "undici";
import {
  assertPublicHttpUrl,
  BlockedUrlError,
  normalizeHostname,
  publicAddressLookup,
} from "./public-url";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Deadline for one fetch: every redirect hop plus reading the body. */
const FETCH_TIMEOUT_MS = 30_000;
/** Largest response body read, in bytes. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const dispatcher = new Agent({ connect: { lookup: publicAddressLookup } });

/** Thrown when a redirect chain outlives its budget. */
class TooManyRedirectsError extends Error {
  constructor(url: string) {
    super(`Too many redirects while fetching ${url}`);
    this.name = "TooManyRedirectsError";
  }
}

/** Thrown when a response body is larger than the byte cap. */
export class ResponseTooLargeError extends Error {
  constructor(url: string, maxBytes: number) {
    super(`Response from ${url} is larger than the ${maxBytes}-byte limit`);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * The final response and the URL it actually came from after any redirects.
 * Read the body only through `readBody`, which applies the byte cap and stays
 * under the deadline; a caller that skips the body cancels `response.body`.
 */
export interface ValidatedFetchResult {
  response: Response;
  finalUrl: string;
  /** The body as UTF-8 text; rejects with {@link ResponseTooLargeError} past the cap. */
  readBody(): Promise<string>;
}

export interface FetchValidatedOptions {
  /** The run's signal; aborting it aborts the fetch. */
  signal?: AbortSignal;
  /**
   * Hostnames the fetch may reach, matched exactly (no subdomains). Checked on
   * the starting URL and every redirect hop. Unset: any public host.
   */
  allowedHosts?: readonly string[];
  /** Overrides the deadline. Tests only. */
  timeoutMs?: number;
  /** Overrides the byte cap. Tests only. */
  maxBytes?: number;
}

/**
 * Fetches `url` within the policy above, up to the response headers.
 *
 * Throws {@link BlockedUrlError} for a refused destination (a host outside
 * `allowedHosts`, or one the socket's lookup refused), and otherwise whatever
 * the resolver or the transport threw — a
 * `TimeoutError` when the deadline passes. Callers shape those into their own
 * error types, since a policy refusal and a DNS blip warrant different
 * treatment.
 */
export async function fetchValidated(
  url: string,
  options: FetchValidatedOptions = {},
): Promise<ValidatedFetchResult> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const allowedHosts = options.allowedHosts && new Set(options.allowedHosts.map(normalizeHostname));
  let currentUrl = url;

  try {
    for (let redirects = 0; ; redirects++) {
      const host = normalizeHostname(assertPublicHttpUrl(currentUrl).hostname);
      if (allowedHosts && !allowedHosts.has(host)) {
        const hop = redirects === 0 ? "the starting URL" : `redirect hop ${redirects}`;
        throw new BlockedUrlError(`Host "${host}" is not an allowed host (${hop}: ${currentUrl})`);
      }

      const response = await globalThis.fetch(currentUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FlowStateDev/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal,
        // Node's fetch takes an undici dispatcher; the DOM `RequestInit` type
        // does not declare it.
        dispatcher,
      } as RequestInit);

      const location = REDIRECT_STATUSES.has(response.status)
        ? response.headers.get("location")
        : null;
      if (location === null) {
        const finalUrl = currentUrl;
        return { response, finalUrl, readBody: () => readCapped(response, finalUrl, maxBytes) };
      }

      // Release the redirect body rather than leaving it unread — including the
      // one that exhausts the budget, or an endless redirect chain would strand a
      // connection on every attempt.
      await response.body?.cancel();
      if (redirects === MAX_REDIRECTS) throw new TooManyRedirectsError(url);

      currentUrl = new URL(location, currentUrl).href;
    }
  } catch (error) {
    // A refusal from the socket's lookup arrives wrapped in fetch's
    // `TypeError: fetch failed`; surface it as the refusal it is.
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause !== null && typeof cause === "object"; depth++) {
      if (cause instanceof BlockedUrlError) throw cause;
      cause = (cause as { cause?: unknown }).cause;
    }
    throw error;
  }
}

/** Reads `response`'s body as UTF-8 text, refusing past `maxBytes`. */
async function readCapped(response: Response, url: string, maxBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError(url, maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
}
