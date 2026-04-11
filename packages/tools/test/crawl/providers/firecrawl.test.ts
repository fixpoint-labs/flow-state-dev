import { describe, expect, it, vi } from "vitest";
import { firecrawlCrawlAdapter } from "../../../src/crawl/providers/firecrawl";

vi.mock("@mendable/firecrawl-js", () => {
  const mockCrawlUrl = vi.fn().mockResolvedValue({
    data: [
      {
        markdown: "# Page 1\n\nContent",
        metadata: {
          sourceURL: "https://example.com",
          title: "Page 1",
          statusCode: 200,
          description: "First page",
        },
      },
      {
        markdown: "# Page 2\n\nMore content",
        metadata: {
          sourceURL: "https://example.com/page2",
          title: "Page 2",
          statusCode: 200,
        },
      },
    ],
  });

  return {
    default: vi.fn().mockImplementation(() => ({
      crawlUrl: mockCrawlUrl,
    })),
  };
});

describe("firecrawl crawl adapter", () => {
  it("returns normalized CrawlResult", async () => {
    const result = await firecrawlCrawlAdapter.crawl("https://example.com", {
      maxPages: 10,
      maxDepth: 2,
      includePatterns: [],
      excludePatterns: [],
      waitForJS: false,
      apiKey: "test-key",
    });

    expect(result.rootUrl).toBe("https://example.com");
    expect(result.source).toBe("firecrawl");
    expect(result.pages).toHaveLength(2);
    expect(result.totalPages).toBe(2);
    expect(result.crawlDepth).toBe(2);
    expect(result.pages[0].title).toBe("Page 1");
    expect(result.pages[0].source).toBe("firecrawl");
    expect(result.pages[1].url).toBe("https://example.com/page2");
  });

  it("passes include/exclude patterns to SDK", async () => {
    const { default: FirecrawlApp } = await import("@mendable/firecrawl-js");
    const mockInstance = new (FirecrawlApp as any)({});

    await firecrawlCrawlAdapter.crawl("https://example.com", {
      maxPages: 50,
      maxDepth: 3,
      includePatterns: ["/docs/**"],
      excludePatterns: ["/admin/**"],
      waitForJS: true,
      apiKey: "test-key",
    });

    expect(mockInstance.crawlUrl).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        limit: 50,
        maxDepth: 3,
        includePaths: ["/docs/**"],
        excludePaths: ["/admin/**"],
        scrapeOptions: expect.objectContaining({
          waitFor: 5000,
        }),
      })
    );
  });
});
