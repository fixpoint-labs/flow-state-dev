import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ResourceCollectionRef } from "@flow-state-dev/core";
import { canonicalizeToolArgs } from "@flow-state-dev/core";
import {
  cachedCollection,
  createCachedFetchCapability,
  getOrCompute,
  invalidateCached,
  jsonValueSchema,
  type CacheEnvelope,
} from "../src/cached-fetch";

/**
 * In-memory stub collection ref. Stores envelopes by the exact key passed
 * (the helper uses one key consistently for get/upsert), implements
 * prefix-matched list + idempotent delete — enough to exercise the read-through
 * and invalidate paths without a server dependency. Registry-level concerns
 * (real persistence, eviction, pattern-prefix resolution) are covered by the
 * integration scenario.
 */
function stubCollection(seed?: Record<string, CacheEnvelope>) {
  const store = new Map<string, CacheEnvelope>(Object.entries(seed ?? {}));
  const ref = {
    pattern: "cache/**",
    scope: "user" as const,
    async getOptional(key: string) {
      const state = store.get(key);
      return state === undefined ? undefined : ({ path: key, state } as never);
    },
    async upsert(key: string, update: Partial<CacheEnvelope>) {
      const next = { ...(store.get(key) ?? {}), ...update } as CacheEnvelope;
      store.set(key, next);
      return { path: key, state: next } as never;
    },
    async list(prefix?: string) {
      return [...store.entries()]
        .filter(([k]) => prefix === undefined || k.startsWith(prefix))
        .map(([k, state]) => ({ path: k, state } as never));
    },
    async delete(key: string) {
      store.delete(key);
    },
    get: vi.fn(),
    create: vi.fn(),
    getOrCreate: vi.fn(),
    async count() {
      return store.size;
    },
    config: { pattern: "cache/**", stateSchema: {} } as never,
    _store: store,
  };
  return ref as unknown as ResourceCollectionRef<CacheEnvelope> & {
    _store: Map<string, CacheEnvelope>;
  };
}

