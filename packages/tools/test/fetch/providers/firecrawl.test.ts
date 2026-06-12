import { describe, expect, it, vi } from "vitest";
import { firecrawlFetchAdapter } from "../../../src/fetch/providers/firecrawl";

vi.mock("@mendable/firecrawl-js", () => {
  const mockScrapeUrl = vi.fn().mockResolvedValue({
    success: true,
    markdown: "# Test Page\n\nSome content here",
    metadata: {
      title: "Test Page",
      statusCode: 200,
      contentType: "text/html",
      description: "A test page",
    },
  });

  return {
    default: vi.fn().mockImplementation(() => ({
      scrapeUrl: mockScrapeUrl,
    })),
  };
});

describe("firecrawl fetch adapter", () => {
  it("returns normalized FetchResult", async () => {
    const result = await firecrawlFetchAdapter.fetch("https://example.com", {
      waitForJS: false,
      apiKey: "test-key",
    });

    expect(result.url).toBe("https://example.com");
    expect(result.source).toBe("firecrawl");
    expect(result.title).toBe("Test Page");
    expect(result.markdown).toContain("Some content here");
    expect(result.metadata.statusCode).toBe(200);
    expect(result.metadata.description).toBe("A test page");
  });

  it("throws on failed scrape", async () => {
    const { default: FirecrawlApp } = await import("@mendable/firecrawl-js");
    const mockInstance = new (FirecrawlApp as any)({});
    mockInstance.scrapeUrl.mockResolvedValueOnce({
      success: false,
      error: "Rate limit exceeded",
    });

    await expect(
      firecrawlFetchAdapter.fetch("https://example.com", {
        waitForJS: false,
        apiKey: "test-key",
      })
    ).rejects.toThrow("firecrawl fetch failed: Rate limit exceeded");
  });

  it("passes waitFor when waitForJS is true", async () => {
    const { default: FirecrawlApp } = await import("@mendable/firecrawl-js");
    const mockInstance = new (FirecrawlApp as any)({});

    await firecrawlFetchAdapter.fetch("https://example.com", {
      waitForJS: true,
      apiKey: "test-key",
    });

    expect(mockInstance.scrapeUrl).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        waitFor: 5000,
      })
    );
  });
});
