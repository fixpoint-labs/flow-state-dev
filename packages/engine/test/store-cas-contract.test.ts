/**
 * Store CAS contract tests (FIX-400).
 *
 * Validates the `Store.set(id, value, expectedVersion)` contract against both
 * in-memory and filesystem adapters. The SQLite and Postgres adapters get
 * equivalent coverage in their own packages.
 *
 * Covers:
 *   - happy-path single writer
 *   - single-process conflict (two concurrent writers, one wins + one retries)
 *   - cross-registry conflict (two StoreRegistry instances sharing a backing
 *     store — simulates two nodes)
 *   - "any" unconditional write
 *   - retry exhaustion → ConcurrentModificationError
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConcurrentModificationError,
  createFilesystemSessionStore,
  createInMemorySessionStore,
  runWithCAS,
  createStateContainer,
  type SessionRecord,
  type SessionStore
} from "../src";
import type { CASPersist } from "../src/stores/cas";

function makeSession(id: string, version: number, state: Record<string, unknown> = {}): SessionRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "flow-a",
    userId: "user_1",
    state,
    version,
    createdAt: ts,
    updatedAt: ts,
    journal: []
  };
}

function makePersist(store: SessionStore, id: string, baseRecord: SessionRecord): CASPersist<Record<string, unknown>> {
  return async (state, expectedVersion) => {
    const nextVersion = expectedVersion + 1;
    const nextRecord: SessionRecord = {
      ...baseRecord,
      state,
      version: nextVersion,
      updatedAt: Date.now()
    };
    const result = await store.set(id, nextRecord, expectedVersion);
    if (result.ok) {
      return { ok: true, version: result.version };
    }
    const current = result.conflict.currentValue;
    return {
      ok: false,
      currentState: current?.state,
      currentVersion: result.conflict.currentVersion
    };
  };
}

describe.each([
  {
    name: "in-memory",
    createStore: () => createInMemorySessionStore(),
    cleanup: async () => {}
  }
])("Store CAS contract — $name", ({ createStore }) => {
  it("happy path: single writer bumps version from 0 → 1", async () => {
    const store = createStore();
    const record = makeSession("s1", 0);

    const created = await store.set("s1", record, 0);
    expect(created).toEqual({ ok: true, version: 0 });

    const updated = { ...record, version: 1, state: { count: 1 } };
    const next = await store.set("s1", updated, 0);
    expect(next).toEqual({ ok: true, version: 1 });

    const fetched = await store.get("s1");
    expect(fetched?.version).toBe(1);
    expect(fetched?.state).toEqual({ count: 1 });
  });

  it('"any" writes unconditionally over the stored record', async () => {
    const store = createStore();
    await store.set("s2", makeSession("s2", 0), "any");
    await store.set("s2", makeSession("s2", 7, { overwrite: true }), "any");

    const fetched = await store.get("s2");
    expect(fetched?.version).toBe(7);
    expect(fetched?.state).toEqual({ overwrite: true });
  });

  it("reports conflict with current value/version on version mismatch", async () => {
    const store = createStore();
    // Seed version 1.
    await store.set("s3", makeSession("s3", 0), 0);
    await store.set("s3", { ...makeSession("s3", 1), state: { v: 1 } }, 0);

    // Stale write at expectedVersion=0 must fail with conflict pointing to
    // the current stored state.
    const stale = await store.set("s3", { ...makeSession("s3", 2), state: { stale: true } }, 0);
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("unreachable");
    expect(stale.conflict.currentVersion).toBe(1);
    expect(stale.conflict.currentValue?.state).toEqual({ v: 1 });

    // Store must not have been overwritten.
    const fetched = await store.get("s3");
    expect(fetched?.version).toBe(1);
    expect(fetched?.state).toEqual({ v: 1 });
  });

  it("conflict surfaces when expectedVersion exceeds a missing record's version", async () => {
    const store = createStore();
    // Record doesn't exist yet; attempt update at v=5 → conflict (currentVersion=0).
    const missing = await store.set("s4", makeSession("s4", 6), 5);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.conflict.currentVersion).toBe(0);
    expect(missing.conflict.currentValue).toBeUndefined();

    // And the record must not have been written.
    expect(await store.get("s4")).toBeUndefined();
  });

  it("retry loop resolves single-process concurrent writers — one wins, the other retries", async () => {
    const store = createStore();
    const base = makeSession("s5", 0);
    await store.set("s5", base, "any");

    type State = { count: number };
    const container = createStateContainer<State>({ count: 0 }, 0);
    const persist = makePersist(store, "s5", base);

    // First writer completes normally.
    await runWithCAS({
      container,
      mutator: async (state) => ({ count: state.count + 1 }),
      persist,
      options: { maxRetries: 5, baseDelayMs: 0 }
    });

    // Second writer uses a stale container (still thinks version is 0). Its
    // first persist will conflict, the loop refreshes from the store, and
    // the retry succeeds.
    const staleContainer = createStateContainer<State>({ count: 0 }, 0);
    const result = await runWithCAS({
      container: staleContainer,
      mutator: async (state) => ({ count: state.count + 10 }),
      persist,
      options: { maxRetries: 5, baseDelayMs: 0 }
    });

    expect(result).toEqual({ state: { count: 11 }, committed: true });
    const fetched = await store.get("s5");
    expect(fetched?.version).toBe(2);
    expect(fetched?.state).toEqual({ count: 11 });
  });

  it("cross-registry conflict: two registries sharing a backing store detect the race", async () => {
    // Share a single underlying store across two "registries" (simulates two
    // nodes). Each has its own container cache. The writer with the stale
    // cache conflicts and refreshes.
    const store = createStore();
    const base = makeSession("s6", 0);
    await store.set("s6", base, "any");

    type State = { count: number };
    const persist = makePersist(store, "s6", base);

    // Node A writes first.
    const containerA = createStateContainer<State>({ count: 0 }, 0);
    await runWithCAS({
      container: containerA,
      mutator: async () => ({ count: 42 }),
      persist,
      options: { maxRetries: 5, baseDelayMs: 0 }
    });

    // Node B's cache is stale (version 0). Its first persist will conflict.
    const containerB = createStateContainer<State>({ count: 0 }, 0);
    let conflictSeen = false;
    const persistWithProbe: CASPersist<State> = async (state, expectedVersion) => {
      const result = await persist(state, expectedVersion);
      if (!result.ok) conflictSeen = true;
      return result;
    };

    const resultB = await runWithCAS({
      container: containerB,
      mutator: async (state) => ({ count: state.count + 100 }),
      persist: persistWithProbe,
      options: { maxRetries: 5, baseDelayMs: 0 }
    });

    expect(conflictSeen).toBe(true);
    // After B observes A's write (count=42), its mutator runs again and
    // yields count=142.
    expect(resultB).toEqual({ state: { count: 142 }, committed: true });
    const fetched = await store.get("s6");
    expect(fetched?.version).toBe(2);
    expect(fetched?.state).toEqual({ count: 142 });
  });

  it("retry exhaustion throws ConcurrentModificationError", async () => {
    const store = createStore();
    const base = makeSession("s7", 0);
    await store.set("s7", base, "any");

    // Always-conflicting persist: pretends the store just moved forward.
    const alwaysConflict: CASPersist<{ count: number }> = async () => ({
      ok: false,
      currentState: { count: 0 },
      currentVersion: 999
    });

    const container = createStateContainer<{ count: number }>({ count: 0 }, 0);
    await expect(
      runWithCAS({
        container,
        mutator: async (state) => ({ count: state.count + 1 }),
        persist: alwaysConflict,
        options: { maxRetries: 2, baseDelayMs: 0 }
      })
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });
});

describe("Store CAS contract — filesystem adapter", () => {
  it("enforces CAS across a shared directory (two-registry simulation)", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-cas-"));
    try {
      // Two separate SessionStore instances pointing at the same directory.
      const storeA = createFilesystemSessionStore({ rootDir });
      const storeB = createFilesystemSessionStore({ rootDir });

      const base = makeSession("s1", 0);
      const created = await storeA.set("s1", base, "any");
      expect(created.ok).toBe(true);

      // B reads, sees version 0, writes version 1.
      const bRead = await storeB.get("s1");
      expect(bRead?.version).toBe(0);
      const bWrite = await storeB.set(
        "s1",
        { ...base, version: 1, state: { from: "B" } },
        0
      );
      expect(bWrite.ok).toBe(true);

      // A read before B's write — attempts to write with stale expectedVersion=0
      const aWrite = await storeA.set(
        "s1",
        { ...base, version: 1, state: { from: "A" } },
        0
      );
      expect(aWrite.ok).toBe(false);
      if (aWrite.ok) throw new Error("unreachable");
      expect(aWrite.conflict.currentVersion).toBe(1);
      expect(aWrite.conflict.currentValue?.state).toEqual({ from: "B" });

      // A retries with the correct expectedVersion=1.
      const aRetry = await storeA.set(
        "s1",
        { ...base, version: 2, state: { from: "A-retry" } },
        1
      );
      expect(aRetry).toEqual({ ok: true, version: 2 });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
