/**
 * SQLite adapter compliance with the FIX-405 delta verb contract (FIX-686).
 *
 * Validates `patchField`, `incField`, and `pushToArray` on the SQLite
 * SessionStore. All four record stores share the generic
 * `createSQLiteRecordStore`, so coverage on one transitively applies. The
 * matrix mirrors the Postgres `delta-verbs.test.ts` so a record that
 * round-trips through either adapter behaves identically. Tests assert the
 * *why*: each verb mutates only the targeted state field, keeps `version`
 * and `updatedAt` in lockstep, and honors CAS semantics on stale versions.
 */

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { SessionRecord } from "@flow-state-dev/server";
import { initializeSchema } from "../src/schema";
import { createSQLiteSessionStore } from "../src/session-store";

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

describe("SQLite adapter — delta verb contract (FIX-405)", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  function freshStore() {
    db = new Database(":memory:");
    initializeSchema(db);
    return createSQLiteSessionStore(db);
  }

  async function seed(
    store: ReturnType<typeof createSQLiteSessionStore>,
    id: string,
    state: Record<string, unknown> = {}
  ): Promise<void> {
    await store.set(id, makeSession(id, 0, state), "any");
  }

  describe("patchField", () => {
    it("replaces a single state field and bumps version + updatedAt", async () => {
      const store = freshStore();
      await seed(store, "s1", { count: 0, mode: "idle" });
      const before = await store.get("s1");

      const result = await store.patchField!("s1", ["count"], 5, 0, Date.now());

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.version).toBe(1);
      const after = await store.get("s1");
      expect(after?.state).toEqual({ count: 5, mode: "idle" });
      expect(after?.version).toBe(1);
      expect(after?.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
    });

    it("supports JSON object values", async () => {
      const store = freshStore();
      await seed(store, "s1", {});
      await store.patchField!("s1", ["nested"], { a: 1, b: "x" }, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ nested: { a: 1, b: "x" } });
    });

    it("supports null values", async () => {
      const store = freshStore();
      await seed(store, "s1", { active: true });
      await store.patchField!("s1", ["active"], null, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ active: null });
    });

    it("returns conflict with current value on stale expectedVersion", async () => {
      const store = freshStore();
      await seed(store, "s1", { count: 0 });
      await store.patchField!("s1", ["count"], 1, 0, Date.now()); // v1

      const stale = await store.patchField!("s1", ["count"], 99, 0, Date.now());
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.conflict.currentVersion).toBe(1);
      expect(stale.conflict.currentValue?.state).toEqual({ count: 1 });
    });

    it('"any" applies unconditionally when a record exists', async () => {
      const store = freshStore();
      await seed(store, "s1", { count: 0 });
      await store.patchField!("s1", ["count"], 1, 0, Date.now()); // v1

      const result = await store.patchField!("s1", ["count"], 42, "any", Date.now());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.version).toBe(2);
      expect((await store.get("s1"))?.state).toEqual({ count: 42 });
    });

    it('"any" against a missing record returns conflict', async () => {
      const store = freshStore();
      const result = await store.patchField!("missing", ["x"], 1, "any", Date.now());
      expect(result.ok).toBe(false);
    });

    it("supports depth-2 paths for nested record writes", async () => {
      const store = freshStore();
      await seed(store, "s1", { nested: { x: 1 } });
      const result = await store.patchField!("s1", ["nested", "y"], 2, 0, Date.now());
      expect(result.ok).toBe(true);
      expect((await store.get("s1"))?.state).toEqual({ nested: { x: 1, y: 2 } });
    });

    it("rejects depth > 2 paths", async () => {
      const store = freshStore();
      await seed(store, "s1", {});
      await expect(
        store.patchField!("s1", ["a", "b", "c"], 1, 0, Date.now())
      ).rejects.toThrow();
    });
  });

  describe("incField", () => {
    it("adds delta to an existing numeric field", async () => {
      const store = freshStore();
      await seed(store, "s1", { count: 10 });
      await store.incField!("s1", ["count"], 5, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ count: 15 });
    });

    it("treats a missing field as 0", async () => {
      const store = freshStore();
      await seed(store, "s1", {});
      await store.incField!("s1", ["count"], 3, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ count: 3 });
    });

    it("treats a non-numeric field as 0", async () => {
      const store = freshStore();
      await seed(store, "s1", { count: "not-a-number" });
      await store.incField!("s1", ["count"], 7, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ count: 7 });
    });

    it("supports negative deltas and decimals", async () => {
      const store = freshStore();
      await seed(store, "s1", { balance: 100 });
      await store.incField!("s1", ["balance"], -25.5, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ balance: 74.5 });
    });

    it("N sequential increments converge", async () => {
      const store = freshStore();
      await seed(store, "s1", { count: 0 });
      for (let i = 0; i < 10; i++) {
        await store.incField!("s1", ["count"], 1, i, Date.now());
      }
      const after = await store.get("s1");
      expect(after?.state).toEqual({ count: 10 });
      expect(after?.version).toBe(10);
    });
  });

  describe("pushToArray", () => {
    it("appends to an existing array", async () => {
      const store = freshStore();
      await seed(store, "s1", { items: ["a"] });
      await store.pushToArray!("s1", ["items"], ["b", "c"], 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ items: ["a", "b", "c"] });
    });

    it("treats a missing field as []", async () => {
      const store = freshStore();
      await seed(store, "s1", {});
      await store.pushToArray!("s1", ["log"], ["first"], 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ log: ["first"] });
    });

    it("replaces a non-array field with the pushed values", async () => {
      const store = freshStore();
      await seed(store, "s1", { log: "not-an-array" });
      await store.pushToArray!("s1", ["log"], ["x"], 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ log: ["x"] });
    });

    it("preserves order across multiple pushes", async () => {
      const store = freshStore();
      await seed(store, "s1", {});
      await store.pushToArray!("s1", ["log"], ["a"], 0, Date.now());
      await store.pushToArray!("s1", ["log"], ["b"], 1, Date.now());
      await store.pushToArray!("s1", ["log"], ["c"], 2, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ log: ["a", "b", "c"] });
    });

    it("supports pushing object values", async () => {
      const store = freshStore();
      await seed(store, "s1", { log: [] });
      await store.pushToArray!("s1", ["log"], [{ ts: 1, msg: "hello" }], 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({
        log: [{ ts: 1, msg: "hello" }]
      });
    });
  });

  describe("non-state field preservation", () => {
    it("delta verbs preserve id, createdAt and other top-level fields", async () => {
      const store = freshStore();
      await seed(store, "s1", { count: 0 });
      const before = await store.get("s1");
      expect(before?.flowKind).toBe("flow-a");

      await store.patchField!("s1", ["count"], 1, 0, Date.now());

      const after = await store.get("s1");
      expect(after?.flowKind).toBe("flow-a");
      expect(after?.userId).toBe("user_1");
      expect(after?.id).toBe("s1");
      expect(after?.createdAt).toBe(before?.createdAt);
    });
  });
});
