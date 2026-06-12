/**
 * Brave Search adapter.
 *
 * Brave has no retrieval-depth knob and no first-class domain include/exclude
 * filter, so the normalized `tier` and domain filters are no-ops here. The
 * reduced `capabilities.tiers` steers `deep` requests toward richer providers
 * during auto-selection.
 */

import type { SearchProviderAdapter, SearchOutput } from "../types";

export const braveAdapter: SearchProviderAdapter = {
  name: "brave",
  capabilities: { tiers: ["fast", "balanced"] },
  async search(query, options): Promise<SearchOutput> {
    const params = new URLSearchParams({
      q: query,
      count: String(options.maxResults),
    });

    const response = await globalThis.fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": options.apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Brave Search API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const items = data.web?.results ?? [];

    return {
      query,
      results: items.slice(0, options.maxResults).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
        source: "brave" as const,
      })),
    };
  },
};
