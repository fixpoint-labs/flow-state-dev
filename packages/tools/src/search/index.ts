import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  searchInputSchema,
  searchOutputSchema,
  searchTiers,
  type SearchConfig,
  type SearchInput,
  type SearchOutput,
  type SearchTier,
} from "./types";
import { resolveProvider } from "./resolver";

/**
 * Creates a search tool for use in generator blocks.
 * Auto-detects the best available search provider from env vars.
 *
 * Provider priority: Parallel → Tavily → Exa → Perplexity → Serper → Brave → Perplexity Sonar
 *
 * By default `tier` is a build-time setting. Pass `agentControlsTier: true` to
 * expose it as a tool parameter so the calling model picks the depth per query.
 */
export function search(config: SearchConfig = {}) {
  const defaultTier = config.tier ?? "balanced";
  // When the agent controls depth, surface `tier` on the tool's input schema so
  // the model can choose per query; otherwise it stays invisible (config-only).
  const inputSchema = config.agentControlsTier
    ? searchInputSchema.extend({
        tier: z
          .enum(searchTiers)
          .default(defaultTier)
          .describe(
            "How thorough vs. fast the search should be: 'fast' for quick lookups, 'balanced' for most queries, 'deep' for thorough research. Use 'deep' when the user asks for in-depth, comprehensive, or research-grade results."
          ),
      })
    : searchInputSchema;

  return handler({
    name: "search",
    description:
      "Search the web for information. Returns titles, URLs, and snippets from web pages matching the query.",
    inputSchema,
    outputSchema: searchOutputSchema,
    execute: async (input: SearchInput & { tier?: SearchTier }): Promise<SearchOutput> => {
      const tier = config.agentControlsTier ? input.tier ?? defaultTier : defaultTier;
      const { adapter, apiKey } = resolveProvider({ ...config, tier });
      return adapter.search(input.query, {
        maxResults: input.maxResults,
        searchDepth: config.searchDepth ?? "basic",
        searchMode: config.searchMode,
        tier,
        includeDomains: config.includeDomains,
        excludeDomains: config.excludeDomains,
        topic: input.topic,
        apiKey,
      });
    },
  });
}

// Direct provider tools — locked to a specific provider
export function tavilySearch(config: Omit<SearchConfig, "provider"> = {}) {
  return search({ ...config, provider: "tavily" });
}

export function exaSearch(config: Omit<SearchConfig, "provider"> = {}) {
  return search({ ...config, provider: "exa" });
}

export function serperSearch(config: Omit<SearchConfig, "provider"> = {}) {
  return search({ ...config, provider: "serper" });
}

export function braveSearch(config: Omit<SearchConfig, "provider"> = {}) {
  return search({ ...config, provider: "brave" });
}

export function parallelSearch(config: Omit<SearchConfig, "provider"> = {}) {
  return search({ ...config, provider: "parallel" });
}

export function perplexitySearch(config: Omit<SearchConfig, "provider"> = {}) {
  return search({ ...config, provider: "perplexity" });
}

export function perplexitySonarSearch(config: Omit<SearchConfig, "provider"> = {}) {
  return search({ ...config, provider: "perplexity-sonar" });
}

// Re-export types
export type {
  SearchConfig,
  SearchResult,
  SearchOutput,
  SearchProviderName,
  SearchProviderAdapter,
  SearchCapabilities,
  SearchTier,
  SearchInput,
} from "./types";
export { searchInputSchema, searchOutputSchema, searchResultSchema, searchProviders, searchTiers } from "./types";

/** Resolve the active provider adapter + API key from `SearchConfig` + env
 *  vars. Exposed for callers that need to run a search outside the
 *  `search()` tool block (e.g. inside another handler's `execute`). */
export { resolveProvider } from "./resolver";
