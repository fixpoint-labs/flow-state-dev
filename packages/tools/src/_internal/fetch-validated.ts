/**
 * The single redirect policy for the built-in fetch and crawl providers.
 *
 * Both open sockets to a URL chosen by the model or scraped from a page, so
 * both need every hop checked against {@link assertPublicHttpUrl} — a public
 * front door that redirects to `127.0.0.1` is the standard way past a check
 * that only looks at the URL it was handed. Redirects are therefore followed by
 * hand rather than with `redirect: "follow"`, which would hide the hop that
 * matters.
 *
 * It lives here, shared, rather than once per provider: two copies of a
 * security decision drift, and the next tweak would only land on one of them.
 */
import { assertPublicHttpUrl } from "./public-url";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Thrown when a redirect chain outlives its budget. */
class TooManyRedirectsError extends Error {
  constructor(url: string) {
    super(`Too many redirects while fetching ${url}`);
    this.name = "TooManyRedirectsError";
  }
}

/** The response, plus the URL it actually came from after any redirects. */
export interface ValidatedFetchResult {
  response: Response;
  finalUrl: string;
}

/**
 * Fetches `url`, validating it and each redirect target before the socket
 * opens.
 *
 * Throws whatever the guard, the resolver, or the transport threw — callers
 * shape those into their own error types, since a policy refusal and a DNS
 * blip warrant different treatment.
 */
export async function fetchValidated(url: string): Promise<ValidatedFetchResult> {
  let currentUrl = url;

  for (let redirects = 0; ; redirects++) {
    await assertPublicHttpUrl(currentUrl);

    const response = await globalThis.fetch(currentUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FlowStateDev/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }
    const location = response.headers.get("location");
    if (location === null) return { response, finalUrl: currentUrl };
    if (redirects === MAX_REDIRECTS) throw new TooManyRedirectsError(url);

    // Release the redirect body rather than leaving it unread.
    await response.body?.cancel();
    currentUrl = new URL(location, currentUrl).href;
  }
}
