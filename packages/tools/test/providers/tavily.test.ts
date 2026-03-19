import { describe, expect, it, vi } from "vitest";
import { tavilyAdapter } from "../../src/search/providers/tavily";

// Mock @tavily/core
vi.mock("@tavily/core", () => ({
  tavily: vi.fn(({ apiKey }: { apiKey: string }) => ({
    search: vi.fn(async (query: string, options: any) => ({
      query,
      results: [
        {
          title: "Test Result 1",
          url: "https://example.com/1",
          content: "This is the first result snippet",
          score: 0.95,
          publishedDate: "2026-03-15",
        },
        {
          title: "Test Result 2",
          url: "https://example.com/2",
          content: "This is the second result snippet",
          score: 0.8,
          publishedDate: null,
        },
      ],
      answer: "AI-generated summary of results",
    })),
  })),
}));

describe("tavilyAdapter", () => {
  it("has correct name", () => {
    expect(tavilyAdapter.name).toBe("tavily");
  });

  it("normalizes tavily response to SearchOutput", async () => {
    const result = await tavilyAdapter.search("test query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.query).toBe("test query");
    expect(result.results).toHaveLength(2);
    expect(result.answer).toBe("AI-generated summary of results");

    const first = result.results[0];
    expect(first.title).toBe("Test Result 1");
    expect(first.url).toBe("https://example.com/1");
    expect(first.snippet).toBe("This is the first result snippet");
    expect(first.score).toBe(0.95);
    expect(first.publishedDate).toBe("2026-03-15");
    expect(first.source).toBe("tavily");
  });

  it("handles null optional fields", async () => {
    const result = await tavilyAdapter.search("test", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    const second = result.results[1];
    expect(second.publishedDate).toBeUndefined();
  });
});
