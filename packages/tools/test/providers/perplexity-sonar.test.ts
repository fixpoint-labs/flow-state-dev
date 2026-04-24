import { describe, expect, it, vi, beforeEach } from "vitest";
import { perplexitySonarAdapter } from "../../src/search/providers/perplexity-sonar";

describe("perplexitySonarAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name", () => {
    expect(perplexitySonarAdapter.name).toBe("perplexity-sonar");
  });

  it("normalizes sonar grounded response with citations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "TypeScript is a typed superset of JavaScript developed by Microsoft.",
              },
            },
          ],
          citations: [
            "https://www.typescriptlang.org/",
            "https://en.wikipedia.org/wiki/TypeScript",
            "https://github.com/microsoft/TypeScript",
          ],
        }),
        { status: 200 }
      )
    );

    const result = await perplexitySonarAdapter.search("What is TypeScript?", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.query).toBe("What is TypeScript?");
    expect(result.answer).toBe(
      "TypeScript is a typed superset of JavaScript developed by Microsoft."
    );
    expect(result.results).toHaveLength(3);

    const first = result.results[0];
    expect(first.url).toBe("https://www.typescriptlang.org/");
    expect(first.source).toBe("perplexity-sonar");

    // Verify fetch was called with correct endpoint and body
    expect(fetch).toHaveBeenCalledWith(
      "https://api.perplexity.ai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: "What is TypeScript?" }],
        }),
      }
    );
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Rate limited", { status: 429, statusText: "Too Many Requests" })
    );

    await expect(
      perplexitySonarAdapter.search("query", {
        maxResults: 5,
        searchDepth: "basic",
        topic: "general",
        apiKey: "bad-key",
      })
    ).rejects.toThrow("Perplexity Sonar API error: 429 Too Many Requests");
  });

  it("returns empty results when no citations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "An answer without citations." } }],
        }),
        { status: 200 }
      )
    );

    const result = await perplexitySonarAdapter.search("query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results).toHaveLength(0);
    expect(result.answer).toBe("An answer without citations.");
  });

  it("returns undefined answer when response has no content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "" } }],
          citations: ["https://example.com"],
        }),
        { status: 200 }
      )
    );

    const result = await perplexitySonarAdapter.search("query", {
      maxResults: 5,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.answer).toBeUndefined();
    expect(result.results).toHaveLength(1);
  });

  it("respects maxResults limit on citations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Answer" } }],
          citations: Array.from(
            { length: 10 },
            (_, i) => `https://example.com/${i}`
          ),
        }),
        { status: 200 }
      )
    );

    const result = await perplexitySonarAdapter.search("query", {
      maxResults: 3,
      searchDepth: "basic",
      topic: "general",
      apiKey: "test-key",
    });

    expect(result.results).toHaveLength(3);
  });
});
