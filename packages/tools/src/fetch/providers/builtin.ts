import type { FetchProviderAdapter, FetchResult } from "../types";
import { htmlToMarkdown } from "../../_internal/html-to-markdown";
import {
  httpFetchError,
  readTruncatedBody,
  transportFetchError,
} from "../errors";
import { assertPublicHttpUrl } from "./public-url";

const MAX_REDIRECTS = 5;

export const builtinFetchAdapter: FetchProviderAdapter = {
  name: "builtin",
  async fetch(url, _options): Promise<FetchResult> {
    let response: Response;
    try {
      let currentUrl = url;
      for (let redirects = 0; ; redirects += 1) {
        await assertPublicHttpUrl(currentUrl);
        response = await globalThis.fetch(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FlowStateDev/1.0)",
            Accept: "text/html,application/xhtml+xml",
          },
          redirect: "manual",
        });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (location === null) break;
        if (redirects >= MAX_REDIRECTS)
          throw new Error(`Too many redirects while fetching ${url}`);
        currentUrl = new URL(location, currentUrl).href;
      }
    } catch (cause) {
      throw transportFetchError("builtin", url, cause);
    }

    if (!response.ok) {
      throw httpFetchError(
        "builtin",
        url,
        response,
        await readTruncatedBody(response),
      );
    }

    const html = await response.text();
    const contentType = response.headers.get("content-type") ?? "text/html";
    const parsed = htmlToMarkdown(html, url);

    return {
      url,
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
