import { describe, it, expect, vi } from "vitest";
import { resourceSearchTools } from "../src/tools/resource-search-tools";
import type { BlockContext } from "../src/types/block";
import { createMockContext, runForTest } from "./helpers";

type MockResource = {
  path: string;
  content?: string | null;
  rendered?: string | null;
  llmReadable?: boolean;
};
type MockCollection = { pattern: string; llmReadable?: boolean; instances: MockResource[] };

function refOf(r: MockResource): any {
  const raw = r.content === undefined ? null : r.content;
  // `rendered` defaults to the raw body, so a plain (non-templated) resource
  // reads identically through readContent and readContentRaw.
  const rendered = r.rendered === undefined ? raw : r.rendered;
  return {
    path: r.path,
    scope: "org",
    uri: `org/${r.path}`,
    state: {},
    config: { llmReadable: r.llmReadable ?? true },
    readContentRaw: async () => raw,
    readContent: async () => rendered,
  };
}

function makeCtx(statics: MockResource[] = [], collections: MockCollection[] = []): BlockContext {
  const entries: any[] = [];
  for (const r of statics) entries.push(refOf(r));
  for (const c of collections) {
    entries.push({
      pattern: c.pattern,
      scope: "org",
      // Collection-level llmReadable lives on the collection ref's config; grep
      // and search gate on it before listing (default readable for the common
      // case so each test names its own non-readable collections explicitly).
      config: { llmReadable: c.llmReadable ?? true },
      create: async () => {},
      list: async () => c.instances.map(refOf),
    });
  }
  return createMockContext({
    resources: {
      list: () => entries,
      get: ((name: string) => entries.find((e: any) => e.path === name)) as any,
    } as any,
  });
}

const { globResources, grepResourceContent, searchResources } = resourceSearchTools();

// Glob patterns and grep/search prefixes match the within-scope `path`; results
// are emitted as scope-qualified uris (`org/<path>` for the mock scope).
describe("globResources", () => {
  it("matches collection instance paths against a deep-wildcard glob", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [
          { path: "concepts/react" },
          { path: "concepts/react/hooks" },
          { path: "notes/standup" },
        ],
      },
    ]);
    const { uris } = await runForTest(globResources,{ pattern: "concepts/**", limit: 100 }, ctx);
    expect(uris).toEqual(["org/concepts/react", "org/concepts/react/hooks"]);
  });

  it("matches single-level and within-segment substring patterns (what prefix-listing can't)", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [
          { path: "concepts/react" },
          { path: "concepts/react/hooks" },
          { path: "concepts/react-hooks" },
        ],
      },
    ]);
    const single = await runForTest(globResources,{ pattern: "concepts/*", limit: 100 }, ctx);
    expect(single.uris).toEqual(["org/concepts/react", "org/concepts/react-hooks"]);

    const substring = await runForTest(globResources,{ pattern: "concepts/*hooks*", limit: 100 }, ctx);
    expect(substring.uris).toEqual(["org/concepts/react-hooks"]);
  });

  it("lists all uris (static + collection) sorted when pattern is null", async () => {
    const ctx = makeCtx([{ path: "soul" }], [
      { pattern: "concepts/**", instances: [{ path: "concepts/b" }, { path: "concepts/a" }] },
    ]);
    const { uris } = await runForTest(globResources,{ pattern: null, limit: 100 }, ctx);
    expect(uris).toEqual(["org/concepts/a", "org/concepts/b", "org/soul"]);
  });

  it("does not gate on llmReadable (discovery, like listResources)", async () => {
    const ctx = makeCtx([], [
      { pattern: "concepts/**", instances: [{ path: "concepts/secret", llmReadable: false }] },
    ]);
    const { uris } = await runForTest(globResources,{ pattern: "concepts/**", limit: 100 }, ctx);
    expect(uris).toEqual(["org/concepts/secret"]);
  });

  it("bounds results by limit", async () => {
    const ctx = makeCtx([], [
      { pattern: "c/**", instances: [{ path: "c/1" }, { path: "c/2" }, { path: "c/3" }] },
    ]);
    const { uris } = await runForTest(globResources,{ pattern: "c/**", limit: 2 }, ctx);
    expect(uris).toEqual(["org/c/1", "org/c/2"]);
  });

  it("returns empty when the registry is empty", async () => {
    const { uris } = await runForTest(globResources,{ pattern: null, limit: 100 }, makeCtx());
    expect(uris).toEqual([]);
  });
});

