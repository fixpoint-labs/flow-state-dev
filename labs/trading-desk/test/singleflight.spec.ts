/**
 * Tests for the in-flight lease primitive (FIX-801) — the fix for the
 * concurrent-overlapping-fetch budget hole: two overlapping fills for the
 * same key must share one upstream call, and the lease must NOT retain the
 * value afterward (that's what distinguishes it from `cache.ts`'s `getOrFetch`).
 */
import { afterEach, describe, expect, it } from "vitest";
import { _resetLeases, withLease } from "../lib/singleflight";

afterEach(() => {
  _resetLeases();
});

describe("withLease", () => {
  it("collapses two concurrent calls for the same key into one fn() invocation", async () => {
    let calls = 0;
    const fn = () =>
      new Promise<number>((resolve) => {
        calls++;
        setTimeout(() => resolve(42), 10);
      });
    const [a, b] = await Promise.all([withLease("K", fn), withLease("K", fn)]);
    expect(calls).toBe(1);
    expect(a).toBe(42);
    expect(b).toBe(42);
  });

  it("does not collapse calls for different keys", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.resolve(calls);
    };
    const [a, b] = await Promise.all([withLease("K1", fn), withLease("K2", fn)]);
    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });

  it("releases the lease on failure too, so a retry after rejection runs fn() again", async () => {
    let calls = 0;
    const failingThenOk = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("ok");
    };
    await expect(withLease("K", failingThenOk)).rejects.toThrow("boom");
    await expect(withLease("K", failingThenOk)).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retain the value after resolution — a later call for the same key runs fn() again", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.resolve(calls);
    };
    const first = await withLease("K", fn);
    const second = await withLease("K", fn);
    expect(first).toBe(1);
    expect(second).toBe(2); // fresh call, not a cached 1 — no TTL retention
    expect(calls).toBe(2);
  });
});
