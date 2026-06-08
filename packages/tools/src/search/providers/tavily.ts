/**
 * Tavily search adapter.
 *
 * Wraps the `@tavily/core` SDK. Tavily exposes a single `searchDepth` knob that
 * means retrieval thoroughness, so the normalized `tier` drives it: `deep` (or a
 * legacy `searchDepth: "advanced"`) maps to "advanced", otherwise "basic".
 */

import type { SearchProviderAdapter, SearchOutput } from "../types";

export const tavilyAdapter: SearchProviderAdapter = {
  name: "tavily",
  capabilities: { tiers: ["fast", "balanced", "deep"] },
  async search(query, options): Promise<SearchOutput> {
    let tavilyModule: any;
    try {
      tavilyModule = await import("@tavily/core");
    } catch {
      throw new Error(
        "Install @tavily/core to use the Tavily search provider: npm install @tavily/core"
      );
    }

    const client = tavilyModule.tavily({ apiKey: options.apiKey });
    // Map the normalized tier onto Tavily's retrieval-depth knob, preserving the
    // existing `searchDepth: "advanced"` content escalation as an "advanced" trigger.
    const searchDepth =
      options.tier === "deep" || options.searchDepth === "advanced"
        ? "advanced"
        : "basic";
    const response = await client.search(query, {
      maxResults: options.maxResults,
      searchDepth,
      topic: options.topic,
      includeAnswer: true,
      ...(options.includeDomains?.length
        ? { includeDomains: options.includeDomains }
        : {}),
      ...(options.excludeDomains?.length
        ? { excludeDomains: options.excludeDomains }
        : {}),
    });

    return {
      query,
      results: (response.results ?? []).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
        score: r.score ?? undefined,
        publishedDate: r.publishedDate ?? undefined,
        source: "tavily" as const,
      })),
      answer: response.answer ?? undefined,
    };
  },
};
