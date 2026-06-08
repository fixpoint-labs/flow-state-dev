import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { builtinFetchAdapter } from "../../../src/fetch/providers/builtin";

describe("builtin fetch adapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a page and converts to markdown", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          `<html><head><title>Test</title></head><body><p>Hello world content here</p></body></html>`
        ),
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    });

    const result = await builtinFetchAdapter.fetch("https://example.com", {
      waitForJS: false,
    });

    expect(result.url).toBe("https://example.com");
    expect(result.source).toBe("builtin");
    expect(result.markdown).toContain("Hello world");
    expect(result.metadata.statusCode).toBe(200);
    expect(result.metadata.contentType).toContain("text/html");
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it("throws on non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("page not found"),
    });

    await expect(
      builtinFetchAdapter.fetch("https://example.com/missing", {
        waitForJS: false,
      })
    ).rejects.toThrow("builtin fetch failed: 404 Not Found");
  });

  it("sends proper user-agent header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<html><body>test</body></html>"),
      headers: new Headers({ "content-type": "text/html" }),
    });

    await builtinFetchAdapter.fetch("https://example.com", {
      waitForJS: false,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("FlowStateDev"),
        }),
      })
    );
  });
});
