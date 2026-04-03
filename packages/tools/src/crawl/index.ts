import { handler } from "@flow-state-dev/core";
import {
  crawlInputSchema,
  crawlResultSchema,
  type CrawlConfig,
  type CrawlInput,
  type CrawlResult,
} from "./types";
import { resolveProvider } from "./resolver";

/**
 * Creates a crawl tool for use in generator blocks.
 * Auto-detects the best available crawl provider from env vars.
 * Always works — falls back to built-in BFS crawler.
 *
 * Provider priority: Firecrawl → Built-in BFS
 */
export function crawl(config: CrawlConfig = {}) {
  return handler({
    name: "crawl",
    description:
      "Crawl a website starting from a root URL, following links up to a specified depth. " +
      "Returns markdown content for each page found. Use this for site-wide content ingestion.",
    inputSchema: crawlInputSchema,
    outputSchema: crawlResultSchema,
    execute: async (input: CrawlInput): Promise<CrawlResult> => {
      const { adapter, apiKey } = resolveProvider(config);
      return adapter.crawl(input.url, {
        maxPages: input.maxPages ?? config.maxPages ?? 20,
        maxDepth: input.maxDepth ?? config.maxDepth ?? 2,
        includePatterns: config.includePatterns ?? [],
        excludePatterns: config.excludePatterns ?? [],
        waitForJS: config.waitForJS ?? false,
        apiKey,
      });
    },
  });
}

// Direct provider tools — locked to a specific provider
export function firecrawlCrawl(config: Omit<CrawlConfig, "provider"> = {}) {
  return crawl({ ...config, provider: "firecrawl" });
}

export function builtinCrawl(config: Omit<CrawlConfig, "provider"> = {}) {
  return crawl({ ...config, provider: "builtin" });
}

// Re-export types
export type {
  CrawlConfig,
  CrawlResult,
  CrawlProviderName,
  CrawlProviderAdapter,
  CrawlInput,
} from "./types";
export { crawlInputSchema, crawlResultSchema, crawlProviders } from "./types";
