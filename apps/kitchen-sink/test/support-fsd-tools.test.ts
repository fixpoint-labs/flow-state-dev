/**
 * `support.fsd` can look the framework up (FIX-2496). Its job is knowing how
 * flow-state-dev works, and with no tools it answered from the model's memory.
 *
 *   - its file grants `search-docs` and `fetch`, both registered in its own
 *     `blocks/` folder, and the workforce builds with them (a name nothing
 *     registers is refused, and the build throws);
 *   - no other specialist gains them: the folder is the worker's own;
 *   - `search-docs` searches the docs site only. Red: a plain web search,
 *     whose query reaches the provider with no site filter.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runForTest } from "@flow-state-dev/testing";

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("support.fsd's lookups", () => {
  it("grants search-docs and fetch to support.fsd alone, and the workforce builds", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "");
    const { buildKitchenSinkWorkforce } = await import("@/workforce/hire");
    const { installation, errors } = await buildKitchenSinkWorkforce();
    expect(errors).toEqual([]);
    expect(installation.standardWorker("support.fsd")?.declared.tools).toEqual(["search-docs", "fetch"]);

    const { workerBlocks } = await import("@/workforce/workforce.gen");
    expect(Object.keys(workerBlocks)).toEqual(["support.fsd"]);
  });

  it("search-docs asks the provider for the docs site's pages only", async () => {
    // Serper alone keyed, so the provider is known and its request is plain fetch.
    for (const key of [
      "PARALLEL_API_KEY",
      "TAVILY_API_KEY",
      "EXA_API_KEY",
      "PERPLEXITY_API_KEY",
      "BRAVE_SEARCH_API_KEY",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.stubEnv("SERPER_API_KEY", "test-key");
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
    await runForTest(searchDocs, { query: "defineFlow actions", maxResults: 3, topic: "general" }, {} as never);

    expect(sent).toEqual([expect.objectContaining({ q: "defineFlow actions site:flow-state.dev" })]);
  });
});
