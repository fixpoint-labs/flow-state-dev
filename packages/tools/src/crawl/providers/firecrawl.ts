import type { CrawlProviderAdapter, CrawlResult } from "../types";

export const firecrawlCrawlAdapter: CrawlProviderAdapter = {
  name: "firecrawl",
  async crawl(url, options): Promise<CrawlResult> {
    let FirecrawlApp: any;
    try {
      const mod = await import("@mendable/firecrawl-js");
      FirecrawlApp = mod.default;
    } catch {
      throw new Error(
        "Install @mendable/firecrawl-js to use the Firecrawl crawl provider: npm install @mendable/firecrawl-js"
      );
    }

    const app = new FirecrawlApp({ apiKey: options.apiKey });

    // SDK polls internally until crawl completes
    const result = await app.crawlUrl(url, {
      limit: options.maxPages,
      maxDepth: options.maxDepth,
      includePaths:
        options.includePatterns.length > 0
          ? options.includePatterns
          : undefined,
      excludePaths:
        options.excludePatterns.length > 0
          ? options.excludePatterns
          : undefined,
      scrapeOptions: {
        formats: ["markdown"],
        waitFor: options.waitForJS ? 5000 : undefined,
      },
    });

    const pages = (result.data ?? []).map((page: any) => ({
      url: page.metadata?.sourceURL ?? url,
      title: page.metadata?.title ?? "",
      markdown: page.markdown ?? "",
      metadata: {
        statusCode: page.metadata?.statusCode ?? 200,
        contentType: "text/html",
        description: page.metadata?.description,
        wordCount: (page.markdown ?? "").split(/\s+/).filter(Boolean).length,
      },
      source: "firecrawl" as const,
    }));

    return {
      rootUrl: url,
      pages,
      totalPages: pages.length,
      crawlDepth: options.maxDepth,
      source: "firecrawl" as const,
    };
  },
};
