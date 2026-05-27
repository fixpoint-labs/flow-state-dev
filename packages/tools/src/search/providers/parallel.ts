/**
 * Parallel.ai Search API adapter.
 *
 * POSTs to https://api.parallel.ai/v1/search, normalizing the per-result
 * `excerpts[]` array to the framework's snippet/content fields. Auth is the
 * `x-api-key` header (not Bearer — unlike every other provider here). No SDK
 * dependency — one HTTP POST.
 *
 * Execution mode comes from the shared `searchMode` config hint, defaulting to
 * "advanced". Parallel's /v1/search accepts only "advanced" or "basic".
 */

import type { SearchProviderAdapter, SearchOutput } from "../types";

const PARALLEL_SEARCH_ENDPOINT = "https://api.parallel.ai/v1/search";

export const parallelAdapter: SearchProviderAdapter = {
  name: "parallel",
  async search(query, options): Promise<SearchOutput> {
    // `options.topic` is intentionally not forwarded: Parallel's /v1/search has
    // no topic/category filter. The objective string is the only intent channel.
    const response = await globalThis.fetch(PARALLEL_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": options.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objective: query,
        search_queries: [query],
        mode: options.searchMode ?? "advanced",
        advanced_settings: {
          max_results: options.maxResults,
          excerpt_settings: {
            // Parallel truncates softly; size the response off the shared depth knob.
            max_chars_per_result:
              options.searchDepth === "advanced" ? 6000 : 1500,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Parallel Search API error: ${response.status} ${response.statusText}` +
          (body ? ` — ${body}` : "")
      );
    }

    const data = (await response.json()) as {
      results?: Array<{
        url?: string;
        title?: string;
        publish_date?: string | null;
        excerpts?: string[];
      }>;
    };

    const results = (data.results ?? [])
      .slice(0, options.maxResults)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet:
          Array.isArray(r.excerpts) && r.excerpts.length > 0
            ? r.excerpts[0]
            : "",
        content:
          Array.isArray(r.excerpts) && r.excerpts.length > 1
            ? r.excerpts.join("\n\n")
            : undefined,
        publishedDate: r.publish_date ?? undefined,
        source: "parallel" as const,
      }));

    return { query, results };
  },
};
