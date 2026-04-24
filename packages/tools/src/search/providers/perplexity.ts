/**
 * Perplexity Search API adapter.
 *
 * Calls the Perplexity Search API (`POST https://api.perplexity.ai/search`) which returns
 * raw, ranked web results with sub-document granularity. Uses hybrid retrieval combining
 * lexical and semantic signals with LLM-based ranking. No SDK dependency — HTTP only.
 */

import type { SearchProviderAdapter, SearchOutput } from "../types";

export const perplexityAdapter: SearchProviderAdapter = {
  name: "perplexity",
  async search(query, options): Promise<SearchOutput> {
    const response = await globalThis.fetch(
      "https://api.perplexity.ai/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          num_results: options.maxResults,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Perplexity Search API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const items = data.results ?? [];

    return {
      query,
      results: items.slice(0, options.maxResults).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.snippet ?? "",
        publishedDate: r.date ?? r.last_updated ?? undefined,
        source: "perplexity" as const,
      })),
    };
  },
};
