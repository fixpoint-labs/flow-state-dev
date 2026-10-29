/**
 * Shared conformance for `WakeStore` backends (FIX-2078 D1). Every adapter
 * (memory, filesystem, SQLite, Postgres) runs it via `@flow-state-dev/engine/testing`.
 *
 * A wake is how a debt survives a crash: written before the write that owes,
 * fired by the sweeper until a pass clears it. The cases pin the properties
 * that make that true:
 *
 * - one wake per (tenant, session, entry): a second write coalesces, keeping
 *   the earlier due time and the later `landBy`;
 * - every write bumps the version, and a move or a clear is conditional on the
 *   version the pass read, so a wake written during a pass survives it;
 * - `listDue` and `earliestDueAt` read every due wake, across tenants and
 *   sessions, earliest first.
 */
import { describe, expect, it } from "vitest";
import type { WakeInput, WakeStore } from "../types";

export type CreateWakeStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLite"`. */
  name: string;
  /** Build a fresh, empty wake store. Called per test. */
  createStore: () => WakeStore | Promise<WakeStore>;
  /** Optional teardown hook for backends with external resources. */
  cleanup?: (store: WakeStore) => Promise<void> | void;
};

function wake(overrides: Partial<WakeInput> = {}): WakeInput {
  return {
    sessionId: "s1",
    entry: "dispatch",
    flowKind: "desk",
    userId: "u1",
    orgId: "o1",
    dueAt: 10_000,
    landBy: 20_000,
    ...overrides
  };
}

/**
 * Register the wake-store conformance cases against a backend. Call inside a
 * test file's top-level scope.
 */
export function createWakeStoreConformanceTests(options: CreateWakeStoreConformanceTestsOptions): void {
  const { name, createStore, cleanup } = options;

  async function withStore(fn: (store: WakeStore) => Promise<void>): Promise<void> {
    const store = await createStore();
    try {
      await fn(store);
    } finally {
      if (cleanup !== undefined) await cleanup(store);
    }
  }

  describe(`${name} (wake store conformance)`, () => {
    it("keeps what it was owed under its key, with its owner", async () => {
      await withStore(async (store) => {
        const written = await store.owe(wake());
        const read = await store.get({ sessionId: "s1", entry: "dispatch" });
        expect(read).toMatchObject({
          sessionId: "s1",
          entry: "dispatch",
          flowKind: "desk",
          userId: "u1",
          orgId: "o1",
          dueAt: 10_000,
          landBy: 20_000,
          version: written.version
        });
        expect(await store.get({ sessionId: "s1", entry: "other" })).toBeNull();
      });
    });

    it("a second write coalesces: the earlier due time, the later landBy, a new version", async () => {
      await withStore(async (store) => {
        const first = await store.owe(wake({ dueAt: 10_000, landBy: 20_000 }));
        const later = await store.owe(wake({ dueAt: 50_000, landBy: 15_000 }));
        expect(later.dueAt).toBe(10_000);
        expect(later.landBy).toBe(20_000);
        expect(later.version).toBeGreaterThan(first.version);
        const sooner = await store.owe(wake({ dueAt: 5_000, landBy: 30_000 }));
        expect(sooner.dueAt).toBe(5_000);
        expect(sooner.landBy).toBe(30_000);
        expect(await store.get({ sessionId: "s1", entry: "dispatch" })).toMatchObject({ dueAt: 5_000, landBy: 30_000 });
      });
    });

    it("tenants, sessions and entries are separate wakes", async () => {
      await withStore(async (store) => {
        await store.owe(wake({ dueAt: 1 }));
        await store.owe(wake({ tenantId: "t2", dueAt: 2 }));
        await store.owe(wake({ sessionId: "s2", dueAt: 3 }));
        await store.owe(wake({ entry: "onTaskSettled", dueAt: 4 }));
        expect((await store.get({ sessionId: "s1", entry: "dispatch" }))?.dueAt).toBe(1);
        expect((await store.get({ tenantId: "t2", sessionId: "s1", entry: "dispatch" }))?.dueAt).toBe(2);
        expect((await store.get({ sessionId: "s2", entry: "dispatch" }))?.dueAt).toBe(3);
        expect((await store.get({ sessionId: "s1", entry: "onTaskSettled" }))?.dueAt).toBe(4);
        expect(await store.listDue(10, 100)).toHaveLength(4);
      });
    });

    it("a move or a clear at a stale version changes nothing", async () => {
      await withStore(async (store) => {
        const read = await store.owe(wake({ dueAt: 10_000 }));
        // A debt written during the pass.
        const during = await store.owe(wake({ dueAt: 12_000 }));
        expect(await store.clear({ sessionId: "s1", entry: "dispatch" }, read.version)).toBe(false);
        expect(await store.move({ sessionId: "s1", entry: "dispatch" }, read.version, 99_000)).toBe(false);
        expect(await store.get({ sessionId: "s1", entry: "dispatch" })).toMatchObject({ dueAt: 10_000, version: during.version });
      });
    });

    it("a move at the version read moves the due time, either way, and keeps the version", async () => {
      await withStore(async (store) => {
        const read = await store.owe(wake({ dueAt: 10_000 }));
        expect(await store.move({ sessionId: "s1", entry: "dispatch" }, read.version, 40_000)).toBe(true);
        expect(await store.get({ sessionId: "s1", entry: "dispatch" })).toMatchObject({ dueAt: 40_000, version: read.version });
        expect(await store.move({ sessionId: "s1", entry: "dispatch" }, read.version, 3_000)).toBe(true);
        expect((await store.get({ sessionId: "s1", entry: "dispatch" }))?.dueAt).toBe(3_000);
      });
    });

    it("a clear at the version read deletes the wake; a missing wake clears nothing", async () => {
      await withStore(async (store) => {
        const read = await store.owe(wake());
        expect(await store.clear({ sessionId: "s1", entry: "dispatch" }, read.version)).toBe(true);
        expect(await store.get({ sessionId: "s1", entry: "dispatch" })).toBeNull();
        expect(await store.clear({ sessionId: "s1", entry: "dispatch" }, read.version)).toBe(false);
        expect(await store.move({ sessionId: "s1", entry: "dispatch" }, read.version, 1)).toBe(false);
        // A wake written again after a clear starts over.
        const again = await store.owe(wake({ dueAt: 7 }));
        expect(again.dueAt).toBe(7);
      });
    });

    it("listDue returns what is due, earliest first, bounded by limit; earliestDueAt reads the soonest", async () => {
      await withStore(async (store) => {
        expect(await store.earliestDueAt()).toBeNull();
        await store.owe(wake({ sessionId: "late", dueAt: 300 }));
        await store.owe(wake({ sessionId: "early", dueAt: 100 }));
        await store.owe(wake({ sessionId: "mid", dueAt: 200 }));
        await store.owe(wake({ sessionId: "future", dueAt: 9_000 }));
        expect(await store.earliestDueAt()).toBe(100);
        const due = await store.listDue(300, 100);
        expect(due.map((w) => w.sessionId)).toEqual(["early", "mid", "late"]);
        expect((await store.listDue(300, 2)).map((w) => w.sessionId)).toEqual(["early", "mid"]);
        expect(await store.listDue(50, 100)).toEqual([]);
      });
    });

    it("concurrent writes to one key leave one wake at the earliest due time", async () => {
      await withStore(async (store) => {
        await Promise.all([500, 100, 300, 200, 400].map((dueAt) => store.owe(wake({ dueAt }))));
        const due = await store.listDue(1_000, 100);
        expect(due).toHaveLength(1);
        expect(due[0]!.dueAt).toBe(100);
      });
    });
  });
}
