import { describe, expect, it, vi, beforeEach } from "vitest";
import { braveAdapter } from "../../src/search/providers/brave";

describe("braveAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name", () => {
    expect(braveAdapter.name).toBe("brave");
  });

  it("normalizes brave search response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Brave Result 1",
                url: "https://example.com/brave/1",
                description: "First brave result description",
              },
              {
                title: "Brave Result 2",
                url: "https://example.com/brave/2",
                description: "Second brave result description",
              },
            ],
          },
        }),
        { status: 200 }
      )
    );

    const result = await braveAdapter.search("brave query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.query).toBe("brave query");
    expect(result.results).toHaveLength(2);

    const first = result.results[0];
    expect(first.title).toBe("Brave Result 1");
    expect(first.url).toBe("https://example.com/brave/1");
    expect(first.snippet).toBe("First brave result description");
    expect(first.source).toBe("brave");

    // Verify fetch was called with correct URL and headers
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://api.search.brave.com/res/v1/web/search"),
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": "test-key",
        },
      }
    );
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" })
    );

    await expect(
      braveAdapter.search("query", {
        maxResults: 5,
        searchDepth: "basic",
        topic: "general",
        apiKey: "bad-key",
      })
    ).rejects.toThrow("Brave Search API error: 403 Forbidden");
  });

  it("returns empty results when no web data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const result = await braveAdapter.search("query", {
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
          web: {
            results: Array.from({ length: 10 }, (_, i) => ({
              title: `Result ${i}`,
              url: `https://example.com/${i}`,
              description: `Description ${i}`,
            })),
          },
        }),
        { status: 200 }
      )
    );

    const result = await braveAdapter.search("query", {
      maxResults: 3,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results).toHaveLength(3);
  });
});
