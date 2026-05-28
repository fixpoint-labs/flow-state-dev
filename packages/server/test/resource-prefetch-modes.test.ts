/**
 * FIX-688: configurable resource/collection prefetch (eager / lazy / partial)
 * at the execution-context layer. These tests assert the *why* behind each
 * mode: eager trades a startup read for synchronous in-request reads; lazy
 * trades startup cost for on-demand store reads; partial preloads only the
 * lex-highest `recentLimit` keys. They also lock the freshness, single-flight,
 * eviction, and pagination contracts that make on-demand loading safe to use
 * from handler code without surprising redundant reads or stale state.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores } from "../src";
import type { ResourceCollectionRef, JsonObject } from "@flow-state-dev/core/types";

const fileSchema = z.object({ language: z.string() });

function makeFlow(resources: Record<string, any>) {
  const block = handler({ name: "noop", resources, execute: () => "ok" });
  return defineFlow({
    kind: "prefetch-test",
    actions: { run: { inputSchema: z.string(), block } },
  })();
}

/**
 * Wrap a fresh in-memory store set, counting `resourceState.get` and
 * `getByPrefixPaged` calls. Read counters are how we prove a mode preloaded
 * (or did not), single-flighted, and didn't re-read cached instances.
 */
function spyStores() {
  const stores = createInMemoryStores();
  let getCount = 0;
  let pagedCount = 0;
  const getKeys: string[] = [];

  const realGet = stores.resourceState.get.bind(stores.resourceState);
  stores.resourceState.get = async (scope, id, key) => {
    getCount += 1;
    getKeys.push(key);
    return realGet(scope, id, key);
  };
  const realPaged = stores.resourceState.getByPrefixPaged.bind(stores.resourceState);
  stores.resourceState.getByPrefixPaged = async (scope, id, prefix, opts) => {
    pagedCount += 1;
    return realPaged(scope, id, prefix, opts);
  };

  return {
    stores,
    get getCount() { return getCount; },
    get pagedCount() { return pagedCount; },
    getKeys,
    reset() { getCount = 0; pagedCount = 0; getKeys.length = 0; },
  };
}

async function ctxWith(stores: ReturnType<typeof createInMemoryStores>, resources: Record<string, any>, sessionId = "sess_1") {
  const flow = makeFlow(resources);
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId: `req_${Math.random().toString(36).slice(2)}`,
    sessionId,
    userId: "user_1",
    stores,
  });
}

/** Persist instances directly into the store so a later request loads them. */
async function seedInstances(
  stores: ReturnType<typeof createInMemoryStores>,
  keys: string[],
  sessionId = "sess_1"
) {
  for (const key of keys) {
    await stores.resourceState.set("session", sessionId, key, { language: "ts" });
  }
}

