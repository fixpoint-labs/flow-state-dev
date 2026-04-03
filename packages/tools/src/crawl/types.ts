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
    .default(20)
    .describe("Maximum number of pages to crawl"),
  maxDepth: z
    .number()
    .default(2)
    .describe("Maximum link-following depth from root URL"),
});

export type CrawlInput = z.infer<typeof crawlInputSchema>;

// --- Configuration ---

export interface CrawlConfig {
  /** Override auto-selection. Use a specific provider. */
  provider?: CrawlProviderName;
  /** Maximum pages to crawl. Default: 20. */
  maxPages?: number;
  /** Maximum link-following depth. Default: 2. */
  maxDepth?: number;
  /** URL glob patterns to include. Matched against path. */
  includePatterns?: string[];
  /** URL glob patterns to exclude. Matched against path. */
  excludePatterns?: string[];
  /** Enable JS rendering per page when available. Default: false. */
  waitForJS?: boolean;
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
    }
  ): Promise<CrawlResult>;
}
