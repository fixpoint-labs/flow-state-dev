/**
 * Serper (Google SERP) search adapter.
 *
 * A thin proxy over Google web/news results. Serper has no retrieval-depth knob,
 * so the normalized `tier` is a no-op here (reflected in its reduced
 * `capabilities.tiers`, which steers deep searches toward richer providers).
 * Domain filters are emulated with Google `site:` / `-site:` query operators.
 */

import type { SearchProviderAdapter, SearchOutput } from "../types";

export const serperAdapter: SearchProviderAdapter = {
  name: "serper",
  capabilities: { tiers: ["fast", "balanced"] },
  async search(query, options): Promise<SearchOutput> {
    const endpoint =
      options.topic === "news"
        ? "https://google.serper.dev/news"
        : "https://google.serper.dev/search";

    const siteFilters = [
      ...(options.includeDomains ?? []).map((d) => `site:${d}`),
      ...(options.excludeDomains ?? []).map((d) => `-site:${d}`),
    ];
    const q = siteFilters.length ? `${query} ${siteFilters.join(" ")}` : query;

    const response = await globalThis.fetch(endpoint, {
      method: "POST",
      headers: {
        "X-API-KEY": options.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q, num: options.maxResults }),
    });

    if (!response.ok) {
      throw new Error(
        `Serper API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const items = data.organic ?? data.news ?? [];

    return {
      query,
      results: items.slice(0, options.maxResults).map((r: any) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        snippet: r.snippet ?? r.description ?? "",
        publishedDate: r.date ?? undefined,
        source: "serper" as const,
      })),
      answer: data.answerBox?.answer ?? data.answerBox?.snippet ?? undefined,
    };
  },
};
