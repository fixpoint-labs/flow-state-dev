import { describe, it, expect } from "vitest";
import { createIdempotencyCache } from "../src/idempotency";

describe("createIdempotencyCache", () => {
  it("disables dedupe when ttlMs is 0", () => {
    const cache = createIdempotencyCache(0);
    cache.record("flow", "key");
    expect(cache.seen("flow", "key")).toBe(false);
  });

  it("returns true for keys recorded within the window", () => {
    let now = 1_000_000;
    const cache = createIdempotencyCache(60_000, { now: () => now });
    cache.record("flow", "key");
    expect(cache.seen("flow", "key")).toBe(true);
  });

  it("returns false once the entry expires", () => {
    let now = 1_000_000;
    const cache = createIdempotencyCache(60_000, { now: () => now });
    cache.record("flow", "key");
    now += 60_001;
    expect(cache.seen("flow", "key")).toBe(false);
  });

  it("scopes keys by flowKind", () => {
    const cache = createIdempotencyCache(60_000);
    cache.record("flow-a", "key");
    expect(cache.seen("flow-b", "key")).toBe(false);
  });

  it("evicts the oldest entry when maxEntries is exceeded", () => {
    const cache = createIdempotencyCache(60_000, { maxEntries: 2 });
    cache.record("flow", "k1");
    cache.record("flow", "k2");
    cache.record("flow", "k3");
    expect(cache.seen("flow", "k1")).toBe(false);
    expect(cache.seen("flow", "k2")).toBe(true);
    expect(cache.seen("flow", "k3")).toBe(true);
  });
});
