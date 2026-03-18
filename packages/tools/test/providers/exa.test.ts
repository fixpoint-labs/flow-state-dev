import { describe, expect, it, vi } from "vitest";
import { exaAdapter } from "../../src/search/providers/exa";

// Mock exa-js
vi.mock("exa-js", () => {
  const MockExa = vi.fn().mockImplementation(() => ({
    searchAndContents: vi.fn(async (query: string, options: any) => ({
      results: [
        {
          title: "Exa Result 1",
          url: "https://example.com/exa/1",
          text: "Full text content of the first result from Exa search",
          highlights: ["highlighted snippet from result"],
          score: 0.92,
          publishedDate: "2026-03-10",
        },
        {
          title: null,
          url: "https://example.com/exa/2",
          text: "Second result text content",
          highlights: [],
          score: null,
          publishedDate: null,
        },
      ],
    })),
  }));
  return { default: MockExa };
});

describe("exaAdapter", () => {
  it("has correct name", () => {
    expect(exaAdapter.name).toBe("exa");
  });

  it("normalizes exa response in basic mode", async () => {
    const result = await exaAdapter.search("exa query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.query).toBe("exa query");
    expect(result.results).toHaveLength(2);

    const first = result.results[0];
    expect(first.title).toBe("Exa Result 1");
    expect(first.url).toBe("https://example.com/exa/1");
    expect(first.snippet).toBe("highlighted snippet from result");
    expect(first.content).toBeUndefined(); // basic mode
    expect(first.score).toBe(0.92);
    expect(first.source).toBe("exa");
  });

  it("includes content in advanced mode", async () => {
    const result = await exaAdapter.search("exa query", {
      maxResults: 5,
      searchDepth: "advanced",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results[0].content).toBe(
      "Full text content of the first result from Exa search"
    );
  });

  it("falls back to text slice when no highlights", async () => {
    const result = await exaAdapter.search("exa query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    const second = result.results[1];
    expect(second.title).toBe("");
    expect(second.snippet).toBe("Second result text content");
  });
});
