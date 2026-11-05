/**
 * Brave Search adapter.
 *
 * Brave has no retrieval-depth knob, so the normalized `tier` is a no-op here;
 * the reduced `capabilities.tiers` steers `deep` requests toward richer
 * providers during auto-selection. Domain filters are written into the query
 * as `site:` / `-site:` operators, as for Serper.
 */

import type { SearchProviderAdapter, SearchOutput } from "../types";
import { withSiteOperators } from "./domain-filters";

export const braveAdapter: SearchProviderAdapter = {
  name: "brave",
  capabilities: { tiers: ["fast", "balanced"] },
  async search(query, options): Promise<SearchOutput> {
    const params = new URLSearchParams({
      q: withSiteOperators(query, options.includeDomains, options.excludeDomains),
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
