import type { FetchProviderAdapter, FetchResult } from "../types";
import { providerFetchError } from "../errors";

export const firecrawlFetchAdapter: FetchProviderAdapter = {
  name: "firecrawl",
  async fetch(url, options): Promise<FetchResult> {
    let FirecrawlApp: any;
    try {
      const mod = await import("@mendable/firecrawl-js");
      FirecrawlApp = mod.default;
    } catch {
      throw new Error(
        "Install @mendable/firecrawl-js to use the Firecrawl fetch provider: npm install @mendable/firecrawl-js"
      );
    }

    const app = new FirecrawlApp({ apiKey: options.apiKey });
    const result = await app.scrapeUrl(url, {
      formats: ["markdown"],
      waitFor: options.waitForJS ? 5000 : undefined,
    });

    if (!result.success) {
      throw providerFetchError("firecrawl", url, result.error ?? "unknown error");
    }

    return {
      url,
      title: result.metadata?.title ?? "",
      markdown: result.markdown ?? "",
      metadata: {
        statusCode: result.metadata?.statusCode ?? 200,
        contentType: result.metadata?.contentType ?? "text/html",
        description: result.metadata?.description,
        wordCount: (result.markdown ?? "").split(/\s+/).filter(Boolean).length,
      },
      source: "firecrawl" as const,
    };
  },
};
