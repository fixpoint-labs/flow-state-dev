/**
 * FIX-701: per-block resource-load tracing.
 *
 * Records, per block dispatch, the resource loads attributable to that block —
 * store fetch vs in-memory cache hit, wall time, the wave/accessor that
 * triggered it — and surfaces them on the block's `block_trace.resourceLoads`.
 * Read-path, trace-only: the SSE items stream is untouched.
 *
 * These are white-box tests over the emitted `block_trace` items, modelled on
 * `prefetch-waves.test.ts` / `prefetch-lazy-collection.test.ts`.
 */
import { describe, expect, it, afterEach } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type { BlockTraceItem, ResourceLoadRecord } from "@flow-state-dev/core/items";
import type { ModelResolver, GeneratorModel } from "@flow-state-dev/core/types";
import { createInMemoryStores, createResponseEmitter, runAction } from "../src";

function createStubModelResolver(): ModelResolver {
  const resolver = ((modelId: string): GeneratorModel => ({
    modelId,
    generate: async () => ({
      text: `stub response from ${modelId}`,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  })) as ModelResolver;
  resolver.resolveId = (modelId: string) => modelId;
  return resolver;
}

type Stores = ReturnType<typeof createInMemoryStores>;

async function run(flow: ReturnType<ReturnType<typeof defineFlow>>, stores: Stores, input: unknown = {}) {
  const response = createResponseEmitter({ requestId: `req_${Math.random().toString(16).slice(2)}`, now: () => Date.now() });
  const result = await runAction({
    flow,
    actionName: "run",
    input,
    userId: "u1",
    sessionId: "s1",
    stores,
    responseEmitter: response,
    runtimeConfig: { modelResolver: createStubModelResolver() }
  });
  expect(result.error).toBeUndefined();
  const traces = response.getItems().filter((i) => i.type === "block_trace") as BlockTraceItem[];
  return { traces, byName: (name: string) => traces.find((t) => t.blockName === name) };
}

const loadsOf = (t: BlockTraceItem | undefined): ResourceLoadRecord[] => t?.resourceLoads ?? [];

afterEach(() => {
  delete process.env.FSDEV_TRACE_OBSERVABILITY;
});

describe("FIX-701: per-block resource-load tracing", () => {
  it("a lazy single declared on a block produces one block-eager fetch record (cacheHit:false)", async () => {
    const lazyS = defineResource({
      scope: "session",
      ref: "lazyS",
      prefetchMode: "lazy",
      stateSchema: z.object({ v: z.number().default(0) }),
      writable: true
    });
    const block = handler({
      name: "reads-lazy-single",
      resources: { lazyS },
      execute: (_input, ctx) => ({ v: (ctx.resources.lazyS.state as { v: number }).v })
    });
    const flow = defineFlow({
      kind: "lazy-single",
      actions: { run: { inputSchema: z.object({}), block } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "lazyS", { v: 7 });

    const { byName } = await run(flow, stores);
    const fetches = loadsOf(byName("reads-lazy-single")).filter(
      (r) => r.storageKey === "lazyS" && !r.cacheHit
    );
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toMatchObject({ source: "block-eager", scope: "session", count: 1 });
  });

  it("an eager single declared on the action's block produces an action-eager fetch record", async () => {
    const eagerS = defineResource({
      scope: "session",
      ref: "eagerS",
      stateSchema: z.object({ v: z.number().default(0) }),
      writable: true
    });
    const block = handler({
      name: "reads-eager-single",
      resources: { eagerS },
      execute: (_input, ctx) => ({ v: (ctx.resources.eagerS.state as { v: number }).v })
    });
    const flow = defineFlow({
      kind: "eager-single",
      actions: { run: { inputSchema: z.object({}), block } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "eagerS", { v: 9 });

    const { byName } = await run(flow, stores);
    // Declared on the action's block (not flow-level), so it loads at the
    // action-dispatch wave as a single store fetch.
    const fetches = loadsOf(byName("reads-eager-single")).filter(
      (r) => r.storageKey === "eagerS" && !r.cacheHit
    );
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toMatchObject({ source: "action-eager", cacheHit: false, count: 1 });
  });

  it("drains a block's resource loads even when the block throws before output", async () => {
    const lazyS = defineResource({
      scope: "session",
      ref: "boomLazy",
      prefetchMode: "lazy",
      stateSchema: z.object({ v: z.number().default(0) }),
      writable: true
    });
    const block = handler({
      name: "boom",
      resources: { boomLazy: lazyS },
      execute: (_input, ctx) => {
        // Touch the lazy single (block-eager load fired at dispatch), then throw.
        void (ctx.resources.boomLazy.state as { v: number }).v;
        throw new Error("boom");
      }
    });
    const flow = defineFlow({
      kind: "boom-flow",
      actions: { run: { inputSchema: z.object({}), block } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "boomLazy", { v: 1 });

    const response = createResponseEmitter({ requestId: "req_boom", now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      responseEmitter: response,
      runtimeConfig: { modelResolver: createStubModelResolver() }
    });
    expect(result.error).toBeDefined();
    const traces = response.getItems().filter((i) => i.type === "block_trace") as BlockTraceItem[];
    const failed = traces.find((t) => t.blockName === "boom");
    expect(failed?.status).toBe("failed");
    const fetches = loadsOf(failed).filter((r) => r.storageKey === "boomLazy" && !r.cacheHit);
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toMatchObject({ source: "block-eager" });
  });

  it("an eager collection read N times collapses to one aggregated cache-hit row with count:N", async () => {
    const eagerColl = defineResourceCollection({
      scope: "session",
      pattern: "ec/**",
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const reader = handler({
      name: "reads-eager-many",
      resources: { ec: eagerColl },
      execute: async (_input, ctx) => {
        const coll = ctx.resources.ec as unknown as { get(k: string): Promise<{ state: { n: number } }> };
        for (let i = 0; i < 5; i += 1) await coll.get("x");
        return { ok: true };
      }
    });
    // Sequencer so the reading block is distinct from the entry block.
    const pipeline = sequencer({ name: "ec-seq", inputSchema: z.object({}) }).step(reader);
    const flow = defineFlow({
      kind: "eager-many",
      actions: { run: { inputSchema: z.object({}), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "ec/x", { n: 1 });

    const { byName } = await run(flow, stores);
    const hits = loadsOf(byName("reads-eager-many")).filter(
      (r) => r.accessor === "get" && r.cacheHit
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ storageKey: "ec/x", cacheHit: true, count: 5, accessor: "get" });
  });

  it("a lazy collection read for N distinct keys emits N store fetches; re-reads collapse to a cache-hit row", async () => {
    const lazyColl = defineResourceCollection({
      scope: "session",
      pattern: "lz/**",
      prefetchMode: "lazy",
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const reader = handler({
      name: "reads-lazy-coll",
      resources: { lz: lazyColl },
      execute: async (_input, ctx) => {
        const coll = ctx.resources.lz as unknown as { get(k: string): Promise<{ state: { n: number } }> };
        await coll.get("a");
        await coll.get("b");
        await coll.get("c");
        await coll.get("a");
        await coll.get("a");
        return { ok: true };
      }
    });
    const flow = defineFlow({
      kind: "lazy-many",
      actions: { run: { inputSchema: z.object({}), block: reader } }
    })();

    const stores = createInMemoryStores();
    for (const k of ["a", "b", "c"]) await stores.resourceState.set("session", "s1", `lz/${k}`, { n: 1 });

    const { byName } = await run(flow, stores);
    const loads = loadsOf(byName("reads-lazy-coll")).filter((r) => r.source === "lazy");

    const fetches = loads.filter((r) => !r.cacheHit);
    expect(fetches.map((r) => r.storageKey).sort()).toEqual(["lz/a", "lz/b", "lz/c"]);
    for (const f of fetches) expect(f).toMatchObject({ source: "lazy", accessor: "get", cacheHit: false });

    const reHits = loads.filter((r) => r.cacheHit && r.storageKey === "lz/a");
    expect(reHits).toHaveLength(1);
    expect(reHits[0]).toMatchObject({ count: 2, cacheHit: true, accessor: "get" });
  });

  it("wave-1 (flow-eager) and wave-2 (action-eager) loads land on the entry block, exactly once", async () => {
    const flowRes = defineResource({
      scope: "session",
      ref: "flowRes",
      stateSchema: z.object({ v: z.number().default(0) }),
      writable: true
    });
    const actionColl = defineResourceCollection({
      scope: "session",
      pattern: "ac/**",
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const block = handler({
      name: "entry",
      resources: { ac: actionColl },
      execute: () => ({ ok: true })
    });
    const flow = defineFlow({
      kind: "waves-trace",
      resources: { flowRes },
      actions: { run: { inputSchema: z.object({}), block } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "flowRes", { v: 3 });
    await stores.resourceState.set("session", "s1", "ac/one", { n: 1 });

    const { byName } = await run(flow, stores);
    const loads = loadsOf(byName("entry"));

    const flowEager = loads.filter((r) => r.source === "flow-eager" && r.storageKey === "flowRes");
    expect(flowEager).toHaveLength(1);

    const actionFetch = loads.filter(
      (r) => r.source === "action-eager" && r.storageKey === "ac/" && !r.cacheHit
    );
    expect(actionFetch).toHaveLength(1);
  });

  it("parallel branches attribute their lazy reads to their own block instances (no cross-talk)", async () => {
    const lazyColl = defineResourceCollection({
      scope: "session",
      pattern: "pz/**",
      prefetchMode: "lazy",
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const branchA = handler({
      name: "branch-a",
      resources: { pz: lazyColl },
      execute: async (_input, ctx) => {
        await (ctx.resources.pz as unknown as { get(k: string): Promise<unknown> }).get("a");
        return 1;
      }
    });
    const branchB = handler({
      name: "branch-b",
      resources: { pz: lazyColl },
      execute: async (_input, ctx) => {
        await (ctx.resources.pz as unknown as { get(k: string): Promise<unknown> }).get("b");
        return 2;
      }
    });
    const pipeline = sequencer({ name: "par", inputSchema: z.object({}) }).parallel({ a: branchA, b: branchB });
    const flow = defineFlow({
      kind: "par-trace",
      actions: { run: { inputSchema: z.object({}), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "pz/a", { n: 1 });
    await stores.resourceState.set("session", "s1", "pz/b", { n: 2 });

    const { byName } = await run(flow, stores);
    const aKeys = loadsOf(byName("branch-a")).filter((r) => r.source === "lazy").map((r) => r.storageKey);
    const bKeys = loadsOf(byName("branch-b")).filter((r) => r.source === "lazy").map((r) => r.storageKey);
    expect(aKeys).toContain("pz/a");
    expect(aKeys).not.toContain("pz/b");
    expect(bKeys).toContain("pz/b");
    expect(bKeys).not.toContain("pz/a");
  });

  it("declaredResources lists the block's declared accessor keys", async () => {
    const flowRes = defineResource({
      scope: "session",
      ref: "decl",
      stateSchema: z.object({ v: z.number().default(0) }),
      writable: true
    });
    const block = handler({
      name: "declarer",
      resources: { decl: flowRes },
      execute: () => ({ ok: true })
    });
    const flow = defineFlow({
      kind: "declared",
      actions: { run: { inputSchema: z.object({}), block } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "decl", { v: 1 });

    const { byName } = await run(flow, stores);
    expect(byName("declarer")?.declaredResources).toContain("decl");
  });

  it("records nothing on the items stream when trace observability is disabled", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const lazyColl = defineResourceCollection({
      scope: "session",
      pattern: "off/**",
      prefetchMode: "lazy",
      stateSchema: z.object({ n: z.number().default(0) })
    });
    const block = handler({
      name: "off",
      resources: { off: lazyColl },
      execute: async (_input, ctx) => {
        await (ctx.resources.off as unknown as { get(k: string): Promise<unknown> }).get("a");
        return { ok: true };
      }
    });
    const flow = defineFlow({
      kind: "obs-off",
      actions: { run: { inputSchema: z.object({}), block } }
    })();

    const stores = createInMemoryStores();
    await stores.resourceState.set("session", "s1", "off/a", { n: 1 });

    const response = createResponseEmitter({ requestId: "req_off", now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      responseEmitter: response,
      runtimeConfig: { modelResolver: createStubModelResolver() }
    });
    expect(result.error).toBeUndefined();
    const withLoads = response
      .getItems()
      .filter((i) => i.type === "block_trace" && (i as BlockTraceItem).resourceLoads !== undefined);
    expect(withLoads).toHaveLength(0);
  });
});