describe("grepResourceContent", () => {
  it("returns matching lines with 1-based line numbers and the resource uri", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [{ path: "concepts/react", content: "line one\nuseEffect hook\nline three" }],
      },
    ]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "useEffect", prefix: null, maxResults: 50 },
      ctx,
    );
    expect(matches).toEqual([{ uri: "org/concepts/react", line: 2, snippet: "useEffect hook" }]);
  });

  it("excludes instances of collections that are not llmReadable", async () => {
    const ctx = makeCtx([], [
      { pattern: "public/**", llmReadable: true, instances: [{ path: "public/a", content: "needle here" }] },
      { pattern: "private/**", llmReadable: false, instances: [{ path: "private/a", content: "needle here" }] },
    ]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "needle", prefix: null, maxResults: 50 },
      ctx,
    );
    expect(matches.map((m) => m.uri)).toEqual(["org/public/a"]);
  });

  it("does not call list() on a collection that did not opt into llmReadable", async () => {
    let listed = false;
    const ctx = createMockContext({
      resources: {
        list: () => [
          {
            pattern: "private/**",
            scope: "org",
            config: { llmReadable: false },
            create: async () => {},
            list: async () => {
              listed = true;
              return [];
            },
          },
        ],
        get: (() => undefined) as any,
      } as any,
    });
    await runForTest(grepResourceContent, { pattern: "x", prefix: null, maxResults: 50 }, ctx);
    expect(listed).toBe(false);
  });

  it("scopes by prefix", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [
          { path: "concepts/a", content: "needle" },
          { path: "notes/b", content: "needle" },
        ],
      },
    ]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "needle", prefix: "concepts/", maxResults: 50 },
      ctx,
    );
    expect(matches.map((m) => m.uri)).toEqual(["org/concepts/a"]);
  });

  it("treats prefix as a path boundary, not a string prefix (no sibling leak)", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "**",
        instances: [
          { path: "concept/a", content: "needle" },
          { path: "concepts/react", content: "needle" },
        ],
      },
    ]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "needle", prefix: "concept", maxResults: 50 },
      ctx,
    );
    expect(matches.map((m) => m.uri)).toEqual(["org/concept/a"]);
  });

  it("searches rendered content, not the raw template source", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "personas/**",
        instances: [{ path: "personas/analyst", content: "Hello {{ state.name }}", rendered: "Hello Alice" }],
      },
    ]);
    const hit = await runForTest(grepResourceContent,
      { pattern: "Alice", prefix: null, maxResults: 50 },
      ctx,
    );
    expect(hit.matches.map((m) => m.uri)).toEqual(["org/personas/analyst"]);

    // The template token only exists in the raw body, never in rendered output.
    const miss = await runForTest(grepResourceContent,
      { pattern: "state\\.name", prefix: null, maxResults: 50 },
      ctx,
    );
    expect(miss.matches).toEqual([]);
  });

  it("lists collections without a relative prefix and scopes on full paths", async () => {
    // The real ResourceCollectionRef.list(prefix) treats prefix as collection-RELATIVE
    // (it prepends the pattern prefix), so handing it a full path like "concepts/react/"
    // would resolve to the wrong key space and return nothing. These tools list with no
    // argument and scope via matchesPrefix on the returned full paths instead.
    const seen: Array<string | undefined> = [];
    const ctx = createMockContext({
      resources: {
        list: () => [
          {
            pattern: "concepts/**",
            scope: "org",
            config: { llmReadable: true },
            create: async () => {},
            list: async (prefix?: string) => {
              seen.push(prefix);
              // Mimic the store: a (relative) prefix prepends the pattern prefix.
              const all = [
                refOf({ path: "concepts/react/hooks", content: "needle" }),
                refOf({ path: "concepts/vue", content: "needle" }),
              ];
              if (prefix === undefined) return all;
              const full = `concepts/${prefix}`;
              return all.filter((r) => r.path.startsWith(full));
            },
          },
        ],
        get: (() => undefined) as any,
      } as any,
    });
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "needle", prefix: "concepts/react/", maxResults: 50 },
      ctx,
    );
    expect(seen).toEqual([undefined]);
    expect(matches.map((m) => m.uri)).toEqual(["org/concepts/react/hooks"]);
  });

  it("bounds results by maxResults", async () => {
    const ctx = makeCtx([], [
      { pattern: "c/**", instances: [{ path: "c/a", content: "x\nx\nx\nx" }] },
    ]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "x", prefix: null, maxResults: 2 },
      ctx,
    );
    expect(matches).toHaveLength(2);
  });

  it("falls back to literal matching when the pattern is not valid regex", async () => {
    const ctx = makeCtx([], [
      { pattern: "c/**", instances: [{ path: "c/a", content: "value is a( here" }] },
    ]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "a(", prefix: null, maxResults: 50 },
      ctx,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.snippet).toBe("value is a( here");
  });

  it("returns empty when nothing matches", async () => {
    const ctx = makeCtx([], [{ pattern: "c/**", instances: [{ path: "c/a", content: "nothing" }] }]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "absent", prefix: null, maxResults: 50 },
      ctx,
    );
    expect(matches).toEqual([]);
  });
});

