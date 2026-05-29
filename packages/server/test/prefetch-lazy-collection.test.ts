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
import { createExecutionContext, createInMemoryStores } from "../src";

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
    stores
  });
}

// Async lazy-collection accessor surface, narrowed for test ergonomics.
type LazyColl = {
  get(k: string): Promise<{ state: { n: number } }>;
  getOptional(k: string): Promise<{ state: { n: number } } | undefined>;
  list(prefix?: string): Promise<Array<{ state: { n: number } }>>;
  count(): Promise<number>;
  create(k: string, init?: { n?: number }): Promise<{ state: { n: number } }>;
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
