/**
 * Tests for the ResourceStateStore interface implementations.
 *
 * Validates CRUD operations, batch operations, scope isolation, JSON
 * round-tripping, and key encoding for both InMemoryResourceStateStore and
 * FilesystemResourceStateStore. The filesystem-specific legacy-guard,
 * symlink-safety, and on-disk-layout cases live in the shared
 * `createFilesystemStoreGuardConformanceTests` suite (run against both stores).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ResourceStateStore } from "../src/stores/types";
import {
  createInMemoryResourceStateStore,
  createFilesystemResourceStateStore
} from "../src";
import { createResourceStateStoreConformanceTests } from "../src/testing";
import { createFilesystemStoreGuardConformanceTests } from "./filesystem-store-guard-conformance";

function runResourceStateStoreTests(
  name: string,
  createStore: () => Promise<{ store: ResourceStateStore; cleanup?: () => Promise<void> }>
) {
  describe(name, () => {
    let store: ResourceStateStore;
    let cleanup: (() => Promise<void>) | undefined;

    afterEach(async () => {
      if (cleanup) {
        await cleanup();
        cleanup = undefined;
      }
    });

    async function setup(): Promise<ResourceStateStore> {
      const result = await createStore();
      store = result.store;
      cleanup = result.cleanup;
      return store;
    }

    it("set then get returns the state", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", { count: 1, label: "hi" });
      expect(await s.get("session", "s1", "notes")).toEqual({ count: 1, label: "hi" });
    });

    it("get returns undefined for missing key", async () => {
      const s = await setup();
      expect(await s.get("session", "s1", "missing")).toBeUndefined();
    });

    it("set overwrites existing state", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", { v: "first" });
      await s.set("session", "s1", "notes", { v: "second" });
      expect(await s.get("session", "s1", "notes")).toEqual({ v: "second" });
    });

    it("delete removes state", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", { v: 1 });
      await s.delete("session", "s1", "notes");
      expect(await s.get("session", "s1", "notes")).toBeUndefined();
    });

    it("delete is a no-op for missing key", async () => {
      const s = await setup();
      await expect(s.delete("session", "s1", "nonexistent")).resolves.toBeUndefined();
    });

    it("getAll returns all state for a scope instance", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", { a: 1 });
      await s.set("session", "s1", "config", { b: 2 });
      await s.set("session", "s1", "readme", { c: 3 });

      const all = await s.getAll("session", "s1");
      expect(all).toEqual({ notes: { a: 1 }, config: { b: 2 }, readme: { c: 3 } });
    });

    it("getAll returns empty object for unknown scope", async () => {
      const s = await setup();
      expect(await s.getAll("session", "nonexistent")).toEqual({});
    });

    it("getByPrefix returns only keys matching the prefix", async () => {
      const s = await setup();
      await s.set("session", "s1", "todos/a", { done: false });
      await s.set("session", "s1", "todos/b", { done: true });
      await s.set("session", "s1", "notes", { x: 1 });

      const matched = await s.getByPrefix("session", "s1", "todos/");
      expect(matched).toEqual({ "todos/a": { done: false }, "todos/b": { done: true } });
    });

    it("getByPrefix with an empty prefix returns all keys in scope", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", { x: 1 });
      await s.set("session", "s1", "todos/a", { done: false });

      const all = await s.getByPrefix("session", "s1", "");
      expect(all).toEqual({ notes: { x: 1 }, "todos/a": { done: false } });
    });

    it("getByPrefix returns empty object when nothing matches", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", { x: 1 });
      expect(await s.getByPrefix("session", "s1", "todos/")).toEqual({});
    });

    it("getByPrefix isolates by scope type and id", async () => {
      const s = await setup();
      await s.set("session", "s1", "k/1", { v: "session" });
      await s.set("user", "s1", "k/1", { v: "user" });
      await s.set("session", "s2", "k/1", { v: "other" });

      expect(await s.getByPrefix("session", "s1", "k/")).toEqual({ "k/1": { v: "session" } });
    });

    it("deleteAll removes all state for a scope instance", async () => {
      const s = await setup();
      await s.set("session", "s1", "a", { v: 1 });
      await s.set("session", "s1", "b", { v: 2 });
      await s.deleteAll("session", "s1");

      expect(await s.get("session", "s1", "a")).toBeUndefined();
      expect(await s.get("session", "s1", "b")).toBeUndefined();
      expect(await s.getAll("session", "s1")).toEqual({});
    });

    it("deleteAll is a no-op for unknown scope", async () => {
      const s = await setup();
      await expect(s.deleteAll("session", "nonexistent")).resolves.toBeUndefined();
    });

    it("isolates state between different scope types", async () => {
      const s = await setup();
      await s.set("session", "id1", "key", { v: "session" });
      await s.set("user", "id1", "key", { v: "user" });
      await s.set("org", "id1", "key", { v: "project" });

      expect(await s.get("session", "id1", "key")).toEqual({ v: "session" });
      expect(await s.get("user", "id1", "key")).toEqual({ v: "user" });
      expect(await s.get("org", "id1", "key")).toEqual({ v: "project" });
    });

    it("deleteAll does not affect other scope instances", async () => {
      const s = await setup();
      await s.set("session", "s1", "key", { v: 1 });
      await s.set("session", "s2", "key", { v: 2 });

      await s.deleteAll("session", "s1");
      expect(await s.get("session", "s1", "key")).toBeUndefined();
      expect(await s.get("session", "s2", "key")).toEqual({ v: 2 });
    });

    it("handles resource keys with special characters", async () => {
      const s = await setup();
      const specialKey = "todos/nested/item-1";
      await s.set("session", "s1", specialKey, { ok: true });
      expect(await s.get("session", "s1", specialKey)).toEqual({ ok: true });

      const all = await s.getAll("session", "s1");
      expect(all[specialKey]).toEqual({ ok: true });
    });

    it("round-trips nested JSON state", async () => {
      const s = await setup();
      const nested: JsonObject = {
        list: [1, 2, { deep: "value" }],
        flag: null,
        meta: { tags: ["a", "b"], count: 2 }
      };
      await s.set("session", "s1", "complex", nested);
      expect(await s.get("session", "s1", "complex")).toEqual(nested);
    });

    it("handles empty-object state", async () => {
      const s = await setup();
      await s.set("session", "s1", "empty", {});
      expect(await s.get("session", "s1", "empty")).toEqual({});
    });

    it("handles many concurrent writes to a fresh scope without losing writes", async () => {
      const s = await setup();
      // Mirrors a portfolio import: many holdings written to a brand-new user
      // scope at once. The filesystem store must survive the concurrent
      // recursive-mkdir race on the just-created scope dir that previously
      // surfaced as an ENOENT on a stray `…/holdings%2F…__VRSK.tmp-…` write
      // (failing the whole import — "nothing happened").
      const count = 40;
      await Promise.all(
        Array.from({ length: count }, (_, i) =>
          s.set("user", "u:trading-desk", `holdings/acct__T${i}`, { ticker: `T${i}` })
        )
      );
      const all = await s.getAll("user", "u:trading-desk");
      expect(Object.keys(all)).toHaveLength(count);
      expect(all["holdings/acct__T0"]).toEqual({ ticker: "T0" });
      expect(all["holdings/acct__T39"]).toEqual({ ticker: "T39" });
    });
  });
}

runResourceStateStoreTests("InMemoryResourceStateStore", async () => ({
  store: createInMemoryResourceStateStore()
}));

runResourceStateStoreTests("FilesystemResourceStateStore", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-resource-state-store-"));
  return {
    store: createFilesystemResourceStateStore(rootDir),
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
});

// Run the shared cross-adapter conformance suite against the filesystem adapter.
const conformanceDirs: string[] = [];
createResourceStateStoreConformanceTests({
  name: "FilesystemResourceStateStore",
  createStore: async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-state-conformance-"));
    conformanceDirs.push(rootDir);
    return createFilesystemResourceStateStore(rootDir);
  }
});
afterEach(async () => {
  await Promise.all(
    conformanceDirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
  );
});

// Shared filesystem guard + symlink-safety + on-disk-layout suite — same suite
// the content store runs, so both `.md` and `.json` stores get identical
// coverage of the factory's guards.
createFilesystemStoreGuardConformanceTests<JsonObject>({
  name: "FilesystemResourceStateStore",
  subdir: "state",
  ext: ".json",
  createStore: (rootDir) => createFilesystemResourceStateStore(rootDir),
  makeValue: (i) => ({ n: i, label: `state-${i}` })
});
