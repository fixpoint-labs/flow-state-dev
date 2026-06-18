import { describe, it, expect } from "vitest";
import { resourceSearchTools } from "../src/tools/resource-search-tools";
import type { BlockContext } from "../src/types/block";
import { createMockContext, runForTest } from "./helpers";

type MockResource = { path: string; content?: string | null; llmReadable?: boolean };
type MockCollection = { pattern: string; instances: MockResource[] };

function refOf(r: MockResource): any {
  const content = r.content === undefined ? null : r.content;
  return {
    path: r.path,
    scope: "org",
    uri: `org/${r.path}`,
    state: {},
    config: { llmReadable: r.llmReadable ?? true },
    readContentRaw: async () => content,
    readContent: async () => content,
  };
}

function makeCtx(statics: MockResource[] = [], collections: MockCollection[] = []): BlockContext {
  const entries: any[] = [];
  for (const r of statics) entries.push(refOf(r));
  for (const c of collections) {
    entries.push({
      pattern: c.pattern,
      scope: "org",
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
    const { paths } = await runForTest(globResources,{ pattern: "concepts/**", limit: 100 }, ctx);
    expect(paths).toEqual(["concepts/react", "concepts/react/hooks"]);
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
    expect(single.paths).toEqual(["concepts/react", "concepts/react-hooks"]);

    const substring = await runForTest(globResources,{ pattern: "concepts/*hooks*", limit: 100 }, ctx);
    expect(substring.paths).toEqual(["concepts/react-hooks"]);
  });

  it("lists all paths (static + collection) sorted when pattern is null", async () => {
    const ctx = makeCtx([{ path: "soul" }], [
      { pattern: "concepts/**", instances: [{ path: "concepts/b" }, { path: "concepts/a" }] },
    ]);
    const { paths } = await runForTest(globResources,{ pattern: null, limit: 100 }, ctx);
    expect(paths).toEqual(["concepts/a", "concepts/b", "soul"]);
  });

  it("does not gate on llmReadable (path discovery, like listResources)", async () => {
    const ctx = makeCtx([], [
      { pattern: "concepts/**", instances: [{ path: "concepts/secret", llmReadable: false }] },
    ]);
    const { paths } = await runForTest(globResources,{ pattern: "concepts/**", limit: 100 }, ctx);
    expect(paths).toEqual(["concepts/secret"]);
  });

  it("bounds results by limit", async () => {
    const ctx = makeCtx([], [
      { pattern: "c/**", instances: [{ path: "c/1" }, { path: "c/2" }, { path: "c/3" }] },
    ]);
    const { paths } = await runForTest(globResources,{ pattern: "c/**", limit: 2 }, ctx);
    expect(paths).toEqual(["c/1", "c/2"]);
  });

  it("returns empty when the registry is empty", async () => {
    const { paths } = await runForTest(globResources,{ pattern: null, limit: 100 }, makeCtx());
    expect(paths).toEqual([]);
  });
});

describe("grepResourceContent", () => {
  it("returns matching lines with 1-based line numbers and the resource path", async () => {
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
    expect(matches).toEqual([{ path: "concepts/react", line: 2, snippet: "useEffect hook" }]);
  });

  it("excludes resources that are not llmReadable", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [
          { path: "concepts/public", content: "needle here", llmReadable: true },
          { path: "concepts/private", content: "needle here", llmReadable: false },
        ],
      },
    ]);
    const { matches } = await runForTest(grepResourceContent,
      { pattern: "needle", prefix: null, maxResults: 50 },
      ctx,
    );
    expect(matches.map((m) => m.path)).toEqual(["concepts/public"]);
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
    expect(matches.map((m) => m.path)).toEqual(["concepts/a"]);
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
    expect(results.map((r) => r.path)).toEqual(["concepts/high", "concepts/mid", "concepts/low"]);
    expect(results[0]!.score).toBe(3);
  });

  it("excludes zero-score and non-llmReadable resources", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "concepts/**",
        instances: [
          { path: "concepts/match", content: "useState and hooks" },
          { path: "concepts/nomatch", content: "totally unrelated" },
          { path: "concepts/hidden", content: "hooks hooks", llmReadable: false },
        ],
      },
    ]);
    const { results } = await runForTest(searchResources,
      { query: "hooks", prefix: null, limit: 10 },
      ctx,
    );
    expect(results.map((r) => r.path)).toEqual(["concepts/match"]);
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
    expect(results.map((r) => r.path)).toEqual(["concepts/a"]);
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
