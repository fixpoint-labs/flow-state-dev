import { z } from "zod";

// --- Provider enum ---

export const searchProviders = ["tavily", "exa", "perplexity", "serper", "brave", "parallel", "perplexity-sonar"] as const;
export type SearchProviderName = (typeof searchProviders)[number];

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
   * Provider-agnostic execution-mode hint. Each provider interprets it on its
   * own terms; providers that have no mode concept ignore it. Currently only
   * the Parallel adapter reads it (mapping to its `mode` request field,
   * defaulting to "agentic").
   */
  searchMode?: string;
  /** Topic filter. Default: 'general'. */
  topic?: "general" | "news";
  /** Explicit API keys. If omitted, auto-detect from env vars. */
  keys?: Partial<Record<SearchProviderName, string>>;
}

// --- Provider adapter interface ---

export interface SearchProviderAdapter {
  name: SearchProviderName;
  search(
    query: string,
    options: {
      maxResults: number;
      searchDepth: "basic" | "advanced";
      topic: "general" | "news";
      /** Provider-agnostic mode hint from `SearchConfig.searchMode`. Undefined when unset. */
      searchMode?: string;
      apiKey: string;
    }
  ): Promise<SearchOutput>;
}
