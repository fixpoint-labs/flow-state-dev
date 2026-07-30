/**
 * FIX-688 Slice 3: lazy collection accessor.
 *
 * A `prefetchMode: 'lazy'` collection is never preloaded; its read accessors
 * (`get`/`getOptional`/`list`/`count`) become async and issue single-row /
 * single-prefix store reads on demand, caching results so repeat reads and
 * mutations stay in-memory. Concurrent reads of the same key single-flight.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { ModelResolver, GeneratorModel } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "../src";

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

const lazyColl = defineResourceCollection({
  scope: "session",
  pattern: "lz/**",
  prefetchMode: "lazy",
  stateSchema: z.object({ n: z.number().default(0) })
});

const flow = defineFlow({
  kind: "lazycoll",
  resources: { lz: lazyColl },
  actions: {
    run: { inputSchema: z.object({}), block: handler({ name: "noop", execute: () => "ok" }) }
  }
})();

function spyStores() {
  const stores = createInMemoryStores();
  const get = vi.spyOn(stores.resourceState, "get");
  const getByPrefix = vi.spyOn(stores.resourceState, "getByPrefix");
  return { stores, get, getByPrefix };
}

function ctxFor(stores: ReturnType<typeof createInMemoryStores>) {
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId: "r1",
    sessionId: "s1",
    userId: "u1",
    stores,
    modelResolver: createStubModelResolver()
  });
}

// Async lazy-collection accessor surface, narrowed for test ergonomics.
type LazyColl = {
  get(k: string): Promise<{ state: { n: number } }>;
  getOptional(k: string): Promise<{ state: { n: number } } | undefined>;
  list(prefix?: string): Promise<Array<{ state: { n: number } }>>;
  count(): Promise<number>;
  create(k: string, init?: { n?: number }): Promise<{ state: { n: number } }>;
  delete(k: string): Promise<void>;
};
const coll = (ctx: Awaited<ReturnType<typeof ctxFor>>): LazyColl =>
  ctx.resources.lz as unknown as LazyColl;

describe("FIX-688: lazy collection accessor", () => {
  it("get() issues a single-row store read and returns a sync-readable ref", async () => {
    const { stores, get } = spyStores();
    await stores.resourceState.set("session", "s1", "lz/a", { n: 5 });
    const ctx = await ctxFor(stores);
    get.mockClear();

    const ref = await coll(ctx).get("a");
    expect(ref.state.n).toBe(5);
    expect(get.mock.calls.filter((c) => c[2] === "lz/a").length).toBe(1);

    // Second get hits the cache — no further store read.
    const ref2 = await coll(ctx).get("a");
    expect(ref2.state.n).toBe(5);
    expect(get.mock.calls.filter((c) => c[2] === "lz/a").length).toBe(1);
  });

  it("single-flights concurrent get() of the same key", async () => {
    const { stores, get } = spyStores();
    await stores.resourceState.set("session", "s1", "lz/a", { n: 1 });
    const ctx = await ctxFor(stores);
    get.mockClear();

    await Promise.all([coll(ctx).get("a"), coll(ctx).get("a")]);
    expect(get.mock.calls.filter((c) => c[2] === "lz/a").length).toBe(1);
  });

  it("list() issues one prefix read and warms the cache for later gets", async () => {
    const { stores, get, getByPrefix } = spyStores();
    await stores.resourceState.set("session", "s1", "lz/a", { n: 1 });
    await stores.resourceState.set("session", "s1", "lz/b", { n: 2 });
    const ctx = await ctxFor(stores);
    getByPrefix.mockClear();
    get.mockClear();

    const all = await coll(ctx).list();
    expect(all.map((r) => r.state.n).sort()).toEqual([1, 2]);
    expect(getByPrefix.mock.calls.filter((c) => c[2] === "lz/").length).toBe(1);

    expect(await coll(ctx).count()).toBe(2);

    const ref = await coll(ctx).get("a");
    expect(ref.state.n).toBe(1);
    expect(get.mock.calls.filter((c) => c[2] === "lz/a").length).toBe(0); // served from warmed cache
  });

  it("does not resurrect a key deleted while the prefix read was in flight", async () => {
    const { stores } = spyStores();
    await stores.resourceState.set("session", "s1", "lz/a", { n: 1 });
    await stores.resourceState.set("session", "s1", "lz/b", { n: 2 });
    const ctx = await ctxFor(stores);

    // Pull `lz/a` into the request cache so the delete has something to remove.
    // A single-key read does not mark the prefix loaded, so the bulk read below
    // is still the first one for `lz/`.
    await coll(ctx).get("a");

    // Hold the prefix read open so its snapshot is taken *before* the delete and
    // its merge lands *after* it. That ordering is the whole bug: the snapshot
    // still carries `lz/a`, and a deleted key is absent from the cache rather
    // than present-and-empty, so a merge that spreads the cache over the
    // snapshot has nothing to override the stale row with.
    let releaseRead!: () => void;
    let snapshotTaken!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const snapshotDone = new Promise<void>((resolve) => {
      snapshotTaken = resolve;
    });
    const realGetByPrefix = stores.resourceState.getByPrefix.bind(stores.resourceState);
    vi.spyOn(stores.resourceState, "getByPrefix").mockImplementation(async (...args) => {
      const snapshot = await realGetByPrefix(...args);
      snapshotTaken();
      await gate;
      return snapshot;
    });

    const listing = coll(ctx).list();
    await snapshotDone; // the snapshot is now pre-delete, deterministically
    await coll(ctx).delete("a");
    releaseRead();

    const rows = await listing;
    expect(rows.map((r) => r.state.n)).toEqual([2]);
    expect(await coll(ctx).count()).toBe(1);
    expect(await coll(ctx).getOptional("a")).toBeUndefined();
    // The store row is gone and must stay gone — a resurrected cache entry gets
    // written back on the next persist, which is what makes the ghost durable.
    expect(await stores.resourceState.get("session", "s1", "lz/a")).toBeUndefined();
  });

  it("get() rejects (and getOptional resolves undefined) for a missing instance", async () => {
    const { stores } = spyStores();
    const ctx = await ctxFor(stores);
    await expect(coll(ctx).get("missing")).rejects.toThrow(/not found/);
    expect(await coll(ctx).getOptional("missing")).toBeUndefined();
  });

  it("negatively caches a missing key — one store read across repeated misses", async () => {
    const { stores, get } = spyStores();
    const ctx = await ctxFor(stores);
    get.mockClear();

    await expect(coll(ctx).get("missing")).rejects.toThrow(/not found/);
    expect(await coll(ctx).getOptional("missing")).toBeUndefined();
    await expect(coll(ctx).get("missing")).rejects.toThrow(/not found/);

    expect(get.mock.calls.filter((c) => c[2] === "lz/missing").length).toBe(1);
  });

  it("treats a miss as authoritative after the prefix is bulk-loaded — zero extra reads", async () => {
    const { stores, get } = spyStores();
    await stores.resourceState.set("session", "s1", "lz/a", { n: 1 });
    const ctx = await ctxFor(stores);

    await coll(ctx).list(); // bulk-loads the "lz/" prefix
    get.mockClear();

    expect(await coll(ctx).getOptional("missing")).toBeUndefined();
    expect(get.mock.calls.filter((c) => c[2] === "lz/missing").length).toBe(0);
  });

  it("create() persists and is readable without an extra store read", async () => {
    const { stores, get } = spyStores();
    const ctx = await ctxFor(stores);

    const ref = await coll(ctx).create("x", { n: 7 });
    expect(ref.state.n).toBe(7);
    expect(await stores.resourceState.get("session", "s1", "lz/x")).toEqual({ n: 7 });

    get.mockClear();
    const got = await coll(ctx).get("x");
    expect(got.state.n).toBe(7);
    expect(get.mock.calls.filter((c) => c[2] === "lz/x").length).toBe(0);
  });

  it("does not preload a flow-level lazy collection at request start", async () => {
    const { stores, getByPrefix } = spyStores();
    await stores.resourceState.set("session", "s1", "lz/a", { n: 1 });
    await ctxFor(stores);
    expect(getByPrefix.mock.calls.filter((c) => c[2] === "lz/").length).toBe(0);
  });
});
