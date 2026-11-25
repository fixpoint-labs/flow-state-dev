import { z } from "zod";
import { fetchResultSchema } from "../fetch/types";

// --- Provider enum ---

export const crawlProviders = ["firecrawl", "builtin"] as const;
export type CrawlProviderName = (typeof crawlProviders)[number];

// --- Normalized output ---

export const crawlResultSchema = z.object({
  rootUrl: z.string(),
  pages: z.array(fetchResultSchema),
  totalPages: z.number(),
  crawlDepth: z.number(),
  source: z.enum(crawlProviders),
});

export type CrawlResult = z.infer<typeof crawlResultSchema>;

// --- Tool input schema ---

export const crawlInputSchema = z.object({
  url: z.string().describe("The root URL of the site to crawl"),
  maxPages: z
    .number()
    .optional()
    .describe("Maximum number of pages to crawl. Capped by the app's limit."),
  maxDepth: z
    .number()
    .optional()
    .describe("Maximum link-following depth from root URL. Capped by the app's limit."),
});

export type CrawlInput = z.infer<typeof crawlInputSchema>;

// --- Configuration ---

export interface CrawlConfig {
  /** Override auto-selection. Use a specific provider. */
  provider?: CrawlProviderName;
  /** Most pages one crawl may visit; the model can ask for fewer. Default: 20. */
  maxPages?: number;
  /** Deepest link-following one crawl may go; the model can ask for less. Default: 2. */
  maxDepth?: number;
  /** URL glob patterns to include. Matched against path. */
  includePatterns?: string[];
  /** URL glob patterns to exclude. Matched against path. */
  excludePatterns?: string[];
  /** Enable JS rendering per page when available. Default: false. */
  waitForJS?: boolean;
  /**
   * Hostnames the crawl may read from, matched exactly (`example.com` does not
   * allow `www.example.com`). Checked on the root URL and on every redirect hop
   * of every page. Only the built-in provider can check redirect hops, so
   * setting this selects it, and naming Firecrawl with it throws. Unset: any
   * public host; an empty list allows none.
   */
  allowedHosts?: string[];
  /** Explicit API keys. */
  keys?: {
    firecrawl?: string;
  };
}

// --- Provider adapter interface ---

export interface CrawlProviderAdapter {
  name: CrawlProviderName;
  crawl(
    url: string,
    options: {
      maxPages: number;
      maxDepth: number;
      includePatterns: string[];
      excludePatterns: string[];
      waitForJS: boolean;
      apiKey?: string;
      /** The run's signal; aborting it ends the crawl. */
      signal?: AbortSignal;
      /** See {@link CrawlConfig.allowedHosts}. */
      allowedHosts?: string[];
    }
  ): Promise<CrawlResult>;
}
