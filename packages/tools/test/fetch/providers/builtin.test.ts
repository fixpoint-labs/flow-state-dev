import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { builtinFetchAdapter } from "../../../src/fetch/providers/builtin";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

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
        redirect: "manual",
      })
    );
  });

  it("rejects loopback URLs before making a request", async () => {
    globalThis.fetch = vi.fn();

    await expect(
      builtinFetchAdapter.fetch("http://127.0.0.1/admin", {
        waitForJS: false,
      })
    ).rejects.toThrow("Fetch URL must resolve to a public network address");

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects redirects to private network addresses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data" }),
    });

    await expect(
      builtinFetchAdapter.fetch("https://example.com/redirect", {
        waitForJS: false,
      })
    ).rejects.toThrow("Fetch URL must resolve to a public network address");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
