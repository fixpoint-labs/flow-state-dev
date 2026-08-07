import type { FetchProviderAdapter, FetchResult } from "../types";
import { htmlToMarkdown } from "../../_internal/html-to-markdown";
import {
  httpFetchError,
  readTruncatedBody,
  transportFetchError,
} from "../errors";
import { assertPublicHttpUrl } from "../url-safety";

const MAX_REDIRECTS = 5;

export const builtinFetchAdapter: FetchProviderAdapter = {
  name: "builtin",
  async fetch(url, _options): Promise<FetchResult> {
    let currentUrl = url;
    let response: Response | undefined;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
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

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");
      if (!location) break;
      if (redirects === MAX_REDIRECTS) {
        throw new Error(`builtin fetch failed: too many redirects for ${url}`);
      }
      await response.body?.cancel();
      currentUrl = new URL(location, currentUrl).href;
    }

    if (!response)
      throw new Error(`builtin fetch failed: no response for ${url}`);
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
