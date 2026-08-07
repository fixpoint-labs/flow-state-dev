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

describe("builtin fetch adapter — network boundary", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects a private destination before opening a socket", async () => {
    globalThis.fetch = vi.fn();

    await expect(
      builtinFetchAdapter.fetch("http://169.254.169.254/latest/meta-data", {
        waitForJS: false,
      })
    ).rejects.toThrow("public IP addresses");

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("validates a redirect target instead of following it blindly", async () => {
    // The front door is public; the redirect is not. `redirect: "follow"` would
    // have made this hop invisible.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://127.0.0.1/secret" }),
      body: null,
    });

    await expect(
      builtinFetchAdapter.fetch("https://example.com/redirect", { waitForJS: false })
    ).rejects.toThrow("public IP addresses");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("stops after the redirect budget rather than looping", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://example.com/next" }),
      body: null,
    });

    await expect(
      builtinFetchAdapter.fetch("https://example.com/start", { waitForJS: false })
    ).rejects.toMatchObject({ code: "fetch_transport_error" });

    // Bounded: the initial request plus MAX_REDIRECTS hops, then it gives up.
    expect(globalThis.fetch).toHaveBeenCalledTimes(6);
  });

  it("follows a public redirect and reports the final URL", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 301,
        headers: new Headers({ location: "https://example.com/final" }),
        body: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            `<html><head><title>Final</title></head><body><p>Landed here after the hop</p></body></html>`
          ),
        headers: new Headers({ "content-type": "text/html" }),
      });

    const result = await builtinFetchAdapter.fetch("https://example.com/start", {
      waitForJS: false,
    });

    expect(result.url).toBe("https://example.com/final");
    expect(result.title).toBe("Final");
  });
});

describe("builtin fetch adapter — guard error shaping", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock("node:dns/promises");
  });

  it("keeps a transient DNS failure retryable", async () => {
    // The guard resolves the hostname before `fetch` gets a chance to, so a
    // resolver outage must still surface as the retryable network error callers
    // (and the generator's retry) already expect.
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo EAI_AGAIN example.com"), {
        code: "EAI_AGAIN",
      })
    );
    globalThis.fetch = vi.fn();

    await expect(
      builtinFetchAdapter.fetch("https://example.com/page", { waitForJS: false })
    ).rejects.toMatchObject({
      code: "fetch_transport_error",
      retryable: true,
      details: { errorType: "network" },
    });
  });

  it("keeps a policy refusal non-retryable", async () => {
    globalThis.fetch = vi.fn();

    await expect(
      builtinFetchAdapter.fetch("http://10.0.0.1/", { waitForJS: false })
    ).rejects.toMatchObject({ name: "BlockedUrlError" });
  });
});
