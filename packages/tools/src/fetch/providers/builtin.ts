import type { FetchProviderAdapter, FetchResult } from "../types";
import { htmlToMarkdown } from "../../_internal/html-to-markdown";
import { httpFetchError, readTruncatedBody, transportFetchError } from "../errors";
import { assertPublicHttpUrl } from "../../_internal/public-url";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const builtinFetchAdapter: FetchProviderAdapter = {
  name: "builtin",
  async fetch(url, _options): Promise<FetchResult> {
    let currentUrl = url;
    let response: Response;

    // Redirects are followed by hand so every hop is validated. `redirect:
    // "follow"` would let a public URL bounce the socket to a private one
    // inside a single call, which is the standard way past a front-door check.
    for (let redirects = 0; ; redirects++) {
      // Outside the try: a blocked destination is a policy failure, not a
      // transport one, and must not be reshaped into a retryable fetch error.
      await assertPublicHttpUrl(currentUrl);

      try {
        response = await globalThis.fetch(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FlowStateDev/1.0)",
            Accept: "text/html,application/xhtml+xml",
          },
          redirect: "manual",
        });
      } catch (cause) {
        throw transportFetchError("builtin", currentUrl, cause);
      }

      if (!REDIRECT_STATUSES.has(response.status)) break;
      const location = response.headers.get("location");
      if (location === null) break;
      if (redirects === MAX_REDIRECTS) {
        throw transportFetchError(
          "builtin",
          url,
          new Error(`Too many redirects while fetching ${url}`),
        );
      }
      // Release the redirect body rather than leaving it unread.
      await response.body?.cancel();
      currentUrl = new URL(location, currentUrl).href;
    }

    if (!response.ok) {
      throw httpFetchError(
        "builtin",
        currentUrl,
        response,
        await readTruncatedBody(response),
      );
    }

    const html = await response.text();
    const contentType = response.headers.get("content-type") ?? "text/html";
    const parsed = htmlToMarkdown(html, currentUrl);

    return {
      url: currentUrl,
      title: parsed.title,
      markdown: parsed.markdown,
      metadata: {
        statusCode: response.status,
        contentType,
        wordCount: parsed.wordCount,
      },
      source: "builtin" as const,
    };
  },
};
