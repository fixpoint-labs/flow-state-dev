/**
 * Unit tests for the per-request background work pool. The pool replaces the
 * legacy per-sequencer auto-await: sibling sequencers no longer block each
 * other on background work, and a single drain at the request boundary
 * preserves SSE-stream lifetime semantics.
 */
import { describe, expect, it } from "vitest";
import { createRequestWorkPool } from "../src/execution/request-work-pool";

const meta = (scopeId: string, name = scopeId) => ({ name, scopeId });

describe("RequestWorkPool", () => {
  it("addTask + drainAll resolves with completed task results", async () => {
    const pool = createRequestWorkPool();
    pool.addTask({ promise: Promise.resolve(1), meta: meta("scope-a", "task-1") });
    pool.addTask({ promise: Promise.resolve(2), meta: meta("scope-a", "task-2") });

    const result = await pool.drainAll();
    expect(result.completed.map((c) => c.value).sort()).toEqual([1, 2]);
    expect(result.failed).toHaveLength(0);
    expect(pool.pendingCount()).toBe(0);
  });

  it("drainScope returns only matching scope's tasks and removes them from the pool", async () => {
    const pool = createRequestWorkPool();
    pool.addTask({ promise: Promise.resolve("a1"), meta: meta("scope-a", "a1") });
    pool.addTask({ promise: Promise.resolve("b1"), meta: meta("scope-b", "b1") });

    const scopeA = await pool.drainScope("scope-a");
    expect(scopeA.completed.map((c) => c.value)).toEqual(["a1"]);
    expect(pool.hasPendingForScope("scope-a")).toBe(false);

    const all = await pool.drainAll();
    expect(all.completed.map((c) => c.value)).toEqual(["b1"]);
  });

  it("calling drainScope twice on the same scope returns empty the second time", async () => {
    const pool = createRequestWorkPool();
    pool.addTask({ promise: Promise.resolve("ok"), meta: meta("scope-a") });
    await pool.drainScope("scope-a");
    const second = await pool.drainScope("scope-a");
    expect(second.completed).toHaveLength(0);
    expect(second.failed).toHaveLength(0);
  });

  it("reports rejected tasks via failed[]", async () => {
    const pool = createRequestWorkPool();
    const err = new Error("boom");
    pool.addTask({ promise: Promise.reject(err), meta: meta("s", "broken") });

    const result = await pool.drainAll();
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toBe(err);
    expect(result.failed[0]!.meta.name).toBe("broken");
  });

  it("drainScope with failOnError throws the first failure", async () => {
    const pool = createRequestWorkPool();
    pool.addTask({ promise: Promise.reject(new Error("first")), meta: meta("s", "a") });
    pool.addTask({ promise: Promise.resolve(1), meta: meta("s", "b") });

    await expect(pool.drainScope("s", { failOnError: true })).rejects.toThrow("first");
  });

  it("drainAll's onPendingChange callback receives count snapshots until drain", async () => {
    const pool = createRequestWorkPool();

    let resolveA: (v: unknown) => void = () => {};
    let resolveB: (v: unknown) => void = () => {};
    pool.addTask({ promise: new Promise((r) => { resolveA = r; }), meta: meta("s", "a") });
    pool.addTask({ promise: new Promise((r) => { resolveB = r; }), meta: meta("s", "b") });

    const counts: number[] = [];
    const drainPromise = pool.drainAll({ onPendingChange: (n) => counts.push(n) });
    // Initial snapshot.
    expect(counts[0]).toBe(2);

    resolveA(undefined);
    await new Promise<void>((r) => queueMicrotask(r));
    expect(counts[counts.length - 1]).toBe(1);

    resolveB(undefined);
    await drainPromise;
    expect(counts[counts.length - 1]).toBe(0);
  });

  it("failed tasks preserve dispatcher name in meta — diagnostic provenance", async () => {
    const pool = createRequestWorkPool();
    pool.addTask({
      promise: Promise.reject(new Error("worker boom")),
      meta: { name: "memory-consolidate", scopeId: "scope-mem" }
    });
    pool.addTask({
      promise: Promise.reject(new Error("audit boom")),
      meta: { name: "bias-audit", scopeId: "scope-audit" }
    });

    const result = await pool.drainAll();
    expect(result.failed.map((f) => f.meta.name).sort()).toEqual([
      "bias-audit",
      "memory-consolidate"
    ]);
  });

  it("hasPendingForScope is false after the scope's tasks settle", async () => {
    const pool = createRequestWorkPool();
    pool.addTask({ promise: Promise.resolve(0), meta: meta("scope-x") });
    await new Promise<void>((r) => queueMicrotask(r));
    // Settled but not yet drained — pool still tracks the entry until drainScope
    // or drainAll removes it. hasPendingForScope returns false because the
    // entry's `settled` flag is true.
    expect(pool.hasPendingForScope("scope-x")).toBe(false);
  });

  it("drainAll honors AbortSignal — short-circuits without waiting", async () => {
    const pool = createRequestWorkPool();
    // A task that never settles.
    pool.addTask({
      promise: new Promise<unknown>(() => {
        /* never resolves */
      }),
      meta: meta("s", "stuck")
    });

    const ac = new AbortController();
    const drainPromise = pool.drainAll({ signal: ac.signal });
    ac.abort();
    const result = await drainPromise;
    expect(result.failed).toHaveLength(1);
    expect(result.completed).toHaveLength(0);
  });
});
