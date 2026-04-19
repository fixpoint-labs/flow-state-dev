import { describe, expect, it, vi, beforeEach } from "vitest";
import { perplexityAdapter } from "../../src/search/providers/perplexity";

describe("perplexityAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name", () => {
    expect(perplexityAdapter.name).toBe("perplexity");
  });

  it("normalizes perplexity search response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Perplexity Result 1",
              url: "https://example.com/perplexity/1",
              snippet: "First perplexity result snippet",
              date: "2026-03-15",
            },
            {
              title: "Perplexity Result 2",
              url: "https://example.com/perplexity/2",
              snippet: "Second perplexity result snippet",
              last_updated: "2026-03-16",
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await perplexityAdapter.search("perplexity query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.query).toBe("perplexity query");
    expect(result.results).toHaveLength(2);

    const first = result.results[0];
    expect(first.title).toBe("Perplexity Result 1");
    expect(first.url).toBe("https://example.com/perplexity/1");
    expect(first.snippet).toBe("First perplexity result snippet");
    expect(first.publishedDate).toBe("2026-03-15");
    expect(first.source).toBe("perplexity");

    // Falls back to last_updated when date is absent
    expect(result.results[1].publishedDate).toBe("2026-03-16");

    // Verify fetch was called with correct endpoint and headers
    expect(fetch).toHaveBeenCalledWith("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "perplexity query", num_results: 5 }),
    });
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
    );

    await expect(
      perplexityAdapter.search("query", {
        maxResults: 5,
        searchDepth: "basic",
        topic: "general",
        apiKey: "bad-key",
      })
    ).rejects.toThrow("Perplexity Search API error: 401 Unauthorized");
  });

  it("returns empty results when no data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const result = await perplexityAdapter.search("query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results).toHaveLength(0);
  });

  it("respects maxResults limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `Result ${i}`,
            url: `https://example.com/${i}`,
            snippet: `Snippet ${i}`,
          })),
        }),
        { status: 200 }
      )
    );

    const result = await perplexityAdapter.search("query", {
      maxResults: 3,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results).toHaveLength(3);
  });
});
