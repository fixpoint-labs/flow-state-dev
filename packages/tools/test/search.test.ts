import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  search,
  tavilySearch,
  exaSearch,
  serperSearch,
  braveSearch,
  parallelSearch,
  perplexitySearch,
  perplexitySonarSearch,
} from "../src/search";
import { tools } from "../src";
import type { SearchOutput } from "../src/search/types";

import { runForTest } from "@flow-state-dev/testing";
// Mock the providers module to avoid real SDK imports
vi.mock("../src/search/providers", () => {
  const mockSearchOutput: SearchOutput = {
    query: "test query",
    results: [
      {
        title: "Mock Result",
        url: "https://example.com/mock",
        snippet: "Mock snippet",
        score: 0.9,
        source: "tavily",
      },
    ],
    answer: "Mock answer",
  };

  const mockAdapter = {
    name: "tavily" as const,
    search: vi.fn(async () => mockSearchOutput),
  };

  const mockExaAdapter = {
    name: "exa" as const,
    search: vi.fn(async () => ({
      ...mockSearchOutput,
      results: mockSearchOutput.results.map((r) => ({ ...r, source: "exa" as const })),
    })),
  };

  const mockSerperAdapter = {
    name: "serper" as const,
    search: vi.fn(async () => ({
      ...mockSearchOutput,
      results: mockSearchOutput.results.map((r) => ({ ...r, source: "serper" as const })),
    })),
  };

  const mockBraveAdapter = {
    name: "brave" as const,
    search: vi.fn(async () => ({
      ...mockSearchOutput,
      results: mockSearchOutput.results.map((r) => ({ ...r, source: "brave" as const })),
    })),
  };

  const mockPerplexityAdapter = {
    name: "perplexity" as const,
    search: vi.fn(async () => ({
      ...mockSearchOutput,
      results: mockSearchOutput.results.map((r) => ({ ...r, source: "perplexity" as const })),
    })),
  };

  const mockParallelAdapter = {
    name: "parallel" as const,
    search: vi.fn(async () => ({
      ...mockSearchOutput,
      results: mockSearchOutput.results.map((r) => ({ ...r, source: "parallel" as const })),
    })),
  };

  const mockPerplexitySonarAdapter = {
    name: "perplexity-sonar" as const,
    search: vi.fn(async () => ({
      ...mockSearchOutput,
      results: mockSearchOutput.results.map((r) => ({ ...r, source: "perplexity-sonar" as const })),
      answer: "Sonar grounded answer",
    })),
  };

  return {
    getAdapter: vi.fn((name: string) => {
      switch (name) {
        case "tavily": return mockAdapter;
        case "exa": return mockExaAdapter;
        case "serper": return mockSerperAdapter;
        case "brave": return mockBraveAdapter;
        case "parallel": return mockParallelAdapter;
        case "perplexity": return mockPerplexityAdapter;
        case "perplexity-sonar": return mockPerplexitySonarAdapter;
        default: return mockAdapter;
      }
    }),
    tavilyAdapter: mockAdapter,
    exaAdapter: mockExaAdapter,
    serperAdapter: mockSerperAdapter,
    braveAdapter: mockBraveAdapter,
    parallelAdapter: mockParallelAdapter,
    perplexityAdapter: mockPerplexityAdapter,
    perplexitySonarAdapter: mockPerplexitySonarAdapter,
  };
});

describe("search tool factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.EXA_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.PARALLEL_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a block definition with correct metadata", () => {
    const tool = search({ keys: { tavily: "test-key" } });

    expect(tool.name).toBe("search");
    expect(tool.kind).toBe("handler");
    expect(tool.description).toContain("Search the web");
  });

  it("tools.search() returns the same block definition", () => {
    const tool = tools.search({ keys: { tavily: "test-key" } });

    expect(tool.name).toBe("search");
    expect(tool.kind).toBe("handler");
  });

  it("executes search with auto-detected provider", async () => {
    process.env.TAVILY_API_KEY = "env-tavily-key";

    const tool = search();
    const result = await runForTest(tool, 
      { query: "test query", maxResults: 5, topic: "general" },
      {} as any
    );

    expect(result.query).toBe("test query");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("Mock Result");
  });

  it("executes search with config keys", async () => {
    const tool = search({ keys: { tavily: "config-key" } });
    const result = await runForTest(tool, 
      { query: "test", maxResults: 3, topic: "general" },
      {} as any
    );

    expect(result.results).toHaveLength(1);
  });

  it("throws when no provider available at execution time (lazy)", async () => {
    const tool = search();

    await expect(
      runForTest(tool, 
        { query: "test", maxResults: 5, topic: "general" },
        {} as any
      )
    ).rejects.toThrow("No search provider available");
  });
});

describe("direct provider search factories", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.EXA_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.PARALLEL_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("tavilySearch creates a tool locked to tavily", () => {
    const tool = tavilySearch({ keys: { tavily: "key" } });
    expect(tool.name).toBe("search");
    expect(tool.kind).toBe("handler");
  });

  it("exaSearch creates a tool locked to exa", async () => {
    const tool = exaSearch({ keys: { exa: "key" } });
    const result = await runForTest(tool, 
      { query: "test", maxResults: 5, topic: "general" },
      {} as any
    );
    expect(result.results[0].source).toBe("exa");
  });

  it("serperSearch creates a tool locked to serper", async () => {
    const tool = serperSearch({ keys: { serper: "key" } });
    const result = await runForTest(tool, 
      { query: "test", maxResults: 5, topic: "general" },
      {} as any
    );
    expect(result.results[0].source).toBe("serper");
  });

  it("braveSearch creates a tool locked to brave", async () => {
    const tool = braveSearch({ keys: { brave: "key" } });
    const result = await runForTest(tool, 
      { query: "test", maxResults: 5, topic: "general" },
      {} as any
    );
    expect(result.results[0].source).toBe("brave");
  });

  it("perplexitySearch creates a tool locked to perplexity", async () => {
    const tool = perplexitySearch({ keys: { perplexity: "key" } });
    const result = await runForTest(tool, 
      { query: "test", maxResults: 5, topic: "general" },
      {} as any
    );
    expect(result.results[0].source).toBe("perplexity");
  });

  it("perplexitySonarSearch creates a tool locked to perplexity-sonar", async () => {
    const tool = perplexitySonarSearch({ keys: { "perplexity-sonar": "key" } });
    const result = await runForTest(tool, 
      { query: "test", maxResults: 5, topic: "general" },
      {} as any
    );
    expect(result.results[0].source).toBe("perplexity-sonar");
  });

  it("parallelSearch creates a tool locked to parallel", async () => {
    const tool = parallelSearch({ keys: { parallel: "key" } });
    const result = await runForTest(tool,
      { query: "test", maxResults: 5, topic: "general" },
      {} as any
    );
    expect(result.results[0].source).toBe("parallel");
  });

  it("throws when locked provider has no key", async () => {
    const tool = tavilySearch();
    await expect(
      runForTest(tool, 
        { query: "test", maxResults: 5, topic: "general" },
        {} as any
      )
    ).rejects.toThrow('Search provider "tavily" requested but no API key found');
  });
});
