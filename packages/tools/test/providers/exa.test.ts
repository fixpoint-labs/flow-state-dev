import { describe, expect, it, vi, beforeEach } from "vitest";
import { exaAdapter } from "../../src/search/providers/exa";

// Hoisted shared spy so tests can assert the options passed to searchAndContents.
const { searchAndContentsMock } = vi.hoisted(() => ({
  searchAndContentsMock: vi.fn(),
}));

vi.mock("exa-js", () => {
  const MockExa = vi.fn().mockImplementation(() => ({
    searchAndContents: searchAndContentsMock,
  }));
  return { default: MockExa };
});

const FIXTURE = {
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
};

describe("exaAdapter", () => {
  beforeEach(() => {
    searchAndContentsMock.mockReset();
    searchAndContentsMock.mockResolvedValue(FIXTURE);
  });

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

  it("maps the tier to Exa's type (default balanced → auto)", async () => {
    await exaAdapter.search("q", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "k",
    });
    expect(searchAndContentsMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ type: "auto" })
    );

    await exaAdapter.search("q", {
      maxResults: 5,
      searchDepth: "basic",
      tier: "deep",
      topic: "general",
      apiKey: "k",
    });
    expect(searchAndContentsMock).toHaveBeenLastCalledWith(
      "q",
      expect.objectContaining({ type: "deep" })
    );
  });

  it("uses searchMode as the type override (e.g. Exa neural)", async () => {
    await exaAdapter.search("q", {
      maxResults: 5,
      searchDepth: "basic",
      tier: "fast",
      searchMode: "neural",
      topic: "general",
      apiKey: "k",
    });
    expect(searchAndContentsMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ type: "neural" })
    );
  });

  it("forwards domain filters when provided", async () => {
    await exaAdapter.search("q", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      includeDomains: ["arxiv.org"],
      excludeDomains: ["pinterest.com"],
      apiKey: "k",
    });
    expect(searchAndContentsMock).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({
        includeDomains: ["arxiv.org"],
        excludeDomains: ["pinterest.com"],
      })
    );
  });
});
