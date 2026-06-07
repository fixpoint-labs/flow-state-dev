import { describe, expect, it, vi, beforeEach } from "vitest";
import { serperAdapter } from "../../src/search/providers/serper";

describe("serperAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name", () => {
    expect(serperAdapter.name).toBe("serper");
  });

  it("normalizes serper web search response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          organic: [
            {
              title: "Serper Result 1",
              link: "https://example.com/serper/1",
              snippet: "First serper result snippet",
              date: "2026-03-12",
            },
            {
              title: "Serper Result 2",
              link: "https://example.com/serper/2",
              snippet: "Second serper result snippet",
            },
          ],
          answerBox: {
            answer: "Direct answer from serper",
          },
        }),
        { status: 200 }
      )
    );

    const result = await serperAdapter.search("serper query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.query).toBe("serper query");
    expect(result.results).toHaveLength(2);
    expect(result.answer).toBe("Direct answer from serper");

    const first = result.results[0];
    expect(first.title).toBe("Serper Result 1");
    expect(first.url).toBe("https://example.com/serper/1");
    expect(first.snippet).toBe("First serper result snippet");
    expect(first.publishedDate).toBe("2026-03-12");
    expect(first.source).toBe("serper");

    // Verify fetch was called with correct endpoint and headers
    expect(fetch).toHaveBeenCalledWith("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": "test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: "serper query", num: 5 }),
    });
  });

  it("uses news endpoint for news topic", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          news: [
            {
              title: "News Article",
              link: "https://news.example.com/1",
              description: "News description",
              date: "2026-03-18",
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await serperAdapter.search("news query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "news",
      apiKey: "test-key",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://google.serper.dev/news",
      expect.any(Object)
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].snippet).toBe("News description");
  });

  it("emulates domain filters with site: / -site: query operators", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ organic: [] }), { status: 200 })
    );

    const result = await serperAdapter.search("react hooks", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      includeDomains: ["react.dev"],
      excludeDomains: ["pinterest.com"],
      apiKey: "test-key",
    });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.q).toBe("react hooks site:react.dev -site:pinterest.com");
    // The normalized query stays the original, un-augmented string.
    expect(result.query).toBe("react hooks");
  });

  it("declares it does not support the deep tier", () => {
    expect(serperAdapter.capabilities.tiers).toEqual(["fast", "balanced"]);
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
    );

    await expect(
      serperAdapter.search("query", {
        maxResults: 5,
        searchDepth: "basic",
        topic: "general",
        apiKey: "bad-key",
      })
    ).rejects.toThrow("Serper API error: 401 Unauthorized");
  });

  it("returns empty results when no organic data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const result = await serperAdapter.search("query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results).toHaveLength(0);
  });
});
