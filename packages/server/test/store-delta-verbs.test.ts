/**
 * Store delta-verb contract tests (FIX-405).
 *
 * Validates the optional `patchField` / `incField` / `pushToArray` methods
 * against the in-memory adapter. Covers the per-verb happy path, conflict
 * shape on stale `expectedVersion`, `"any"` semantics, baseline handling for
 * missing fields, and version-bump consistency with `set`.
 *
 * The Postgres adapter has equivalent coverage in its own package; SQLite
 * and filesystem are out of v1 scope and continue to advertise no delta
 * methods (createScopePersist feature-detects and falls back to `set`).
 */

import { describe, expect, it } from "vitest";
import {
  createInMemorySessionStore,
  type SessionRecord,
  type SessionStore
} from "../src";

function makeSession(
  id: string,
  version: number,
  state: Record<string, unknown> = {}
): SessionRecord {
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

async function seed(
  store: SessionStore,
  id: string,
  state: Record<string, unknown> = {}
): Promise<SessionRecord> {
  const record = makeSession(id, 0, state);
  await store.set(id, record, "any");
  return record;
}

describe("Store delta verbs — in-memory adapter", () => {
  describe("patchField", () => {
    it("replaces a single state field and bumps version", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 0, mode: "idle" });

      const result = await store.patchField!("s1", ["count"], 5, 0, Date.now());
      expect(result).toEqual({ ok: true, version: 1 });

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 5, mode: "idle" });
      expect(fetched?.version).toBe(1);
    });

    it("adds a new field when not previously present", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { mode: "idle" });

      await store.patchField!("s1", ["count"], 7, 0, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ mode: "idle", count: 7 });
    });

    it("returns conflict with current value on stale expectedVersion", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 0 });
      await store.patchField!("s1", ["count"], 1, 0, Date.now()); // version now 1

      const stale = await store.patchField!("s1", ["count"], 99, 0, Date.now());
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.conflict.currentVersion).toBe(1);
      expect(stale.conflict.currentValue?.state).toEqual({ count: 1 });
    });

    it('"any" applies unconditionally when a record exists', async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 0 });
      await store.patchField!("s1", ["count"], 1, 0, Date.now()); // version 1

      const result = await store.patchField!("s1", ["count"], 42, "any", Date.now());
      expect(result).toEqual({ ok: true, version: 2 });

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 42 });
    });

    it('"any" against a missing record returns conflict (caller falls back to set)', async () => {
      const store = createInMemorySessionStore();
      const result = await store.patchField!("missing", ["x"], 1, "any", Date.now());
      expect(result.ok).toBe(false);
    });
  });

  describe("incField", () => {
    it("adds delta to an existing numeric field", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 10 });

      const result = await store.incField!("s1", ["count"], 5, 0, Date.now());
      expect(result).toEqual({ ok: true, version: 1 });

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 15 });
    });

    it("treats a missing field as 0", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", {});

      await store.incField!("s1", ["count"], 3, 0, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 3 });
    });

    it("supports negative deltas", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 10 });

      await store.incField!("s1", ["count"], -4, 0, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 6 });
    });

    it("N sequential increments converge to N * delta", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 0 });

      for (let i = 0; i < 10; i++) {
        await store.incField!("s1", ["count"], 1, i, Date.now());
      }

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 10 });
      expect(fetched?.version).toBe(10);
    });

    it("returns conflict on stale expectedVersion", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 0 });
      await store.incField!("s1", ["count"], 1, 0, Date.now()); // version 1

      const stale = await store.incField!("s1", ["count"], 1, 0, Date.now());
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.conflict.currentVersion).toBe(1);
    });

    it("does not mutate state on conflict", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 5 });
      await store.incField!("s1", ["count"], 1, 0, Date.now()); // count=6, version=1

      await store.incField!("s1", ["count"], 100, 0, Date.now()); // stale → conflict

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 6 });
    });
  });

  describe("pushToArray", () => {
    it("appends to an existing array", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { items: ["a"] });

      const result = await store.pushToArray!("s1", ["items"], ["b", "c"], 0, Date.now());
      expect(result).toEqual({ ok: true, version: 1 });

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ items: ["a", "b", "c"] });
    });

    it("treats a missing field as []", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", {});

      await store.pushToArray!("s1", ["log"], ["first"], 0, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ log: ["first"] });
    });

    it("preserves order across multiple pushes", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { log: [] });

      await store.pushToArray!("s1", ["log"], ["a"], 0, Date.now());
      await store.pushToArray!("s1", ["log"], ["b"], 1, Date.now());
      await store.pushToArray!("s1", ["log"], ["c"], 2, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ log: ["a", "b", "c"] });
      expect(fetched?.version).toBe(3);
    });

    it("returns conflict on stale expectedVersion", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { log: [] });
      await store.pushToArray!("s1", ["log"], ["a"], 0, Date.now()); // version 1

      const stale = await store.pushToArray!("s1", ["log"], ["b"], 0, Date.now());
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.conflict.currentVersion).toBe(1);
      expect(stale.conflict.currentValue?.state).toEqual({ log: ["a"] });
    });
  });

  describe("isolation between fields", () => {
    it("patchField does not disturb other state fields", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { a: 1, b: 2, c: 3 });

      await store.patchField!("s1", ["b"], 99, 0, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ a: 1, b: 99, c: 3 });
    });

    it("incField on one field does not disturb others", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { count: 5, label: "untouched" });

      await store.incField!("s1", ["count"], 1, 0, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.state).toEqual({ count: 6, label: "untouched" });
    });

    it("delta writes preserve non-state record fields (flowKind, userId, journal)", async () => {
      const store = createInMemorySessionStore();
      const seeded = await seed(store, "s1", { count: 0 });

      await store.patchField!("s1", ["count"], 1, 0, Date.now());

      const fetched = await store.get("s1");
      expect(fetched?.flowKind).toBe(seeded.flowKind);
      expect(fetched?.userId).toBe(seeded.userId);
      expect(fetched?.journal).toEqual([]);
      expect(fetched?.id).toBe("s1");
    });
  });

  describe("depth guard", () => {
    it("rejects depth > 1 paths (v1 only supports depth-1)", async () => {
      const store = createInMemorySessionStore();
      await seed(store, "s1", { nested: { x: 1 } });

      await expect(
        store.patchField!("s1", ["nested", "x"], 2, 0, Date.now())
      ).rejects.toThrow(/depth-1 paths/);
    });
  });
});
