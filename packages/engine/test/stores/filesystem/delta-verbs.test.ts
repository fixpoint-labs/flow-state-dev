/**
 * Filesystem adapter delta-verb contract tests (FIX-686, mirrors FIX-405).
 *
 * Validates `patchField` / `incField` / `pushToArray` plus the underlying
 * `casUpdate` primitive on the filesystem SessionStore. The other record
 * stores (request/user/org) share the same generic record store, so coverage
 * transitively applies. Semantics must match the in-memory and Postgres
 * adapters: depth-1 only, version-predicated writes, missing-field baselines,
 * and non-state field preservation. Tests encode that a single-field write
 * leaves the rest of the record untouched — the whole point of the verbs.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesystemSessionStore } from "../../../src/stores/filesystem/session-store";
import type { SessionRecord, SessionStore } from "../../../src/stores/types";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "fsd-delta-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

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
): Promise<void> {
  await store.set(id, makeSession(id, 0, state), "any");
}

describe("Filesystem adapter — delta verbs", () => {
  describe("patchField", () => {
    it("replaces a single state field and bumps version + updatedAt", async () => {
      const store = createFilesystemSessionStore({ rootDir });
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

    it("supports object and null values", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { active: true });
      await store.patchField!("s1", ["nested"], { a: 1 }, 0, Date.now());
      await store.patchField!("s1", ["active"], null, 1, Date.now());

      expect((await store.get("s1"))?.state).toEqual({
        active: null,
        nested: { a: 1 }
      });
    });

    it("returns conflict with current value on stale expectedVersion", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { count: 0 });
      await store.patchField!("s1", ["count"], 1, 0, Date.now()); // v1

      const stale = await store.patchField!("s1", ["count"], 99, 0, Date.now());
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.conflict.currentVersion).toBe(1);
      expect(stale.conflict.currentValue?.state).toEqual({ count: 1 });
    });

    it('"any" applies unconditionally when a record exists', async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { count: 0 });
      await store.patchField!("s1", ["count"], 1, 0, Date.now()); // v1

      const result = await store.patchField!("s1", ["count"], 42, "any", Date.now());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.version).toBe(2);
      expect((await store.get("s1"))?.state).toEqual({ count: 42 });
    });

    it('"any" against a missing record returns conflict', async () => {
      const store = createFilesystemSessionStore({ rootDir });
      const result = await store.patchField!("missing", ["x"], 1, "any", Date.now());
      expect(result.ok).toBe(false);
    });

    it("supports depth-2 paths for nested record writes", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { status: { a: "ok" } });
      const result = await store.patchField!("s1", ["status", "b"], "done", 0, Date.now());
      expect(result.ok).toBe(true);
      expect((await store.get("s1"))?.state).toEqual({ status: { a: "ok", b: "done" } });
    });

    it("throws on depth > 2 paths", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", {});
      await expect(
        store.patchField!("s1", ["a", "b", "c"], 1, 0, Date.now())
      ).rejects.toThrow();
    });
  });

  describe("incField", () => {
    it("adds delta to an existing numeric field", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { count: 10 });
      await store.incField!("s1", ["count"], 5, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ count: 15 });
    });

    it("treats a missing or non-numeric field as 0", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { label: "x" });
      await store.incField!("s1", ["count"], 3, 0, Date.now());
      await store.incField!("s1", ["label"], 2, 1, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ count: 3, label: 2 });
    });

    it("supports negative deltas and decimals", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { balance: 100 });
      await store.incField!("s1", ["balance"], -25.5, 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ balance: 74.5 });
    });
  });

  describe("pushToArray", () => {
    it("appends to an existing array preserving order", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { log: ["a"] });
      await store.pushToArray!("s1", ["log"], ["b", "c"], 0, Date.now());
      expect((await store.get("s1"))?.state).toEqual({ log: ["a", "b", "c"] });
    });

    it("treats a missing or non-array field as []", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { log: "not-an-array" });
      await store.pushToArray!("s1", ["fresh"], ["first"], 0, Date.now());
      await store.pushToArray!("s1", ["log"], ["x"], 1, Date.now());
      expect((await store.get("s1"))?.state).toEqual({
        fresh: ["first"],
        log: ["x"]
      });
    });
  });

  describe("list does not drop sidecar-suffixed ids (FIX-686)", () => {
    it("returns a scope record whose id collides with a sidecar suffix", async () => {
      // Intent: the request store skips `.events.json`/`.runonce.*.json`
      // sidecar files in its directory, but scope stores (session/user/org)
      // hold no sidecars and must never apply that skip — `encodeURIComponent`
      // leaves `.` intact, so a caller id like `tenant.events` would otherwise
      // be silently dropped from list().
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "tenant.events", { count: 1 });
      await seed(store, "acct.runonce.daily", { count: 2 });
      const ids = (await store.list()).map((r) => r.id).sort();
      expect(ids).toEqual(["acct.runonce.daily", "tenant.events"]);
    });
  });

  describe("non-state field preservation", () => {
    it("delta verbs preserve top-level record fields", async () => {
      const store = createFilesystemSessionStore({ rootDir });
      await seed(store, "s1", { count: 0 });
      const before = await store.get("s1");

      await store.patchField!("s1", ["count"], 1, 0, Date.now());

      const after = await store.get("s1");
      expect(after?.flowKind).toBe("flow-a");
      expect(after?.userId).toBe("user_1");
      expect(after?.id).toBe("s1");
      expect(after?.createdAt).toBe(before?.createdAt);
    });
  });
});