describe("FIX-688 prefetch modes — collections", () => {
  it("eager preloads all instances at startup; in-request reads issue no store get", async () => {
    // WHY: eager mode's contract is that handlers can read any existing
    // instance synchronously against the cache — the cost is paid once at
    // scope startup, never per read.
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "eager",
    });
    const spy = spyStores();
    await seedInstances(spy.stores, ["files/a.ts", "files/b.ts"]);

    spy.reset();
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    // After startup, reading a preloaded instance must not touch the store.
    spy.reset();
    const ref = await ns.get("a.ts");
    expect((await ref.state()).language).toBe("ts");
    expect(spy.getCount).toBe(0);
  });

  it("lazy preloads nothing; first get() loads from the store, then caches", async () => {
    // WHY: lazy mode defers all load cost. The first access pays one store
    // read; subsequent accesses of the same key must be cache hits.
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
    });
    const spy = spyStores();
    await seedInstances(spy.stores, ["files/a.ts"]);

    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    // Lazy mode issues no preload pages for this collection.
    expect(spy.pagedCount).toBe(0);

    spy.reset();
    const ref = await ns.get("a.ts");
    expect((await ref.state()).language).toBe("ts");
    expect(spy.getCount).toBe(1);

    // Second access is served from the seeded cache — no further store read.
    spy.reset();
    await ns.get("a.ts");
    expect(spy.getCount).toBe(0);
  });

  it("partial eagerly loads the recentLimit lex-highest keys; older keys load lazily", async () => {
    // WHY: partial mode is the "most-recent N" affordance. With a sortable key
    // convention, the highest keys are the freshest; those preload, the tail
    // stays lazy so a large collection doesn't inflate startup.
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "partial",
      recentLimit: 2,
    });
    const spy = spyStores();
    await seedInstances(spy.stores, [
      "files/01.ts", "files/02.ts", "files/03.ts", "files/04.ts",
    ]);

    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    // The two lex-highest keys (03, 04) were preloaded — reading them issues
    // no store get.
    spy.reset();
    await ns.get("04.ts");
    await ns.get("03.ts");
    expect(spy.getCount).toBe(0);

    // A lower key was NOT preloaded — reading it lazily loads from the store.
    spy.reset();
    await ns.get("01.ts");
    expect(spy.getCount).toBe(1);
  });
});

describe("FIX-688 freshness, single-flight, redundancy", () => {
  it("mutation then read sees the fresh value within the request (write-through)", async () => {
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
    });
    const spy = spyStores();
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    await ns.create("a.ts", { language: "ts" });
    await (await ns.get("a.ts")).setState({ language: "py" });
    // WHY: a write-through mutation must be visible to a later read in the same
    // request without re-fetching a stale store snapshot.
    expect((await (await ns.get("a.ts")).state()).language).toBe("py");
  });

  it("concurrent get() of the same missing key issues exactly one store read (single-flight)", async () => {
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
    });
    const spy = spyStores();
    await seedInstances(spy.stores, ["files/a.ts"]);
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    spy.reset();
    // WHY: two handlers racing on the same uncached key must coalesce into one
    // store read, not stampede the store.
    const [r1, r2] = await Promise.all([ns.get("a.ts"), ns.get("a.ts")]);
    expect((await r1.state()).language).toBe("ts");
    expect((await r2.state()).language).toBe("ts");
    expect(spy.getKeys.filter((k) => k === "files/a.ts")).toHaveLength(1);
  });

  it("no redundant store read when the instance is already cached", async () => {
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
    });
    const spy = spyStores();
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    // Created this request → already in cache; reads must not hit the store.
    await ns.create("a.ts", { language: "ts" });
    spy.reset();
    await ns.get("a.ts");
    await ns.getOptional("a.ts");
    expect(spy.getCount).toBe(0);
  });

  it("eviction then re-access re-fetches from the store", async () => {
    // WHY: an evicted instance must be re-readable; eviction drops it from the
    // cache but the store remains the source of truth.
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
      maxInstances: 2,
      eviction: "oldest",
    });
    const spy = spyStores();
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    await ns.create("a.ts", { language: "ts" });
    await ns.create("b.ts", { language: "ts" });
    // Creating c evicts a (oldest) from the cache AND persists its deletion.
    await ns.create("c.ts", { language: "ts" });

    // a was evicted, so re-persist it directly to the store to model a key the
    // cache no longer holds but the store still does, then re-access.
    await spy.stores.resourceState.set("session", "sess_1", "files/a.ts", { language: "ts" });
    spy.reset();
    const ref = await ns.get("a.ts");
    expect((await ref.state()).language).toBe("ts");
    expect(spy.getCount).toBe(1);
  });
});

