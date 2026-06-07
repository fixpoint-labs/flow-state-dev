import { z } from "zod";

// --- Provider enum ---

export const searchProviders = ["tavily", "exa", "perplexity", "serper", "brave", "parallel", "perplexity-sonar"] as const;
export type SearchProviderName = (typeof searchProviders)[number];

// --- Normalized retrieval-depth tier ---

/**
 * Provider-agnostic retrieval-thoroughness tier. A deliberately small, lossy
 * vocabulary mapped per-provider — not a copy of any single vendor's enum.
 * `fast` favours latency, `deep` favours thoroughness, `balanced` is the
 * sensible default. Each adapter maps it to its native knob; providers with no
 * depth concept (serper, brave) ignore it.
 */
export const searchTiers = ["fast", "balanced", "deep"] as const;
export type SearchTier = (typeof searchTiers)[number];

// --- Normalized output ---

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  content: z.string().optional(),
  score: z.number().optional(),
  publishedDate: z.string().optional(),
  source: z.enum(searchProviders),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchOutputSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema),
  answer: z.string().optional(),
});

export type SearchOutput = z.infer<typeof searchOutputSchema>;

// --- Tool input schema ---

export const searchInputSchema = z.object({
  query: z.string().describe("The search query to execute"),
  maxResults: z
    .number()
    .default(5)
    .describe("Maximum number of results to return"),
  topic: z
    .enum(["general", "news"])
    .default("general")
    .describe("Topic filter"),
});

export type SearchInput = z.infer<typeof searchInputSchema>;

// --- Configuration ---

export interface SearchConfig {
  /** Override auto-selection. Use a specific provider. */
  provider?: SearchProviderName;
  /** Maximum results to return. Default: 5. */
  maxResults?: number;
  /** Search depth. 'basic' is faster/cheaper, 'advanced' returns full content. Default: 'basic'. */
  searchDepth?: "basic" | "advanced";
  /**
   * Provider-native execution-mode passthrough / escape hatch. When set, it
   * overrides the `tier`-derived native value for adapters that read it (exa →
   * `type`, parallel → `mode`). Use it to reach provider-specific behaviors the
   * normalized `tier` does not cover (e.g. Exa `neural` / `instant` /
   * `deep-reasoning`). Adapters with no mode concept ignore it.
   */
  searchMode?: string;
  /**
   * Normalized retrieval-thoroughness tier. Maps per-provider; providers with
   * no depth knob (serper, brave) ignore it, and auto-selection prefers a
   * provider that meaningfully supports the requested tier. Default: 'balanced'.
   */
  tier?: SearchTier;
  /** Restrict results to these domains, where the provider supports it. */
  includeDomains?: string[];
  /** Exclude these domains from results, where the provider supports it. */
  excludeDomains?: string[];
  /** Topic filter. Default: 'general'. */
  topic?: "general" | "news";
  /** Explicit API keys. If omitted, auto-detect from env vars. */
  keys?: Partial<Record<SearchProviderName, string>>;
}

// --- Provider capability descriptor ---

/** Declares what a provider can meaningfully do, used to steer auto-selection. */
export interface SearchCapabilities {
  /**
   * Tiers this provider can meaningfully serve. Capability-aware auto-selection
   * prefers a provider whose set includes the requested tier. Every provider
   * supports `balanced`, so the default never changes selection.
   */
  tiers: SearchTier[];
}

// --- Provider adapter interface ---

export interface SearchProviderAdapter {
  name: SearchProviderName;
  /** Static capability descriptor consulted by `resolveProvider`. */
  capabilities: SearchCapabilities;
  search(
    query: string,
    options: {
      maxResults: number;
      searchDepth: "basic" | "advanced";
      topic: "general" | "news";
      /** Provider-native mode override from `SearchConfig.searchMode`. Undefined when unset. */
      searchMode?: string;
      /** Normalized retrieval tier. Undefined is treated as `balanced`. */
      tier?: SearchTier;
      /** Domain allow-list, where the provider supports it. */
      includeDomains?: string[];
      /** Domain deny-list, where the provider supports it. */
      excludeDomains?: string[];
      apiKey: string;
    }
  ): Promise<SearchOutput>;
}
