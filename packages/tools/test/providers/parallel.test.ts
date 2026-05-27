import { describe, expect, it, vi, beforeEach } from "vitest";
import { parallelAdapter } from "../../src/search/providers/parallel";

describe("parallelAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name", () => {
    expect(parallelAdapter.name).toBe("parallel");
  });

  it("normalizes Parallel search response into SearchOutput", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Parallel Result 1",
              url: "https://example.com/parallel/1",
              publish_date: "2026-03-15",
              excerpts: ["First excerpt", "Second excerpt"],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await parallelAdapter.search("parallel query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.query).toBe("parallel query");
    expect(result.results).toHaveLength(1);

    const first = result.results[0];
    expect(first.title).toBe("Parallel Result 1");
    expect(first.url).toBe("https://example.com/parallel/1");
    expect(first.snippet).toBe("First excerpt");
    expect(first.content).toBe("First excerpt\n\nSecond excerpt");
    expect(first.publishedDate).toBe("2026-03-15");
    expect(first.source).toBe("parallel");

    // Verify the exact fetch call shape: endpoint, method, x-api-key auth,
    // and the agentic-mode request body.
    expect(fetch).toHaveBeenCalledWith("https://api.parallel.ai/v1/search", {
      method: "POST",
      headers: {
        "x-api-key": "test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objective: "parallel query",
        search_queries: ["parallel query"],
        mode: "agentic",
        advanced_settings: {
          max_results: 5,
          excerpt_settings: { max_chars_per_result: 1500 },
        },
      }),
    });
  });

  it("omits content when a result has a single excerpt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Single",
              url: "https://example.com/single",
              excerpts: ["Only excerpt"],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await parallelAdapter.search("query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results[0].snippet).toBe("Only excerpt");
    expect(result.results[0].content).toBeUndefined();
  });

  it("uses the searchMode hint when provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    );

    await parallelAdapter.search("query", {
      maxResults: 5,
      searchDepth: "advanced",
      searchMode: "one-shot",
      topic: "general",
      apiKey: "test-key",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.parallel.ai/v1/search",
      expect.objectContaining({
        body: JSON.stringify({
          objective: "query",
          search_queries: ["query"],
          mode: "one-shot",
          advanced_settings: {
            max_results: 5,
            excerpt_settings: { max_chars_per_result: 6000 },
          },
        }),
      })
    );
  });

  it("throws on non-200 response including the response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid key", { status: 401, statusText: "Unauthorized" })
    );

    await expect(
      parallelAdapter.search("query", {
        maxResults: 5,
        searchDepth: "basic",
        topic: "general",
        apiKey: "bad-key",
      })
    ).rejects.toThrow(
      "Parallel Search API error: 401 Unauthorized — invalid key"
    );
  });

  it("returns empty results when response has no results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const result = await parallelAdapter.search("query", {
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
            excerpts: [`Excerpt ${i}`],
          })),
        }),
        { status: 200 }
      )
    );

    const result = await parallelAdapter.search("query", {
      maxResults: 3,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results).toHaveLength(3);
  });
});
