import { describe, expect, it, vi, beforeEach } from "vitest";
import { tavilyAdapter } from "../../src/search/providers/tavily";

// Hoisted shared spy so tests can assert the options passed to client.search.
const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ search: searchMock })),
}));

const FIXTURE = {
  query: "test query",
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
};

describe("tavilyAdapter", () => {
  beforeEach(() => {
    searchMock.mockReset();
    searchMock.mockResolvedValue(FIXTURE);
  });

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

  it("maps the deep tier to Tavily's advanced searchDepth", async () => {
    await tavilyAdapter.search("q", {
      maxResults: 5,
      searchDepth: "basic",
      tier: "deep",
      topic: "general",
      apiKey: "k",
    });
    expect(searchMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ searchDepth: "advanced" })
    );
  });

  it("keeps balanced/fast on Tavily basic searchDepth", async () => {
    await tavilyAdapter.search("q", {
      maxResults: 5,
      searchDepth: "basic",
      tier: "fast",
      topic: "general",
      apiKey: "k",
    });
    expect(searchMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ searchDepth: "basic" })
    );
  });

  it("still escalates to advanced for a legacy searchDepth: advanced", async () => {
    await tavilyAdapter.search("q", {
      maxResults: 5,
      searchDepth: "advanced",
      topic: "general",
      apiKey: "k",
    });
    expect(searchMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ searchDepth: "advanced" })
    );
  });

  it("forwards domain filters when provided", async () => {
    await tavilyAdapter.search("q", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      includeDomains: ["arxiv.org"],
      excludeDomains: ["pinterest.com"],
      apiKey: "k",
    });
    expect(searchMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({
        includeDomains: ["arxiv.org"],
        excludeDomains: ["pinterest.com"],
      })
    );
  });
});
