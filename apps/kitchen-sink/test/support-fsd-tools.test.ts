/**
 * `support.fsd` can look the framework up: its job is knowing how
 * flow-state-dev works.
 *
 *   - its file grants `search-docs` and `fetch`, both registered in its own
 *     `blocks/` folder, and the workforce builds with them (a name nothing
 *     registers is refused, and the build throws);
 *   - no other specialist gains them: the folder is the worker's own;
 *   - `search-docs` searches the docs site only. Red: a plain web search,
 *     whose query reaches the provider with no site filter;
 *   - `fetch` reads flow-state.dev pages only. A post can name any URL, so any
 *     other host, a look-alike, or a non-http scheme gets a refusal the model
 *     reads, and nothing is requested.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { testBlock } from "@flow-state-dev/testing";

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("support.fsd's lookups", () => {
  it("grants search-docs and fetch to support.fsd alone, and the workforce builds", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "");
    const { buildKitchenSinkWorkforce } = await import("@/lib/workforce-hire");
    const { installation, errors } = await buildKitchenSinkWorkforce();
    expect(errors).toEqual([]);
    expect(installation.standardWorker("support.fsd")?.declared.tools).toEqual(["search-docs", "fetch"]);

    const { workerBlocks } = await import("@/workforce/workforce.gen");
    const lookups = ["search-docs", "fetch"];
    expect(Object.keys(workerBlocks["support.fsd"] ?? {})).toEqual(expect.arrayContaining(lookups));
    for (const [worker, blocks] of Object.entries(workerBlocks)) {
      if (worker === "support.fsd") continue;
      expect(Object.keys(blocks).filter((name) => lookups.includes(name))).toEqual([]);
    }
  });

  it("search-docs asks the provider for the docs site's pages only", async () => {
    // Serper alone keyed, so the provider is known and its request is plain fetch.
    onlySearchKey("SERPER_API_KEY");
    const sent: Array<{ q: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ organic: [] }), { status: 200 });
      }),
    );

    const { default: searchDocs } = await import("@/workforce/teams/support/workers/fsd/blocks/search-docs");
    expect(searchDocs.name).toBe("search-docs");
    await testBlock(searchDocs, { input: { query: "defineFlow actions", maxResults: 3, topic: "general" } });

    expect(sent).toEqual([expect.objectContaining({ q: "defineFlow actions site:flow-state.dev" })]);
  });

  it("fetch reads a flow-state.dev page", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.stubEnv("JINA_API_KEY", "test-key");
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        return new Response(JSON.stringify({ data: { title: "Flows", content: "defineFlow" } }), { status: 200 });
      }),
    );

    const { default: fetchDocs } = await import("@/workforce/teams/support/workers/fsd/blocks/fetch");
    expect(fetchDocs.name).toBe("fetch");
    for (const url of ["https://flow-state.dev/docs/flows", "https://www.flow-state.dev/docs"]) {
      const { output } = await testBlock(fetchDocs, { input: { url } });
      expect(output).toMatchObject({ title: "Flows", markdown: "defineFlow" });
    }
    expect(requested).toEqual([
      "https://r.jina.ai/https://flow-state.dev/docs/flows",
      "https://r.jina.ai/https://www.flow-state.dev/docs",
    ]);
  });

  it.each([
    "https://example.com/",
    "https://flow-state.dev.evil.com/docs",
    "https://evilflow-state.dev/docs",
    "https://flow-state.dev@evil.com/docs",
    "file:///etc/passwd",
    "ftp://flow-state.dev/docs",
    "not a url",
  ])("fetch refuses %s and requests nothing", async (url) => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.stubEnv("JINA_API_KEY", "test-key");
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    const { default: fetchDocs } = await import("@/workforce/teams/support/workers/fsd/blocks/fetch");
    const { output } = await testBlock(fetchDocs, { input: { url } });

    expect(output).toEqual({ refused: expect.stringContaining("flow-state.dev") });
    expect(sent).not.toHaveBeenCalled();
  });
});

/** Key one search provider and blank the rest, so the provider is known. */
function onlySearchKey(key: string): void {
  for (const other of [
    "PARALLEL_API_KEY",
    "TAVILY_API_KEY",
    "EXA_API_KEY",
    "PERPLEXITY_API_KEY",
    "SERPER_API_KEY",
    "BRAVE_SEARCH_API_KEY",
  ]) {
    vi.stubEnv(other, other === key ? "test-key" : "");
  }
}
