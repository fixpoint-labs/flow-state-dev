import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetch, firecrawlFetch, jinaFetch, builtinFetch } from "../../src/fetch";
import { tools } from "../../src";
import type { FetchResult } from "../../src/fetch/types";

import { runForTest } from "@flow-state-dev/testing";
// Mock the providers module to avoid real SDK imports
vi.mock("../../src/fetch/providers", () => {
  const mockFetchResult: FetchResult = {
    url: "https://example.com",
    title: "Mock Page",
    markdown: "# Mock\n\nContent",
    metadata: {
      statusCode: 200,
      contentType: "text/html",
      wordCount: 2,
    },
    source: "firecrawl",
  };

  const mockFirecrawlAdapter = {
    name: "firecrawl" as const,
    fetch: vi.fn(async () => mockFetchResult),
  };

  const mockJinaAdapter = {
    name: "jina" as const,
    fetch: vi.fn(async () => ({
      ...mockFetchResult,
      source: "jina" as const,
    })),
  };

  const mockBuiltinAdapter = {
    name: "builtin" as const,
    fetch: vi.fn(async () => ({
      ...mockFetchResult,
      source: "builtin" as const,
    })),
  };

  return {
    getAdapter: vi.fn((name: string) => {
      switch (name) {
        case "firecrawl":
          return mockFirecrawlAdapter;
        case "jina":
          return mockJinaAdapter;
        case "builtin":
          return mockBuiltinAdapter;
        default:
          return mockBuiltinAdapter;
      }
    }),
    firecrawlFetchAdapter: mockFirecrawlAdapter,
    jinaFetchAdapter: mockJinaAdapter,
    builtinFetchAdapter: mockBuiltinAdapter,
  };
});

describe("fetch tool factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.JINA_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a block definition with correct metadata", () => {
    const tool = fetch();

    expect(tool.name).toBe("fetch");
    expect(tool.kind).toBe("handler");
    expect(tool.description).toContain("Fetch a web page");
  });

  it("tools.fetch() returns the same block definition", () => {
    const tool = tools.fetch();

    expect(tool.name).toBe("fetch");
    expect(tool.kind).toBe("handler");
  });

  it("executes fetch with auto-detected provider (falls back to builtin)", async () => {
    const tool = fetch();
    const result = await runForTest(tool, { url: "https://example.com" }, {} as any);

    expect(result.url).toBe("https://example.com");
    expect(result.source).toBe("builtin");
  });

  it("executes fetch with firecrawl when key available", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";

    const tool = fetch();
    const result = await runForTest(tool, { url: "https://example.com" }, {} as any);

    expect(result.source).toBe("firecrawl");
  });

  it("executes fetch with config keys", async () => {
    const tool = fetch({ keys: { firecrawl: "config-key" } });
    const result = await runForTest(tool, { url: "https://example.com" }, {} as any);

    expect(result.source).toBe("firecrawl");
  });
});

describe("direct provider fetch factories", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.JINA_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("firecrawlFetch locks to firecrawl", () => {
    const tool = firecrawlFetch({ keys: { firecrawl: "key" } });
    expect(tool.name).toBe("fetch");
    expect(tool.kind).toBe("handler");
  });

  it("jinaFetch locks to jina", async () => {
    const tool = jinaFetch();
    const result = await runForTest(tool, { url: "https://example.com" }, {} as any);
    expect(result.source).toBe("jina");
  });

  it("builtinFetch locks to builtin", async () => {
    const tool = builtinFetch();
    const result = await runForTest(tool, { url: "https://example.com" }, {} as any);
    expect(result.source).toBe("builtin");
  });

  it("throws when firecrawl has no key", async () => {
    const tool = firecrawlFetch();
    await expect(
      runForTest(tool, { url: "https://example.com" }, {} as any)
    ).rejects.toThrow('Fetch provider "firecrawl" requested but no API key found');
  });
});
