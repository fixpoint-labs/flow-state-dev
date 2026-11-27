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
    execute: async (input: CrawlInput, ctx): Promise<CrawlResult> => {
      const { adapter, apiKey } = resolveProvider(config);
      // The app's limits are ceilings: the model's value comes from tool input,
      // which a crawled page can steer, so it may only ask for less.
      const pageLimit = config.maxPages ?? 20;
      const depthLimit = config.maxDepth ?? 2;
      return adapter.crawl(input.url, {
        maxPages: Math.min(input.maxPages ?? pageLimit, pageLimit),
        maxDepth: Math.min(input.maxDepth ?? depthLimit, depthLimit),
        includePatterns: config.includePatterns ?? [],
        excludePatterns: config.excludePatterns ?? [],
        waitForJS: config.waitForJS ?? false,
        apiKey,
        signal: ctx.signal,
        allowedHosts: config.allowedHosts,
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
