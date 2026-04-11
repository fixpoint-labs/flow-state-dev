import { describe, expect, it, vi, afterEach } from "vitest";
import { builtinCrawlAdapter, extractLinks, matchesPatterns, globMatch } from "../../../src/crawl/providers/builtin";

describe("builtin crawl adapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockHtmlResponse(
    url: string,
    body: string,
    links: string[] = []
  ) {
    const linkTags = links
      .map((l) => `<a href="${l}">link</a>`)
      .join("\n");
    return {
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          `<html><head><title>${url}</title></head><body><p>${body}</p>${linkTags}</body></html>`
        ),
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    };
  }

  it("crawls root page", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockHtmlResponse("https://example.com", "Root page content")
    );

    const result = await builtinCrawlAdapter.crawl("https://example.com", {
      maxPages: 10,
      maxDepth: 0,
      includePatterns: [],
      excludePatterns: [],
      waitForJS: false,
    });

    expect(result.rootUrl).toBe("https://example.com");
    expect(result.source).toBe("builtin");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].markdown).toContain("Root page");
    expect(result.totalPages).toBe(1);
  });

  it("follows links up to maxDepth", async () => {
    const callMap: Record<string, any> = {
      "https://example.com": mockHtmlResponse(
        "https://example.com",
        "Root",
        ["https://example.com/page1"]
      ),
      "https://example.com/page1": mockHtmlResponse(
        "https://example.com/page1",
        "Page 1",
        ["https://example.com/page2"]
      ),
      "https://example.com/page2": mockHtmlResponse(
        "https://example.com/page2",
        "Page 2"
      ),
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      return Promise.resolve(callMap[url] ?? { ok: false, status: 404, statusText: "Not Found" });
    });

    const result = await builtinCrawlAdapter.crawl("https://example.com", {
      maxPages: 10,
      maxDepth: 1,
      includePatterns: [],
      excludePatterns: [],
      waitForJS: false,
    });

    // Depth 0 = root, depth 1 = page1, page2 is at depth 2 so excluded
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((p) => p.url)).toContain("https://example.com");
    expect(result.pages.map((p) => p.url)).toContain("https://example.com/page1");
  });

  it("respects maxPages limit", async () => {
    const callMap: Record<string, any> = {
      "https://example.com": mockHtmlResponse(
        "https://example.com",
        "Root",
        ["https://example.com/a", "https://example.com/b", "https://example.com/c"]
      ),
      "https://example.com/a": mockHtmlResponse("https://example.com/a", "A"),
      "https://example.com/b": mockHtmlResponse("https://example.com/b", "B"),
      "https://example.com/c": mockHtmlResponse("https://example.com/c", "C"),
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      return Promise.resolve(callMap[url] ?? { ok: false, status: 404, statusText: "Not Found" });
    });

    const result = await builtinCrawlAdapter.crawl("https://example.com", {
      maxPages: 2,
      maxDepth: 2,
      includePatterns: [],
      excludePatterns: [],
      waitForJS: false,
    });

    expect(result.pages).toHaveLength(2);
    expect(result.totalPages).toBe(2);
  });

  it("skips non-HTML responses", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "https://example.com") {
        return Promise.resolve(
          mockHtmlResponse("https://example.com", "Root", [
            "https://example.com/file.pdf",
          ])
        );
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("PDF content"),
        headers: new Headers({ "content-type": "application/pdf" }),
      });
    });

    const result = await builtinCrawlAdapter.crawl("https://example.com", {
      maxPages: 10,
      maxDepth: 1,
      includePatterns: [],
      excludePatterns: [],
      waitForJS: false,
    });

    expect(result.pages).toHaveLength(1);
  });

  it("handles fetch failures gracefully", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "https://example.com") {
        return Promise.resolve(
          mockHtmlResponse("https://example.com", "Root", [
            "https://example.com/fail",
          ])
        );
      }
      return Promise.reject(new Error("Network error"));
    });

    const result = await builtinCrawlAdapter.crawl("https://example.com", {
      maxPages: 10,
      maxDepth: 1,
      includePatterns: [],
      excludePatterns: [],
      waitForJS: false,
    });

    // Should have root page, skip failed page
    expect(result.pages).toHaveLength(1);
  });
});

describe("extractLinks", () => {
  it("extracts same-origin links", () => {
    const html = `
      <a href="/page1">Page 1</a>
      <a href="https://example.com/page2">Page 2</a>
      <a href="https://other.com/page3">External</a>
    `;

    const links = extractLinks(html, "https://example.com", "https://example.com");

    expect(links).toContain("https://example.com/page1");
    expect(links).toContain("https://example.com/page2");
    expect(links).not.toContain("https://other.com/page3");
  });

  it("strips hash fragments", () => {
    const html = `<a href="/page#section">Link</a>`;

    const links = extractLinks(html, "https://example.com", "https://example.com");

    expect(links[0]).toBe("https://example.com/page");
  });

  it("resolves relative URLs", () => {
    const html = `<a href="../other">Link</a>`;

    const links = extractLinks(
      html,
      "https://example.com/docs/page",
      "https://example.com"
    );

    expect(links[0]).toBe("https://example.com/other");
  });
});

describe("matchesPatterns", () => {
  it("includes all when no patterns specified", () => {
    expect(matchesPatterns("https://example.com/any", [], [])).toBe(true);
  });

  it("excludes matching exclude patterns", () => {
    expect(
      matchesPatterns("https://example.com/admin/page", [], ["/admin/**"])
    ).toBe(false);
  });

  it("requires match against include patterns", () => {
    expect(
      matchesPatterns("https://example.com/docs/page", ["/docs/**"], [])
    ).toBe(true);
    expect(
      matchesPatterns("https://example.com/blog/post", ["/docs/**"], [])
    ).toBe(false);
  });

  it("exclude takes precedence over include", () => {
    expect(
      matchesPatterns(
        "https://example.com/docs/admin",
        ["/docs/**"],
        ["/docs/admin"]
      )
    ).toBe(false);
  });
});

describe("globMatch", () => {
  it("matches ** as any path", () => {
    expect(globMatch("/docs/api/ref", "/docs/**")).toBe(true);
    expect(globMatch("/blog/post", "/docs/**")).toBe(false);
  });

  it("matches * as single segment", () => {
    expect(globMatch("/docs/page1", "/docs/*")).toBe(true);
    expect(globMatch("/docs/sub/page", "/docs/*")).toBe(false);
  });

  it("matches exact path", () => {
    expect(globMatch("/about", "/about")).toBe(true);
    expect(globMatch("/about-us", "/about")).toBe(false);
  });
});
