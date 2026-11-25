import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { lookup } from "node:dns/promises";
import { builtinFetchAdapter } from "../../../src/fetch/providers/builtin";

describe("builtin fetch adapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a page and converts to markdown", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        `<html><head><title>Test</title></head><body><p>Hello world content here</p></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      )
    );

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
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("page not found", { status: 404, statusText: "Not Found" })
    );

    await expect(
      builtinFetchAdapter.fetch("https://example.com/missing", {
        waitForJS: false,
      })
    ).rejects.toThrow("builtin fetch failed: 404 Not Found");
  });

  it("sends proper user-agent header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html><body>test</body></html>", {
        headers: { "content-type": "text/html" },
      })
    );

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
    ).rejects.toMatchObject({ code: "fetch_blocked_url", retryable: false });

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
    ).rejects.toMatchObject({ code: "fetch_blocked_url" });

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
      .mockResolvedValueOnce(
        new Response(
          `<html><head><title>Final</title></head><body><p>Landed here after the hop</p></body></html>`,
          { headers: { "content-type": "text/html" } }
        )
      );

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
    // The hostname is resolved by the socket's lookup inside the real fetch, so
    // a resolver outage must still surface as the retryable network error
    // callers (and the generator's retry) already expect.
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo EAI_AGAIN example.com"), {
        code: "EAI_AGAIN",
      })
    );

    await expect(
      builtinFetchAdapter.fetch("https://example.com/page", { waitForJS: false })
    ).rejects.toMatchObject({
      code: "fetch_transport_error",
      retryable: true,
      details: { errorType: "network" },
    });
  });

  it("refuses a hostname that resolves to a private address at connect time", async () => {
    // DNS rebinding: whatever the name answered to an earlier check, the
    // address the socket would connect to is the one that is judged. The real
    // fetch runs here, so this goes through the dispatcher's lookup.
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ] as never);

    await expect(
      builtinFetchAdapter.fetch("https://rebind.example/latest/meta-data", {
        waitForJS: false,
      })
    ).rejects.toMatchObject({
      code: "fetch_blocked_url",
      retryable: false,
      details: { errorType: "blocked" },
    });
  });

  it("keeps a policy refusal non-retryable", async () => {
    globalThis.fetch = vi.fn();

    await expect(
      builtinFetchAdapter.fetch("http://10.0.0.1/", { waitForJS: false })
    ).rejects.toMatchObject({
      code: "fetch_blocked_url",
      retryable: false,
      details: { errorType: "blocked" },
    });
  });
});

describe("builtin fetch adapter — bounds", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses a body past the byte cap with its own error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("x".repeat(5 * 1024 * 1024 + 1), {
        headers: { "content-type": "text/html" },
      })
    );

    await expect(
      builtinFetchAdapter.fetch("https://example.com/huge", { waitForJS: false })
    ).rejects.toMatchObject({
      code: "fetch_response_too_large",
      retryable: false,
      details: { errorType: "too_large", url: "https://example.com/huge" },
    });
  });

  it("keeps the HTTP error and its retry when the error page is past the cap", async () => {
    // The status decides retryability; an unreadable body only loses the excerpt.
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("x".repeat(5 * 1024 * 1024 + 1), {
        status: 503,
        statusText: "Service Unavailable",
      })
    );

    await expect(
      builtinFetchAdapter.fetch("https://example.com/down", { waitForJS: false })
    ).rejects.toMatchObject({
      code: "fetch_http_error",
      retryable: true,
      details: { errorType: "http", httpStatus: 503 },
    });
  });

  it("aborts with the run's signal", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        })
    ) as typeof globalThis.fetch;
    const run = new AbortController();

    const pending = builtinFetchAdapter.fetch("https://example.com/", {
      waitForJS: false,
      signal: run.signal,
    });
    run.abort();

    await expect(pending).rejects.toMatchObject({
      code: "fetch_transport_error",
      retryable: false,
      details: { errorType: "abort" },
    });
  });
});

describe("builtin fetch adapter — allowed hosts", () => {
  const originalFetch = globalThis.fetch;
  const page = () =>
    new Response("<html><head><title>T</title></head><body><p>Allowed page</p></body></html>", {
      headers: { "content-type": "text/html" },
    });
  const redirectTo = (location: string) =>
    new Response(null, { status: 302, headers: { location } });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses a starting URL outside the list before opening a socket", async () => {
    globalThis.fetch = vi.fn();

    const err = await builtinFetchAdapter
      .fetch("https://other.example/page", { waitForJS: false, allowedHosts: ["docs.example"] })
      .catch((e) => e);

    expect(err).toMatchObject({ code: "fetch_blocked_url", retryable: false });
    expect(err.message).toContain('Host "other.example"');
    expect(err.message).toContain("the starting URL");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses a redirect off the list and names the hop", async () => {
    // The starting URL passes an allowlist; the redirect is where an allowed
    // site sends the fetch anywhere else.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("https://docs.example/moved"))
      .mockResolvedValueOnce(redirectTo("https://attacker.example/collect"));

    const err = await builtinFetchAdapter
      .fetch("https://docs.example/start", { waitForJS: false, allowedHosts: ["docs.example"] })
      .catch((e) => e);

    expect(err).toMatchObject({ code: "fetch_blocked_url", details: { errorType: "blocked" } });
    expect(err.message).toContain('Host "attacker.example"');
    expect(err.message).toContain("redirect hop 2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("follows redirects between listed hosts, matching case and trailing dot", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("https://WWW.Docs.Example./final"))
      .mockResolvedValueOnce(page());

    const result = await builtinFetchAdapter.fetch("https://docs.example/start", {
      waitForJS: false,
      allowedHosts: ["docs.example", "www.docs.example"],
    });

    expect(result.markdown).toContain("Allowed page");
  });

  it("matches a listed Unicode host to the punycode form a URL carries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(page());

    const result = await builtinFetchAdapter.fetch("https://bücher.de/", {
      waitForJS: false,
      allowedHosts: ["Bücher.de"],
    });

    expect(result.markdown).toContain("Allowed page");
  });

  it("allows no host when the list is empty", async () => {
    globalThis.fetch = vi.fn();

    await expect(
      builtinFetchAdapter.fetch("https://docs.example/", { waitForJS: false, allowedHosts: [] })
    ).rejects.toMatchObject({ code: "fetch_blocked_url" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("matches hosts exactly, so a subdomain is not allowed by its parent", async () => {
    globalThis.fetch = vi.fn();

    await expect(
      builtinFetchAdapter.fetch("https://www.docs.example/", {
        waitForJS: false,
        allowedHosts: ["docs.example"],
      })
    ).rejects.toMatchObject({ code: "fetch_blocked_url" });
  });

  it("follows a redirect to any public host when no list is set", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("https://anywhere.example/"))
      .mockResolvedValueOnce(page());

    const result = await builtinFetchAdapter.fetch("https://docs.example/", { waitForJS: false });

    expect(result.url).toBe("https://anywhere.example/");
  });
});