describe("searchResources", () => {
  it("ranks resources by term frequency, highest first", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [
          { path: "concepts/low", content: "hooks" },
          { path: "concepts/high", content: "hooks hooks hooks" },
          { path: "concepts/mid", content: "hooks hooks" },
        ],
      },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "hooks", prefix: null, limit: 10 },
      ctx,
    );
    expect(results.map((r) => r.uri)).toEqual(["org/concepts/high", "org/concepts/mid", "org/concepts/low"]);
    expect(results[0]!.score).toBe(3);
  });

  it("excludes zero-score results and instances of non-llmReadable collections", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        llmReadable: true,
        instances: [
          { path: "concepts/match", content: "useState and hooks" },
          { path: "concepts/nomatch", content: "totally unrelated" },
        ],
      },
      { pattern: "hidden/**", llmReadable: false, instances: [{ path: "hidden/a", content: "hooks hooks" }] },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "hooks", prefix: null, limit: 10 },
      ctx,
    );
    expect(results.map((r) => r.uri)).toEqual(["org/concepts/match"]);
  });

  it("returns a snippet from the first matching line", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [{ path: "concepts/a", content: "intro line\nthe hooks api\noutro" }],
      },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "hooks", prefix: null, limit: 10 },
      ctx,
    );
    expect(results[0]!.snippet).toBe("the hooks api");
  });

  it("returns empty for a query with no usable terms", async () => {
    const ctx = makeCtx([], [{ pattern: "c/**", instances: [{ path: "c/a", content: "anything" }] }]);
    const { results } = await runForTest(searchResources,
      { query: "   ", prefix: null, limit: 10 },
      ctx,
    );
    expect(results).toEqual([]);
  });

  it("scopes by prefix", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [
          { path: "concepts/a", content: "hooks" },
          { path: "notes/b", content: "hooks" },
        ],
      },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "hooks", prefix: "concepts/", limit: 10 },
      ctx,
    );
    expect(results.map((r) => r.uri)).toEqual(["org/concepts/a"]);
  });

  it("treats prefix as a path boundary, not a string prefix (no sibling leak)", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "**",
        instances: [
          { path: "concept/a", content: "hooks" },
          { path: "concepts/react", content: "hooks" },
        ],
      },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "hooks", prefix: "concept", limit: 10 },
      ctx,
    );
    expect(results.map((r) => r.uri)).toEqual(["org/concept/a"]);
  });

  it("ranks on rendered content, not the raw template source", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "personas/**",
        instances: [
          { path: "personas/analyst", content: "You are {{ state.role }}", rendered: "You are Alice, an analyst" },
        ],
      },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "analyst", prefix: null, limit: 10 },
      ctx,
    );
    expect(results.map((r) => r.uri)).toEqual(["org/personas/analyst"]);
  });

  it("bounds results by limit", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "c/**",
        instances: [
          { path: "c/a", content: "hooks" },
          { path: "c/b", content: "hooks" },
          { path: "c/c", content: "hooks" },
        ],
      },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "hooks", prefix: null, limit: 2 },
      ctx,
    );
    expect(results).toHaveLength(2);
  });
});

// FIX-858: external collections push the query down to their `search` hook
// instead of being enumerated + scored in memory. glob/grep skip them entirely.
describe("searchResources — external collection pushdown (FIX-858)", () => {
  function externalCtx(opts: {
    llmReadable?: boolean;
    list: (q: unknown) => Promise<{ items: any[]; nextCursor?: string }>;
  }): BlockContext {
    const entry = {
      pattern: "positions/*",
      scope: "org",
      external: true,
      config: { llmReadable: opts.llmReadable ?? true },
      list: opts.list,
      get: async () => {
        throw new Error("not found");
      },
      getOptional: async () => undefined,
    };
    return createMockContext({
      resources: { list: () => [entry], get: () => undefined } as any,
    });
  }

  it("pushes the query to the external search hook and returns its hits + nextCursor", async () => {
    const list = vi.fn(async () => ({
      items: [
        refOf({ path: "positions/AAPL", content: "AAPL 10 shares" }),
        refOf({ path: "positions/MSFT", content: "MSFT 4 shares" }),
      ],
      nextCursor: "p2",
    }));
    const ctx = externalCtx({ list });
    const { results, nextCursor } = await runForTest(
      searchResources,
      { query: "shares", prefix: null, limit: 10, cursor: null },
      ctx,
    );
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: "shares", limit: 10 }));
    expect(results.map((r) => r.uri)).toEqual(["org/positions/AAPL", "org/positions/MSFT"]);
    // Rank-preserving: first hit scores highest.
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    expect(nextCursor).toBe("p2");
  });

  it("skips non-llmReadable external collections", async () => {
    const list = vi.fn(async () => ({ items: [] }));
    const ctx = externalCtx({ llmReadable: false, list });
    await runForTest(searchResources, { query: "x", prefix: null, limit: 10, cursor: null }, ctx);
    expect(list).not.toHaveBeenCalled();
  });

  it("a cursor continuation forwards the cursor and advances only external results", async () => {
    const list = vi.fn(async () => ({
      items: [refOf({ path: "positions/GOOG", content: "GOOG" })],
    }));
    const ctx = externalCtx({ list });
    const { results, nextCursor } = await runForTest(
      searchResources,
      { query: "goog", prefix: null, limit: 10, cursor: "p2" },
      ctx,
    );
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ cursor: "p2" }));
    expect(results.map((r) => r.uri)).toEqual(["org/positions/GOOG"]);
    expect(nextCursor).toBeUndefined();
  });
});