/** Deferred promise helper for controlling concurrent fetch resolution. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("getOrCompute", () => {
  it("writes an envelope and returns the fetcher value on first call (behavior 1)", async () => {
    const ref = stubCollection();
    const fetcher = vi.fn(async () => ({ price: 1 }));
    const value = await getOrCompute(ref, "k", fetcher, { staleAfter: 1000, now: () => 5000 });

    expect(value).toEqual({ price: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ref._store.get("k")).toEqual({ value: { price: 1 }, storedAt: 5000 });
  });

  it("returns the cached value within staleAfter without fetching (behavior 2)", async () => {
    const ref = stubCollection({ k: { value: "cached", storedAt: 1000 } });
    const fetcher = vi.fn(async () => "fresh");
    const value = await getOrCompute(ref, "k", fetcher, { staleAfter: 1000, now: () => 1500 });

    expect(value).toBe("cached");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refetches and updates storedAt once past staleAfter (behavior 3)", async () => {
    const ref = stubCollection({ k: { value: "old", storedAt: 1000 } });
    const fetcher = vi.fn(async () => "new");
    const value = await getOrCompute(ref, "k", fetcher, { staleAfter: 1000, now: () => 2500 });

    expect(value).toBe("new");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ref._store.get("k")).toEqual({ value: "new", storedAt: 2500 });
  });

  it("parses duration strings for the freshness window (behavior 6)", async () => {
    const ref = stubCollection({ k: { value: "cached", storedAt: 0 } });
    const fetcher = vi.fn(async () => "fresh");
    // "15m" === 900_000ms; at t=800_000 the entry is still fresh.
    const value = await getOrCompute(ref, "k", fetcher, { staleAfter: "15m", now: () => 800_000 });

    expect(value).toBe("cached");
    expect(fetcher).not.toHaveBeenCalled();
  });

  describe("stale-if-error (behavior 4)", () => {
    it("serves any-age stale on failure by default", async () => {
      const ref = stubCollection({ k: { value: "last-good", storedAt: 0 } });
      const fetcher = vi.fn(async () => {
        throw new Error("upstream down");
      });
      const value = await getOrCompute(ref, "k", fetcher, { staleAfter: 1000, now: () => 1_000_000 });

      expect(value).toBe("last-good");
    });

    it("rethrows when staleIfError is false", async () => {
      const ref = stubCollection({ k: { value: "last-good", storedAt: 0 } });
      const fetcher = vi.fn(async () => {
        throw new Error("upstream down");
      });
      await expect(
        getOrCompute(ref, "k", fetcher, { staleAfter: 1000, staleIfError: false, now: () => 2000 }),
      ).rejects.toThrow("upstream down");
    });

    it("rethrows when the stale entry is older than the grace window", async () => {
      const ref = stubCollection({ k: { value: "last-good", storedAt: 0 } });
      const fetcher = vi.fn(async () => {
        throw new Error("upstream down");
      });
      // staleAfter 1000 + grace "1h" (3_600_000) = 3_601_000; age 4_000_000 exceeds it.
      await expect(
        getOrCompute(ref, "k", fetcher, { staleAfter: 1000, staleIfError: "1h", now: () => 4_000_000 }),
      ).rejects.toThrow("upstream down");
    });

    it("serves stale within the grace window", async () => {
      const ref = stubCollection({ k: { value: "last-good", storedAt: 0 } });
      const fetcher = vi.fn(async () => {
        throw new Error("upstream down");
      });
      const value = await getOrCompute(ref, "k", fetcher, {
        staleAfter: 1000,
        staleIfError: "1h",
        now: () => 1_000_000,
      });
      expect(value).toBe("last-good");
    });
  });

  it("rethrows on failure when no cached entry exists (behavior 6/no-entry)", async () => {
    const ref = stubCollection();
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(getOrCompute(ref, "k", fetcher, { staleAfter: 1000 })).rejects.toThrow("boom");
    expect(ref._store.has("k")).toBe(false);
  });

  it("collapses concurrent same-key calls to one fetch (behavior 5/7)", async () => {
    const ref = stubCollection();
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const a = getOrCompute(ref, "k", fetcher, { staleAfter: 1000, now: () => 0 });
    const b = getOrCompute(ref, "k", fetcher, { staleAfter: 1000, now: () => 0 });
    gate.resolve("once");
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe("once");
    expect(rb).toBe("once");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("runs independent fetches for different keys (behavior 8)", async () => {
    const ref = stubCollection();
    const fetcher = vi.fn(async (k: string) => `v-${k}`);
    const [a, b] = await Promise.all([
      getOrCompute(ref, "a", () => fetcher("a"), { staleAfter: 1000 }),
      getOrCompute(ref, "b", () => fetcher("b"), { staleAfter: 1000 }),
    ]);
    expect(a).toBe("v-a");
    expect(b).toBe("v-b");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight entry after a rejection (behavior 5 rejection path)", async () => {
    const ref = stubCollection();
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("first fails");
      return "second ok";
    });

    await expect(getOrCompute(ref, "k", fetcher, { staleAfter: 1000 })).rejects.toThrow("first fails");
    // If the pending entry were not cleared, this would return the rejected promise.
    const value = await getOrCompute(ref, "k", fetcher, { staleAfter: 1000 });
    expect(value).toBe("second ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("always refetches with staleAfter 0, still single-flighted (behavior 12/staleAfter:0)", async () => {
    const ref = stubCollection({ k: { value: "old", storedAt: 0 } });
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const a = getOrCompute(ref, "k", fetcher, { staleAfter: 0, now: () => 100 });
    const b = getOrCompute(ref, "k", fetcher, { staleAfter: 0, now: () => 100 });
    gate.resolve("refetched");
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe("refetched");
    expect(rb).toBe("refetched");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("treats a malformed stored envelope as a miss and overwrites (behavior 9)", async () => {
    // Missing storedAt — schema drift / corruption.
    const ref = stubCollection({ k: { value: "broken" } as unknown as CacheEnvelope });
    const fetcher = vi.fn(async () => "repaired");
    const value = await getOrCompute(ref, "k", fetcher, { staleAfter: 1_000_000, now: () => 50 });

    expect(value).toBe("repaired");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ref._store.get("k")).toEqual({ value: "repaired", storedAt: 50 });
  });

  it("does not serve stale when the fetch succeeds but the write fails", async () => {
    // A stale entry exists and staleIfError is the permissive default — but the
    // fetcher SUCCEEDS, so the (failing) persistence must not fall back to stale.
    const ref = stubCollection({ k: { value: "stale", storedAt: 0 } });
    ref.upsert = (async () => {
      throw new Error("store write failed");
    }) as never;
    const fetcher = vi.fn(async () => "fresh");

    await expect(
      getOrCompute(ref, "k", fetcher, { staleAfter: 1000, staleIfError: true, now: () => 1_000_000 }),
    ).rejects.toThrow("store write failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateCached", () => {
  it("deletes matching instances by prefix and returns the count (behavior 8/invalidate)", async () => {
    const ref = stubCollection({
      "fundamentals/AAPL": { value: 1, storedAt: 0 },
      "fundamentals/MSFT": { value: 2, storedAt: 0 },
      "quotes/AAPL": { value: 3, storedAt: 0 },
    });

    const count = await invalidateCached(ref, "fundamentals/");
    expect(count).toBe(2);
    expect(ref._store.has("fundamentals/AAPL")).toBe(false);
    expect(ref._store.has("fundamentals/MSFT")).toBe(false);
    expect(ref._store.has("quotes/AAPL")).toBe(true);

    // Next read for an invalidated key refetches.
    const fetcher = vi.fn(async () => 42);
    const value = await getOrCompute(ref, "fundamentals/AAPL", fetcher, { staleAfter: 1000, now: () => 1 });
    expect(value).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("cachedCollection (behavior 10)", () => {
  it("wraps the value schema in the envelope and round-trips", () => {
    const collection = cachedCollection({
      pattern: "cache/**",
      scope: "user",
      valueSchema: jsonValueSchema,
    });
    expect(collection.pattern).toBe("cache/**");
    const parsed = collection.stateSchema.parse({ value: { price: 1 }, storedAt: 123 });
    expect(parsed).toEqual({ value: { price: 1 }, storedAt: 123 });
  });

  it("defaults unbounded collections to lazy prefetch and no eviction", () => {
    const collection = cachedCollection({
      pattern: "cache/**",
      scope: "user",
      valueSchema: jsonValueSchema,
    });
    expect(collection.prefetchMode).toBe("lazy");
    expect(collection.eviction).toBe("none");
  });

  it("defaults bounded collections to eager prefetch and lru eviction", () => {
    const collection = cachedCollection({
      pattern: "cache/**",
      scope: "user",
      valueSchema: jsonValueSchema,
      maxInstances: 100,
    });
    expect(collection.prefetchMode).toBe("eager");
    expect(collection.eviction).toBe("lru");
  });

  it("rejects maxInstances with explicit lazy prefetch (behavior 17)", () => {
    expect(() =>
      cachedCollection({
        pattern: "cache/**",
        scope: "user",
        valueSchema: jsonValueSchema,
        maxInstances: 100,
        prefetchMode: "lazy",
      }),
    ).toThrow();
  });

  it("uses a typed value schema when supplied", () => {
    const collection = cachedCollection({
      pattern: "fundamentals/**",
      scope: "user",
      valueSchema: z.object({ pe: z.number().nullable() }),
    });
    expect(() => collection.stateSchema.parse({ value: { pe: 12 }, storedAt: 1 })).not.toThrow();
    expect(() => collection.stateSchema.parse({ value: { pe: "bad" }, storedAt: 1 })).toThrow();
  });
});

describe("createCachedFetchCapability", () => {
  /** Build a mock BlockContext exposing the stub ref under the capability's resource key. */
  function mockCtx(ref: ResourceCollectionRef<CacheEnvelope>, scopeId: string, resourceKey = "cacheStore") {
    return {
      resources: { [resourceKey]: ref },
      session: { identity: { id: scopeId, userId: scopeId, orgId: scopeId } },
    } as never;
  }

  it("declares its collection under a name-derived resource key", () => {
    const cap = createCachedFetchCapability({ name: "cache", staleAfter: 1000 });
    expect(cap.resources?.cacheStore).toBeDefined();
    const custom = createCachedFetchCapability({ name: "marketData", staleAfter: 1000 });
    expect(custom.resources?.marketDataStore).toBeDefined();
  });

  it("getOrFetch keys by tool + canonicalized args (behavior 11)", async () => {
    const cap = createCachedFetchCapability({ name: "cache", staleAfter: 1000 });
    const ref = stubCollection();
    const accessor = cap.fns!(mockCtx(ref, "user-1"));

    const fetcher = vi.fn(async () => ({ ok: true }));
    await accessor.getOrFetch("get_quote", { b: 2, a: 1 }, fetcher, { now: () => 0 });

    const expectedKey = `get_quote/${canonicalizeToolArgs({ b: 2, a: 1 })}`;
    expect(ref._store.has(expectedKey)).toBe(true);

    // Same args in a different order canonicalize to the same key — cache hit.
    const value = await accessor.getOrFetch("get_quote", { a: 1, b: 2 }, fetcher, { now: () => 10 });
    expect(value).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("binds the default staleAfter, overridable per call", async () => {
    const cap = createCachedFetchCapability({ name: "cache", staleAfter: 1000 });
    const ref = stubCollection({ k: { value: "cached", storedAt: 0 } });
    const accessor = cap.fns!(mockCtx(ref, "user-1"));
    const fetcher = vi.fn(async () => "fresh");

    // Bound default (1000) — at t=500 still fresh.
    expect(await accessor.getOrCompute("k", fetcher, { now: () => 500 })).toBe("cached");
    // Per-call override to a tighter window — at t=500 now stale.
    expect(await accessor.getOrCompute("k", fetcher, { staleAfter: 100, now: () => 500 })).toBe("fresh");
  });

  it("shares one fetch across contexts with the same scope id (behavior 12)", async () => {
    const cap = createCachedFetchCapability({ name: "cache", staleAfter: 1000, processDedup: true });
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    // Two distinct contexts (distinct refs) but the same scope id.
    const accessorA = cap.fns!(mockCtx(stubCollection(), "tenant-1"));
    const accessorB = cap.fns!(mockCtx(stubCollection(), "tenant-1"));

    const a = accessorA.getOrCompute("k", fetcher, { now: () => 0 });
    const b = accessorB.getOrCompute("k", fetcher, { now: () => 0 });
    gate.resolve("shared");
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not share fetches across different scope ids (behavior 12)", async () => {
    const cap = createCachedFetchCapability({ name: "cache", staleAfter: 1000, processDedup: true });
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const accessorA = cap.fns!(mockCtx(stubCollection(), "tenant-1"));
    const accessorB = cap.fns!(mockCtx(stubCollection(), "tenant-2"));

    const a = accessorA.getOrCompute("k", fetcher, { now: () => 0 });
    const b = accessorB.getOrCompute("k", fetcher, { now: () => 0 });
    gate.resolve("each");
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not dedup across identity-less callers (no cross-tenant leak)", async () => {
    const cap = createCachedFetchCapability({ name: "cache", scope: "user", staleAfter: 1000, processDedup: true });
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    // User scope, but neither context carries a userId — scope id is unresolved,
    // so process dedup must be skipped rather than collapsing both onto one key.
    const ctxNoIdentity = (ref: ResourceCollectionRef<CacheEnvelope>) =>
      ({ resources: { cacheStore: ref }, session: { identity: { id: "session-x" } } } as never);
    const accessorA = cap.fns!(ctxNoIdentity(stubCollection()));
    const accessorB = cap.fns!(ctxNoIdentity(stubCollection()));

    const a = accessorA.getOrCompute("k", fetcher, { now: () => 0 });
    const b = accessorB.getOrCompute("k", fetcher, { now: () => 0 });
    gate.resolve("isolated");
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
