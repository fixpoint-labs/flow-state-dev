import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBindingCache } from "../createBindingCache";
import type { BindingProvider } from "../../types/binding";

type FakeBinding = { id: string; disposed?: boolean };

function createFakeProvider(): BindingProvider<FakeBinding> & {
  created: Map<string, FakeBinding>;
  released: string[];
} {
  const created = new Map<string, FakeBinding>();
  const released: string[] = [];
  return {
    created,
    released,
    async resolve(key: string) {
      const binding: FakeBinding = { id: key };
      created.set(key, binding);
      return binding;
    },
    async release(key: string) {
      released.push(key);
    },
  };
}

describe("createBindingCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a binding on cache miss", async () => {
    const provider = createFakeProvider();
    const cache = createBindingCache({ provider, maxSize: 10, ttlMs: 60_000 });

    const binding = await cache.resolve("a");
    expect(binding.id).toBe("a");
    expect(cache.size).toBe(1);
  });

  it("returns cached binding on cache hit", async () => {
    const provider = createFakeProvider();
    const cache = createBindingCache({ provider, maxSize: 10, ttlMs: 60_000 });

    const h1 = await cache.resolve("a");
    const h2 = await cache.resolve("a");
    expect(h1).toBe(h2);
    // Provider should only have been called once
    expect(provider.created.size).toBe(1);
  });

  it("evicts LRU entry when at max capacity", async () => {
    const evicted: string[] = [];
    const provider = createFakeProvider();
    const cache = createBindingCache({
      provider,
      maxSize: 2,
      ttlMs: 60_000,
      onEvict: (key) => evicted.push(key),
    });

    await cache.resolve("a");
    await cache.resolve("b");
    expect(cache.size).toBe(2);

    // Access "a" to make it more recent than "b"
    await cache.resolve("a");

    // Adding "c" should evict "b" (least recently accessed)
    await cache.resolve("c");
    expect(cache.size).toBe(2);
    expect(evicted).toEqual(["b"]);
  });

  it("evicts entry after TTL expires", async () => {
    const evicted: string[] = [];
    const provider = createFakeProvider();
    const cache = createBindingCache({
      provider,
      maxSize: 10,
      ttlMs: 5_000,
      onEvict: (key) => evicted.push(key),
    });

    await cache.resolve("a");
    expect(cache.size).toBe(1);

    vi.advanceTimersByTime(5_001);
    expect(cache.size).toBe(0);
    expect(evicted).toEqual(["a"]);
  });

  it("refreshes TTL on cache hit", async () => {
    const evicted: string[] = [];
    const provider = createFakeProvider();
    const cache = createBindingCache({
      provider,
      maxSize: 10,
      ttlMs: 5_000,
      onEvict: (key) => evicted.push(key),
    });

    await cache.resolve("a");

    // Access at 3s — should reset the 5s TTL
    vi.advanceTimersByTime(3_000);
    await cache.resolve("a");

    // At 7s total (4s after refresh) — should still be alive
    vi.advanceTimersByTime(4_000);
    expect(cache.size).toBe(1);

    // At 8.1s total (5.1s after refresh) — should be evicted
    vi.advanceTimersByTime(1_100);
    expect(cache.size).toBe(0);
    expect(evicted).toEqual(["a"]);
  });

  it("release() removes entry and calls provider.release()", async () => {
    const evicted: string[] = [];
    const provider = createFakeProvider();
    const cache = createBindingCache({
      provider,
      maxSize: 10,
      ttlMs: 60_000,
      onEvict: (key) => evicted.push(key),
    });

    await cache.resolve("a");
    await cache.release("a");

    expect(cache.size).toBe(0);
    expect(evicted).toEqual(["a"]);
    expect(provider.released).toEqual(["a"]);
  });

  it("release() is a no-op for unknown keys", async () => {
    const provider = createFakeProvider();
    const cache = createBindingCache({ provider, maxSize: 10, ttlMs: 60_000 });

    // Should not throw
    await cache.release("nonexistent");
    expect(provider.released).toEqual(["nonexistent"]);
  });

  it("disposeAll() clears all entries and calls onEvict for each", async () => {
    const evicted: string[] = [];
    const provider = createFakeProvider();
    const cache = createBindingCache({
      provider,
      maxSize: 10,
      ttlMs: 60_000,
      onEvict: (key) => evicted.push(key),
    });

    await cache.resolve("a");
    await cache.resolve("b");
    await cache.resolve("c");

    cache.disposeAll();
    expect(cache.size).toBe(0);
    expect(evicted.sort()).toEqual(["a", "b", "c"]);
  });

  it("deduplicates concurrent resolve calls for the same key", async () => {
    let resolveCount = 0;
    const provider: BindingProvider<FakeBinding> = {
      async resolve(key: string) {
        resolveCount++;
        // Simulate async work
        await new Promise((r) => setTimeout(r, 100));
        return { id: key };
      },
    };

    const cache = createBindingCache({ provider, maxSize: 10, ttlMs: 60_000 });

    // Launch two concurrent resolves for the same key
    const promise = Promise.all([
      cache.resolve("a"),
      cache.resolve("a"),
    ]);

    // Advance timers to let the provider's setTimeout resolve
    vi.advanceTimersByTime(200);

    const [h1, h2] = await promise;

    expect(h1).toBe(h2);
    expect(resolveCount).toBe(1);
  });

  it("does not deduplicate resolve calls for different keys", async () => {
    let resolveCount = 0;
    const provider: BindingProvider<FakeBinding> = {
      async resolve(key: string) {
        resolveCount++;
        await new Promise((r) => setTimeout(r, 100));
        return { id: key };
      },
    };

    const cache = createBindingCache({ provider, maxSize: 10, ttlMs: 60_000 });

    const promise = Promise.all([
      cache.resolve("a"),
      cache.resolve("b"),
    ]);

    vi.advanceTimersByTime(200);

    const [h1, h2] = await promise;

    expect(h1.id).toBe("a");
    expect(h2.id).toBe("b");
    expect(resolveCount).toBe(2);
  });

  it("handles provider.resolve() failure gracefully", async () => {
    const provider: BindingProvider<FakeBinding> = {
      async resolve() {
        throw new Error("SDK connection failed");
      },
    };

    const cache = createBindingCache({ provider, maxSize: 10, ttlMs: 60_000 });

    await expect(cache.resolve("a")).rejects.toThrow("SDK connection failed");
    expect(cache.size).toBe(0);

    // A subsequent call should retry (not return a cached rejection)
    await expect(cache.resolve("a")).rejects.toThrow("SDK connection failed");
  });

  it("uses default maxSize and ttlMs when not specified", async () => {
    const provider = createFakeProvider();
    const cache = createBindingCache({ provider });

    const binding = await cache.resolve("a");
    expect(binding.id).toBe("a");
    expect(cache.size).toBe(1);
  });
});