describe("FIX-688 list / scan / count pagination", () => {
  it("list clamps limit to [1,1000] and pages via the opaque key cursor", async () => {
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
    });
    const spy = spyStores();
    await seedInstances(spy.stores, ["files/a", "files/b", "files/c", "files/d"]);
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    // limit 0 clamps up to 1.
    const first = await ns.list({ limit: 0 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe("files/a");

    // Page forward with the cursor until exhausted.
    const collected: string[] = first.items.map((r) => r.name);
    let cursor = first.nextCursor;
    while (cursor !== undefined) {
      const page = await ns.list({ limit: 2, cursor });
      collected.push(...page.items.map((r) => r.name));
      cursor = page.nextCursor;
    }
    expect(collected).toEqual(["files/a", "files/b", "files/c", "files/d"]);
  });

  it("scan traverses every instance lex-ascending across pages", async () => {
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
    });
    const spy = spyStores();
    await seedInstances(spy.stores, ["files/a", "files/b", "files/c"]);
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    const seen: string[] = [];
    for await (const ref of ns.scan({ pageSize: 1 })) {
      seen.push(ref.name);
    }
    expect(seen).toEqual(["files/a", "files/b", "files/c"]);
  });

  it("scan throws promptly when its AbortSignal fires", async () => {
    const coll = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      prefetchMode: "lazy",
    });
    const spy = spyStores();
    await seedInstances(spy.stores, ["files/a", "files/b", "files/c"]);
    const ctx = await ctxWith(spy.stores, { files: coll });
    const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;

    const ac = new AbortController();
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const ref of ns.scan({ signal: ac.signal, pageSize: 1 })) {
          seen.push(ref.name);
          ac.abort(); // abort after the first yield
        }
      })(),
    ).rejects.toThrow(/abort/i);
    // WHY: cancellation must stop the traversal at the next yield, not run to
    // completion.
    expect(seen).toEqual(["files/a"]);
  });

  it("count is correct across eager, lazy, and partial modes", async () => {
    for (const mode of ["eager", "lazy", "partial"] as const) {
      const coll = defineResourceCollection({
        scope: "session",
        pattern: "files/**",
        stateSchema: fileSchema,
        prefetchMode: mode,
        ...(mode === "partial" ? { recentLimit: 1 } : {}),
      });
      const spy = spyStores();
      const sessionId = `sess_count_${mode}`;
      await seedInstances(spy.stores, ["files/a", "files/b", "files/c"], sessionId);
      const ctx = await ctxWith(spy.stores, { files: coll }, sessionId);
      const ns = ctx.resources.files as ResourceCollectionRef<{ language: string }>;
      // count unions store keys with cache-only keys, deduped — so all three
      // modes report the true cardinality regardless of what was preloaded.
      expect(await ns.count()).toBe(3);

      // A freshly created (cache-only) instance is counted too.
      await ns.create("d", { language: "ts" });
      expect(await ns.count()).toBe(4);
    }
  });
});

describe("FIX-688 single resource lazy mode", () => {
  it("lazy single resource defers its load until the first state() read", async () => {
    const lazyDoc = defineResource({
      scope: "session",
      stateSchema: z.object({ body: z.string().default("") }),
      prefetchMode: "lazy",
      writable: true,
    });
    const spy = spyStores();
    await spy.stores.resourceState.set("session", "sess_doc", lazyDoc.ref ?? "lazyDoc", { body: "hi" });

    // The accessor name is the storage key here (no explicit ref).
    const flow = makeFlow({ lazyDoc });
    spy.reset();
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_doc",
      sessionId: "sess_doc",
      userId: "user_1",
      stores: spy.stores,
    });

    // No preload of the lazy single resource at startup.
    const startupGets = spy.getKeys.filter((k) => k === "lazyDoc").length;
    expect(startupGets).toBe(0);

    // First read loads it; second read is cached.
    const ref = ctx.resources.lazyDoc as { state: () => Promise<JsonObject> };
    spy.reset();
    expect((await ref.state()).body).toBe("hi");
    expect(spy.getKeys.filter((k) => k === "lazyDoc")).toHaveLength(1);
    spy.reset();
    await ref.state();
    expect(spy.getCount).toBe(0);
  });
});
