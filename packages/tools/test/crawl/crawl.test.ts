import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { crawl, firecrawlCrawl, builtinCrawl } from "../../src/crawl";
import { builtinCrawlAdapter } from "../../src/crawl/providers";
import { tools } from "../../src";
import type { CrawlResult } from "../../src/crawl/types";

import { runForTest } from "@flow-state-dev/testing";
// Mock the providers module to avoid real SDK imports
vi.mock("../../src/crawl/providers", () => {
  const mockCrawlResult: CrawlResult = {
    rootUrl: "https://example.com",
    pages: [
      {
        url: "https://example.com",
        title: "Mock Page",
        markdown: "# Mock\n\nContent",
        metadata: {
          statusCode: 200,
          contentType: "text/html",
          wordCount: 2,
        },
        source: "firecrawl",
      },
    ],
    totalPages: 1,
    crawlDepth: 2,
    source: "firecrawl",
  };

  const mockFirecrawlAdapter = {
    name: "firecrawl" as const,
    crawl: vi.fn(async () => mockCrawlResult),
  };

  const mockBuiltinAdapter = {
    name: "builtin" as const,
    crawl: vi.fn(async () => ({
      ...mockCrawlResult,
      source: "builtin" as const,
      pages: mockCrawlResult.pages.map((p) => ({
        ...p,
        source: "builtin" as const,
      })),
    })),
  };

  return {
    getAdapter: vi.fn((name: string) => {
      switch (name) {
        case "firecrawl":
          return mockFirecrawlAdapter;
        case "builtin":
          return mockBuiltinAdapter;
        default:
          return mockBuiltinAdapter;
      }
    }),
    firecrawlCrawlAdapter: mockFirecrawlAdapter,
    builtinCrawlAdapter: mockBuiltinAdapter,
  };
});

describe("crawl tool factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a block definition with correct metadata", () => {
    const tool = crawl();

    expect(tool.name).toBe("crawl");
    expect(tool.kind).toBe("handler");
    expect(tool.description).toContain("Crawl a website");
  });

  it("tools.crawl() returns the same block definition", () => {
    const tool = tools.crawl();

    expect(tool.name).toBe("crawl");
    expect(tool.kind).toBe("handler");
  });

  it("executes crawl with auto-detected provider (falls back to builtin)", async () => {
    const tool = crawl();
    const result = await runForTest(tool, 
      { url: "https://example.com", maxPages: 20, maxDepth: 2 },
      {} as any
    );

    expect(result.rootUrl).toBe("https://example.com");
    expect(result.source).toBe("builtin");
  });

  it("executes crawl with firecrawl when key available", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";

    const tool = crawl();
    const result = await runForTest(tool, 
      { url: "https://example.com", maxPages: 20, maxDepth: 2 },
      {} as any
    );

    expect(result.source).toBe("firecrawl");
  });

  it.each([
    { config: {}, input: {}, maxPages: 20, maxDepth: 2 },
    { config: { maxPages: 100, maxDepth: 0 }, input: {}, maxPages: 100, maxDepth: 0 },
    { config: { maxPages: 100, maxDepth: 5 }, input: { maxPages: 10 }, maxPages: 10, maxDepth: 5 },
    { config: { maxPages: 100, maxDepth: 5 }, input: { maxDepth: 1 }, maxPages: 100, maxDepth: 1 },
  ])(
    "passes $maxPages pages and depth $maxDepth to the crawl adapter",
    async ({ config, input, maxPages, maxDepth }) => {
      const tool = builtinCrawl(config);
      const url = "https://example.com";
      await runForTest(tool, tool.inputSchema.parse({ url, ...input }), {} as any);
      expect(builtinCrawlAdapter.crawl).toHaveBeenLastCalledWith(
        url,
        expect.objectContaining({ maxPages, maxDepth }),
      );
    },
  );
});

describe("direct provider crawl factories", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("firecrawlCrawl locks to firecrawl", () => {
    const tool = firecrawlCrawl({ keys: { firecrawl: "key" } });
    expect(tool.name).toBe("crawl");
    expect(tool.kind).toBe("handler");
  });

  it("builtinCrawl locks to builtin", async () => {
    const tool = builtinCrawl();
    const result = await runForTest(tool, 
      { url: "https://example.com", maxPages: 20, maxDepth: 2 },
      {} as any
    );
    expect(result.source).toBe("builtin");
  });

  it("throws when firecrawl has no key", async () => {
    const tool = firecrawlCrawl();
    await expect(
      runForTest(tool, 
        { url: "https://example.com", maxPages: 20, maxDepth: 2 },
        {} as any
      )
    ).rejects.toThrow('Crawl provider "firecrawl" requested but no API key found');
  });
});
