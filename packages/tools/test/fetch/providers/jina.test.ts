import { describe, expect, it, vi, afterEach } from "vitest";
import { jinaFetchAdapter } from "../../../src/fetch/providers/jina";

describe("jina fetch adapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches via r.jina.ai and returns normalized result", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            title: "Example Page",
            content: "# Example\n\nSome markdown content",
            description: "An example page",
          },
        }),
    });

    const result = await jinaFetchAdapter.fetch("https://example.com", {
      waitForJS: false,
      apiKey: "jina-key",
    });

    expect(result.url).toBe("https://example.com");
    expect(result.source).toBe("jina");
    expect(result.title).toBe("Example Page");
    expect(result.markdown).toContain("Some markdown content");
    expect(result.metadata.description).toBe("An example page");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://r.jina.ai/https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jina-key",
        }),
      })
    );
  });

  it("works without API key", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: { title: "Test", content: "content" },
        }),
    });

    const result = await jinaFetchAdapter.fetch("https://example.com", {
      waitForJS: false,
    });

    expect(result.source).toBe("jina");
    const calledHeaders = (globalThis.fetch as any).mock.calls[0][1].headers;
    expect(calledHeaders).not.toHaveProperty("Authorization");
  });

  it("throws on non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    await expect(
      jinaFetchAdapter.fetch("https://example.com", {
        waitForJS: false,
        apiKey: "key",
      })
    ).rejects.toThrow("Jina Reader error: 429 Too Many Requests");
  });
});
