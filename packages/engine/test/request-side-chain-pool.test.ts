/**
 * Unit tests for the per-request background work pool. The pool replaces the
 * legacy per-sequencer auto-await: sibling sequencers no longer block each
 * other on background work, and a single drain at the request boundary
 * preserves SSE-stream lifetime semantics.
 */
import { describe, expect, it } from "vitest";
import { createRequestSideChainPool } from "../src/execution/request-side-chain-pool";

const meta = (scopeId: string, name = scopeId) => ({ name, scopeId });

describe("RequestSideChainPool", () => {
  it("addTask + drainAll resolves with completed task results", async () => {
    const pool = createRequestSideChainPool();
    pool.addTask({ promise: Promise.resolve(1), meta: meta("scope-a", "task-1") });
    pool.addTask({ promise: Promise.resolve(2), meta: meta("scope-a", "task-2") });

    const result = await pool.drainAll();
    expect(result.completed.map((c) => c.value).sort()).toEqual([1, 2]);
    expect(result.failed).toHaveLength(0);
    expect(pool.pendingCount()).toBe(0);
  });

  it("drainScope returns only matching scope's tasks and removes them from the pool", async () => {
    const pool = createRequestSideChainPool();
    pool.addTask({ promise: Promise.resolve("a1"), meta: meta("scope-a", "a1") });
    pool.addTask({ promise: Promise.resolve("b1"), meta: meta("scope-b", "b1") });

    const scopeA = await pool.drainScope("scope-a");
    expect(scopeA.completed.map((c) => c.value)).toEqual(["a1"]);
    expect(pool.hasPendingForScope("scope-a")).toBe(false);

    const all = await pool.drainAll();
    expect(all.completed.map((c) => c.value)).toEqual(["b1"]);
  });

  it("calling drainScope twice on the same scope returns empty the second time", async () => {
    const pool = createRequestSideChainPool();
    pool.addTask({ promise: Promise.resolve("ok"), meta: meta("scope-a") });
    await pool.drainScope("scope-a");
    const second = await pool.drainScope("scope-a");
    expect(second.completed).toHaveLength(0);
    expect(second.failed).toHaveLength(0);
  });

  it("reports rejected tasks via failed[]", async () => {
    const pool = createRequestSideChainPool();
    const err = new Error("boom");
    pool.addTask({ promise: Promise.reject(err), meta: meta("s", "broken") });

    const result = await pool.drainAll();
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toBe(err);
    expect(result.failed[0]!.meta.name).toBe("broken");
  });

  it("drainScope with failOnError throws the first failure", async () => {
    const pool = createRequestSideChainPool();
    pool.addTask({ promise: Promise.reject(new Error("first")), meta: meta("s", "a") });
    pool.addTask({ promise: Promise.resolve(1), meta: meta("s", "b") });

    await expect(pool.drainScope("s", { failOnError: true })).rejects.toThrow("first");
  });

  it("drainAll's onPendingChange callback receives count snapshots until drain", async () => {
    const pool = createRequestSideChainPool();

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
    const pool = createRequestSideChainPool();
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
    const pool = createRequestSideChainPool();
    pool.addTask({ promise: Promise.resolve(0), meta: meta("scope-x") });
    await new Promise<void>((r) => queueMicrotask(r));
    // Settled but not yet drained — pool still tracks the entry until drainScope
    // or drainAll removes it. hasPendingForScope returns false because the
    // entry's `settled` flag is true.
    expect(pool.hasPendingForScope("scope-x")).toBe(false);
  });

  it("drainScope drains settled-but-undrained entries — failures are not lost", async () => {
    // Regression: a fast-failing .sideChain() task can settle before .waitForSideChain()
    // runs. `hasPendingForScope` returns false in that window, but the entry
    // is still in the pool and its failure must surface through drainScope —
    // otherwise failOnError silently drops fast failures.
    const pool = createRequestSideChainPool();
    const err = new Error("fast failure");
    pool.addTask({ promise: Promise.reject(err), meta: meta("scope-fast", "fast-fail") });

    // Wait for the task to settle.
    await new Promise<void>((r) => queueMicrotask(r));
    expect(pool.hasPendingForScope("scope-fast")).toBe(false);
    expect(pool.pendingCount()).toBe(0);

    // drainScope still surfaces the failure.
    const result = await pool.drainScope("scope-fast");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toBe(err);
  });

  it("drainScope with failOnError throws even when tasks have already settled", async () => {
    // Regression: with the previous `hasPendingForScope` early-return guard,
    // a failed task that settled before .waitForSideChain({ failOnError: true })
    // ran was silently swallowed. drainScope must throw on the captured
    // failure regardless of timing.
    const pool = createRequestSideChainPool();
    pool.addTask({
      promise: Promise.reject(new Error("settled-before-wait")),
      meta: meta("scope-fast", "fast-fail")
    });
    await new Promise<void>((r) => queueMicrotask(r));

    await expect(pool.drainScope("scope-fast", { failOnError: true })).rejects.toThrow(
      "settled-before-wait"
    );
  });

  it("drainAll surfaces settled-but-undrained failures even when pendingCount is 0", async () => {
    // Regression: drainRequestSideChainPool used to early-return on
    // `pool.pendingCount() === 0`, dropping failures from tasks that had
    // already settled. drainAll itself reads the entries array and must
    // still process them.
    const pool = createRequestSideChainPool();
    pool.addTask({
      promise: Promise.reject(new Error("late-drain")),
      meta: meta("scope-drain", "late")
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(pool.pendingCount()).toBe(0);

    const result = await pool.drainAll();
    expect(result.failed).toHaveLength(1);
    expect((result.failed[0]!.reason as Error).message).toBe("late-drain");
  });

  it("drainAll honors AbortSignal — short-circuits without waiting", async () => {
    const pool = createRequestSideChainPool();
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

describe("RequestSideChainPool.drainToQuiescence", () => {
  it("awaits work queued by a task that is itself being drained", async () => {
    // The property `drainAll` alone does not have. A task that calls `.sideChain()`
    // while it is being drained lands in the pool AFTER `drainAll` spliced its
    // snapshot, so one pass returns with that entry unawaited. Reproduced here
    // by having the first task enqueue the second from inside its own promise.
    const pool = createRequestSideChainPool();
    let nestedRan = false;
    let nestedSettled = false;

    const nested = async (): Promise<string> => {
      nestedRan = true;
      await new Promise((r) => setTimeout(r, 10));
      nestedSettled = true;
      return "nested";
    };

    const outer = (async () => {
      await new Promise((r) => setTimeout(r, 0));
      // Queued mid-drain: the snapshot that is awaiting `outer` has already
      // been taken, so only a further pass can observe this.
      pool.addTask({ promise: nested(), meta: meta("scope-n", "nested") });
      return "outer";
    })();

    pool.addTask({ promise: outer, meta: meta("scope-n", "outer") });

    const result = await pool.drainToQuiescence();

    expect(nestedRan).toBe(true);
    // The teeth: quiescence means the nested task has SETTLED, not merely
    // started, by the time this resolves.
    expect(nestedSettled).toBe(true);
    expect(result.completed.map((c) => c.value).sort()).toEqual(["nested", "outer"]);
    expect(pool.pendingCount()).toBe(0);
  });

  it("drains an entry whose task settled before the first pass", async () => {
    // The case a `pendingCount() > 0` guard would skip: nothing is pending,
    // but the entry is still here carrying a failure the caller has not seen.
    const pool = createRequestSideChainPool();
    pool.addTask({
      promise: Promise.reject(new Error("settled-early")),
      meta: meta("scope-s", "early")
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(pool.pendingCount()).toBe(0);

    const result = await pool.drainToQuiescence();
    expect(result.failed).toHaveLength(1);
    expect((result.failed[0]!.reason as Error).message).toBe("settled-early");
  });

  it("is a cheap no-op on an empty pool", async () => {
    const pool = createRequestSideChainPool();
    const result = await pool.drainToQuiescence();
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("reports pending-count changes across every pass", async () => {
    const pool = createRequestSideChainPool();
    const counts: number[] = [];

    const outer = (async () => {
      await new Promise((r) => setTimeout(r, 0));
      pool.addTask({ promise: Promise.resolve("n"), meta: meta("scope-p", "nested") });
      return "o";
    })();
    pool.addTask({ promise: outer, meta: meta("scope-p", "outer") });

    await pool.drainToQuiescence({ onPendingChange: (c) => counts.push(c) });

    // The nested task's arrival is observed, which only happens if the
    // listener is installed on the later pass too.
    expect(counts.length).toBeGreaterThan(1);
  });
});
