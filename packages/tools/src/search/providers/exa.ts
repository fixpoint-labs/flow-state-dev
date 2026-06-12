/**
 * Exa search adapter.
 *
 * Wraps the `exa-js` SDK's `searchAndContents`. The normalized `tier` maps to
 * Exa's `type` (fast → "fast", balanced → "auto", deep → "deep"); a `searchMode`
 * override replaces it verbatim, which is how callers reach Exa-specific types
 * like "neural", "instant", or "deep-reasoning". `searchDepth` independently
 * controls how much content is pulled per result.
 */

import type { SearchProviderAdapter, SearchOutput, SearchTier } from "../types";

const TIER_TO_TYPE: Record<SearchTier, string> = {
  fast: "fast",
  balanced: "auto",
  deep: "deep",
};

export const exaAdapter: SearchProviderAdapter = {
  name: "exa",
  capabilities: { tiers: ["fast", "balanced", "deep"] },
  async search(query, options): Promise<SearchOutput> {
    let ExaModule: any;
    try {
      ExaModule = await import("exa-js");
    } catch {
      throw new Error(
        "Install exa-js to use the Exa search provider: npm install exa-js"
      );
    }

    const Exa = ExaModule.default ?? ExaModule.Exa;
    const client = new Exa(options.apiKey);
    // searchMode (provider-native passthrough) wins over the tier mapping.
    const type = options.searchMode ?? TIER_TO_TYPE[options.tier ?? "balanced"];
    const response = await client.searchAndContents(query, {
      numResults: options.maxResults,
      type,
      text:
        options.searchDepth === "advanced"
          ? true
          : { maxCharacters: 500 },
      highlights: true,
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
        snippet: r.highlights?.[0] ?? r.text?.slice(0, 300) ?? "",
        content:
          options.searchDepth === "advanced"
            ? r.text
            : undefined,
        score: r.score ?? undefined,
        publishedDate: r.publishedDate ?? undefined,
        source: "exa" as const,
      })),
    };
  },
};
