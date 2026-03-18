import { handler } from "@flow-state-dev/core";
import {
  searchInputSchema,
  searchOutputSchema,
  type SearchConfig,
  type SearchInput,
  type SearchOutput,
} from "./types";
import { resolveProvider } from "./resolver";

/**
 * Creates a search tool for use in generator blocks.
 * Auto-detects the best available search provider from env vars.
 *
 * Provider priority: Tavily → Exa → Serper → Brave
 */
export function search(config: SearchConfig = {}) {
  return handler({
    name: "search",
    description:
      "Search the web for information. Returns titles, URLs, and snippets from web pages matching the query.",
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    execute: async (input: SearchInput): Promise<SearchOutput> => {
      const { adapter, apiKey } = resolveProvider(config);
      return adapter.search(input.query, {
        maxResults: input.maxResults ?? config.maxResults ?? 5,
        searchDepth: config.searchDepth ?? "basic",
        topic: input.topic ?? config.topic ?? "general",
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

// Re-export types
export type {
  SearchConfig,
  SearchResult,
  SearchOutput,
  SearchProviderName,
  SearchProviderAdapter,
  SearchInput,
} from "./types";
export { searchInputSchema, searchOutputSchema, searchResultSchema, searchProviders } from "./types";