describe("searchResources — external multi-collection & limit contract (FIX-858)", () => {
  function multiCtx(
    externals: Array<{
      pattern: string;
      llmReadable?: boolean;
      list: (q: unknown) => Promise<{ items: any[]; nextCursor?: string }>;
    }>,
    statics: MockResource[] = [],
  ): BlockContext {
    const entries: any[] = statics.map(refOf);
    for (const e of externals) {
      entries.push({
        pattern: e.pattern,
        scope: "org",
        external: true,
        config: { llmReadable: e.llmReadable ?? true },
        list: e.list,
        getOptional: async () => undefined,
      });
    }
    return createMockContext({ resources: { list: () => entries, get: () => undefined } as any });
  }

  it("caps the combined result set to `limit` (external hits + store-backed)", async () => {
    // External returns a full page of `limit`; store-backed also has matches.
    const list = vi.fn(async () => ({
      items: [
        refOf({ path: "positions/AAPL", content: "shares" }),
        refOf({ path: "positions/MSFT", content: "shares" }),
      ],
    }));
    const ctx = multiCtx(
      [{ pattern: "positions/*", list }],
      [
        { path: "notes/a", content: "shares shares" },
        { path: "notes/b", content: "shares" },
      ],
    );
    const { results } = await runForTest(
      searchResources,
      { query: "shares", prefix: null, limit: 2, cursor: null },
      ctx,
    );
    // Combined page never exceeds limit, and the budget split represents BOTH
    // sources — external doesn't starve store-backed (or vice versa).
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.uri.startsWith("org/positions/"))).toBe(true);
    expect(results.some((r) => r.uri.startsWith("org/notes/"))).toBe(true);
  });

  it("mixed external + store-backed: single page, store-backed never stranded, no cursor", async () => {
    // A full external page + store-backed matches. Because store-backed can't be
    // paginated under the external cursor without stranding, mixed mode returns
    // one page with both represented and NO cursor (rather than hiding store-backed).
    const list = vi.fn(async () => ({
      items: [refOf({ path: "positions/AAPL", content: "shares" })],
      nextCursor: "app-2",
    }));
    const ctx = multiCtx(
      [{ pattern: "positions/*", list }],
      [{ path: "notes/a", content: "shares shares shares" }],
    );
    const { results, nextCursor } = await runForTest(
      searchResources,
      { query: "shares", prefix: null, limit: 10, cursor: null },
      ctx,
    );
    // Store-backed appears (not stranded); no cursor is emitted in mixed mode.
    expect(results.some((r) => r.uri === "org/notes/a")).toBe(true);
    expect(results.some((r) => r.uri === "org/positions/AAPL")).toBe(true);
    expect(nextCursor).toBeUndefined();
    // The external hook is NOT paged (no cursor forwarded) in mixed mode.
    expect(list).toHaveBeenCalledWith(expect.not.objectContaining({ cursor: expect.anything() }));
  });

  it("does not forward one cursor to multiple external collections and emits no cursor", async () => {
    const listA = vi.fn(async () => ({ items: [refOf({ path: "a/1", content: "x" })], nextCursor: "a-2" }));
    const listB = vi.fn(async () => ({ items: [refOf({ path: "b/1", content: "x" })], nextCursor: "b-2" }));
    const ctx = multiCtx([
      { pattern: "a/*", list: listA },
      { pattern: "b/*", list: listB },
    ]);
    const { results, nextCursor } = await runForTest(
      searchResources,
      { query: "x", prefix: null, limit: 10, cursor: null },
      ctx,
    );
    // Neither collection received a cursor; no ambiguous cursor is returned.
    expect(listA).toHaveBeenCalledWith(expect.not.objectContaining({ cursor: expect.anything() }));
    expect(listB).toHaveBeenCalledWith(expect.not.objectContaining({ cursor: expect.anything() }));
    expect(nextCursor).toBeUndefined();
    expect(results.map((r) => r.uri).sort()).toEqual(["org/a/1", "org/b/1"]);
  });
});
