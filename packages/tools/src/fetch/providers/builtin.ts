import type { FetchProviderAdapter, FetchResult } from "../types";
import { htmlToMarkdown } from "../../_internal/html-to-markdown";

export const builtinFetchAdapter: FetchProviderAdapter = {
  name: "builtin",
  async fetch(url, _options): Promise<FetchResult> {
    const response = await globalThis.fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FlowStateDev/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(
        `Fetch failed: ${response.status} ${response.statusText} for ${url}`
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
