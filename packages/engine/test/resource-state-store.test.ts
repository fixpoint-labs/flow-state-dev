/**
 * Tests for the ResourceStateStore interface implementations.
 *
 * Validates CRUD operations, batch operations, scope isolation, JSON
 * round-tripping, and key encoding for both InMemoryResourceStateStore and
 * FilesystemResourceStateStore. The filesystem-specific legacy-guard,
 * symlink-safety, and on-disk-layout cases live in the shared
 * `createFilesystemStoreGuardConformanceTests` suite (run against both stores).
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ContentScopeType, ResourceStateStore } from "../src/stores/types";
import {
  createInMemoryResourceStateStore,
  createFilesystemResourceStateStore
} from "../src";
import { createResourceStateStoreConformanceTests } from "../src/testing";
import { createFilesystemStoreGuardConformanceTests } from "./filesystem-store-guard-conformance";

/**
 * These cases cover CRUD, scope isolation and JSON round-tripping — storage
 * behaviour, not concurrency, which the conformance suite owns. They therefore
 * write with the `"any"` opt-out and read through the helpers below, so the
 * assertions stay about the stored value rather than the version beside it.
 */
async function put(
  s: ResourceStateStore,
  scopeType: ContentScopeType,
  scopeId: string,
  key: string,
  value: JsonObject
): Promise<void> {
  const result = await s.set(scopeType, scopeId, key, value, "any");
  if (!result.ok) throw new Error(`unexpected conflict writing ${key}`);
}

async function readState(
  s: ResourceStateStore,
  scopeType: ContentScopeType,
  scopeId: string,
  key: string
): Promise<JsonObject | undefined> {
  return (await s.get(scopeType, scopeId, key))?.state;
}

async function readAll(
  s: ResourceStateStore,
  scopeType: ContentScopeType,
  scopeId: string
): Promise<Record<string, JsonObject>> {
  return unwrapStates(await s.getAll(scopeType, scopeId));
}

async function readPrefix(
  s: ResourceStateStore,
  scopeType: ContentScopeType,
  scopeId: string,
  keyPrefix: string
): Promise<Record<string, JsonObject>> {
  return unwrapStates(await s.getByPrefix(scopeType, scopeId, keyPrefix));
}

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
      await put(s, "session", "s1", "notes", { count: 1, label: "hi" });
      expect(await readState(s, "session", "s1", "notes")).toEqual({ count: 1, label: "hi" });
    });

    it("get returns undefined for missing key", async () => {
      const s = await setup();
      expect(await readState(s, "session", "s1", "missing")).toBeUndefined();
    });

    it("set overwrites existing state", async () => {
      const s = await setup();
      await put(s, "session", "s1", "notes", { v: "first" });
      await put(s, "session", "s1", "notes", { v: "second" });
      expect(await readState(s, "session", "s1", "notes")).toEqual({ v: "second" });
    });

    it("delete removes state", async () => {
      const s = await setup();
      await put(s, "session", "s1", "notes", { v: 1 });
      await s.delete("session", "s1", "notes", "any");
      expect(await readState(s, "session", "s1", "notes")).toBeUndefined();
    });

    it("delete is a no-op for missing key", async () => {
      const s = await setup();
      expect((await s.delete("session", "s1", "nonexistent", "any")).ok).toBe(true);
    });

    it("getAll returns all state for a scope instance", async () => {
      const s = await setup();
      await put(s, "session", "s1", "notes", { a: 1 });
      await put(s, "session", "s1", "config", { b: 2 });
      await put(s, "session", "s1", "readme", { c: 3 });

      const all = await readAll(s, "session", "s1");
      expect(all).toEqual({ notes: { a: 1 }, config: { b: 2 }, readme: { c: 3 } });
    });

    it("getAll returns empty object for unknown scope", async () => {
      const s = await setup();
      expect(await readAll(s, "session", "nonexistent")).toEqual({});
    });

    it("getByPrefix returns only keys matching the prefix", async () => {
      const s = await setup();
      await put(s, "session", "s1", "todos/a", { done: false });
      await put(s, "session", "s1", "todos/b", { done: true });
      await put(s, "session", "s1", "notes", { x: 1 });

      const matched = await readPrefix(s, "session", "s1", "todos/");
      expect(matched).toEqual({ "todos/a": { done: false }, "todos/b": { done: true } });
    });

    it("getByPrefix with an empty prefix returns all keys in scope", async () => {
      const s = await setup();
      await put(s, "session", "s1", "notes", { x: 1 });
      await put(s, "session", "s1", "todos/a", { done: false });

      const all = await readPrefix(s, "session", "s1", "");
      expect(all).toEqual({ notes: { x: 1 }, "todos/a": { done: false } });
    });

    it("getByPrefix returns empty object when nothing matches", async () => {
      const s = await setup();
      await put(s, "session", "s1", "notes", { x: 1 });
      expect(await readPrefix(s, "session", "s1", "todos/")).toEqual({});
    });

    it("getByPrefix isolates by scope type and id", async () => {
      const s = await setup();
      await put(s, "session", "s1", "k/1", { v: "session" });
      await put(s, "user", "s1", "k/1", { v: "user" });
      await put(s, "session", "s2", "k/1", { v: "other" });

      expect(await readPrefix(s, "session", "s1", "k/")).toEqual({ "k/1": { v: "session" } });
    });

    it("deleteAll removes all state for a scope instance", async () => {
      const s = await setup();
      await put(s, "session", "s1", "a", { v: 1 });
      await put(s, "session", "s1", "b", { v: 2 });
      await s.deleteAll("session", "s1");

      expect(await readState(s, "session", "s1", "a")).toBeUndefined();
      expect(await readState(s, "session", "s1", "b")).toBeUndefined();
      expect(await readAll(s, "session", "s1")).toEqual({});
    });

    it("deleteAll is a no-op for unknown scope", async () => {
      const s = await setup();
      await expect(s.deleteAll("session", "nonexistent")).resolves.toBeUndefined();
    });

    it("isolates state between different scope types", async () => {
      const s = await setup();
      await put(s, "session", "id1", "key", { v: "session" });
      await put(s, "user", "id1", "key", { v: "user" });
      await put(s, "org", "id1", "key", { v: "project" });

      expect(await readState(s, "session", "id1", "key")).toEqual({ v: "session" });
      expect(await readState(s, "user", "id1", "key")).toEqual({ v: "user" });
      expect(await readState(s, "org", "id1", "key")).toEqual({ v: "project" });
    });

    it("deleteAll does not affect other scope instances", async () => {
      const s = await setup();
      await put(s, "session", "s1", "key", { v: 1 });
      await put(s, "session", "s2", "key", { v: 2 });

      await s.deleteAll("session", "s1");
      expect(await readState(s, "session", "s1", "key")).toBeUndefined();
      expect(await readState(s, "session", "s2", "key")).toEqual({ v: 2 });
    });

    it("handles resource keys with special characters", async () => {
      const s = await setup();
      const specialKey = "todos/nested/item-1";
      await put(s, "session", "s1", specialKey, { ok: true });
      expect(await readState(s, "session", "s1", specialKey)).toEqual({ ok: true });

      const all = await readAll(s, "session", "s1");
      expect(all[specialKey]).toEqual({ ok: true });
    });

    it("round-trips nested JSON state", async () => {
      const s = await setup();
      const nested: JsonObject = {
        list: [1, 2, { deep: "value" }],
        flag: null,
        meta: { tags: ["a", "b"], count: 2 }
      };
      await put(s, "session", "s1", "complex", nested);
      expect(await readState(s, "session", "s1", "complex")).toEqual(nested);
    });

    it("handles empty-object state", async () => {
      const s = await setup();
      await put(s, "session", "s1", "empty", {});
      expect(await readState(s, "session", "s1", "empty")).toEqual({});
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
          put(s, "user", "u:trading-desk", `holdings/acct__T${i}`, { ticker: `T${i}` })
        )
      );
      const all = await readAll(s, "user", "u:trading-desk");
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

// Run the shared cross-adapter conformance suite against BOTH engine-hosted
// adapters. The memory store was previously absent from it — the handwritten
// cases above share its `describe` name, which made the gap easy to miss — so
// a memory-only regression had nothing cross-adapter holding it.
createResourceStateStoreConformanceTests({
  name: "InMemoryResourceStateStore",
  createStore: () => createInMemoryResourceStateStore()
});

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
  // The guard suite exercises the layout marker, symlink safety and the
  // on-disk tree — none of which is concurrency — so the state store is
  // adapted to the suite's last-write-wins shape rather than the suite being
  // split. `"any"` is the opt-out posture, and unwrapping the versioned read
  // keeps both stores running the identical guard matrix.
  createStore: (rootDir) => {
    const store = createFilesystemResourceStateStore(rootDir);
    return {
      get: async (scopeType, scopeId, key) =>
        (await store.get(scopeType, scopeId, key))?.state,
      set: async (scopeType, scopeId, key, value) => {
        const result = await store.set(scopeType, scopeId, key, value, "any");
        if (!result.ok) throw new Error(`unexpected conflict writing ${key}`);
      },
      delete: async (scopeType, scopeId, key) => {
        await store.delete(scopeType, scopeId, key, "any");
      },
      getAll: async (scopeType, scopeId) =>
        unwrapStates(await store.getAll(scopeType, scopeId)),
      getByPrefix: async (scopeType, scopeId, prefix) =>
        unwrapStates(await store.getByPrefix(scopeType, scopeId, prefix)),
      deleteAll: (scopeType, scopeId) => store.deleteAll(scopeType, scopeId)
    };
  },
  makeValue: (i) => ({ n: i, label: `state-${i}` })
});

/** Drop the versions from a bulk read so it matches the guard suite's shape. */
function unwrapStates(
  entries: Record<string, { state: JsonObject; version: number }>
): Record<string, JsonObject> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key, entry.state])
  );
}

/**
 * Filesystem-specific behaviour that the cross-adapter conformance suite
 * cannot express: the on-disk record layout, the legacy test, and the
 * crash-atomicity guarantee that layout exists to provide.
 */
describe("FilesystemResourceStateStore on-disk record", () => {
  let rootDir: string;
  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });
  async function freshStore(): Promise<ResourceStateStore> {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-state-record-"));
    return createFilesystemResourceStateStore(rootDir);
  }
  const leafPath = (key: string): string =>
    path.join(rootDir, "state", "session", "s1", `${key}.json`);

  it("commits state and metadata as ONE file, so a crash can never pair a new state with a stale version", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "notes", { v: 1 }, 0);
    await store.set("session", "s1", "notes", { v: 2 }, 1);

    // The whole crash-atomicity argument rests on this: the store's durability
    // primitive is a per-file temp-write + rename, which is atomic for ONE
    // file and does not compose across two. A sibling metadata leaf would be a
    // second rename, and a crash between them would leave `{v:2}` on disk
    // still labelled version 1 — a stale expectedVersion would then match.
    // Keeping the record self-contained makes the single rename the commit
    // point, so this assertion IS the guarantee.
    const scopeDir = path.join(rootDir, "state", "session", "s1");
    const files = (await readdir(scopeDir)).filter((f) => !f.startsWith("."));
    expect(files).toEqual(["notes.json"]);

    // and that one file carries both halves, from the same write
    const record = JSON.parse(await readFile(leafPath("notes"), "utf8"));
    expect(Array.isArray(record)).toBe(true);
    expect(record[1]).toBe(2); // version
    expect(record[3]).toEqual({ v: 2 }); // state written at that version
  });

  it("ignores an interrupted write's temp file and keeps serving the committed record", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "notes", { v: 1 }, 0);

    // A crash mid-write leaves the temp behind; the rename never happened.
    const scopeDir = path.join(rootDir, "state", "session", "s1");
    await writeFile(path.join(scopeDir, "notes.json.tmp-999-1-abc"), "{ partial", "utf8");

    expect(await store.get("session", "s1", "notes")).toEqual({
      state: { v: 1 },
      version: 1
    });
    expect(Object.keys(await store.getAll("session", "s1"))).toEqual(["notes"]);
  });

  it("reads a pre-versioning leaf as live at version 1 and updates it without a wipe", async () => {
    const store = await freshStore();
    // seed a legacy leaf: the user's object written verbatim, as the
    // pre-versioning adapter wrote it
    await store.set("session", "s1", "seed", { ignored: true }, "any");
    await writeFile(leafPath("legacy"), JSON.stringify({ hello: "world" }), "utf8");

    expect(await store.get("session", "s1", "legacy")).toEqual({
      state: { hello: "world" },
      version: 1
    });
    // an existing row must never read as absence, so create-if-absent conflicts
    const created = await store.set("session", "s1", "legacy", { x: 1 }, 0);
    expect(created.ok).toBe(false);
    // and a version-1 write lands on top of it
    const updated = await store.set("session", "s1", "legacy", { hello: "again" }, 1);
    expect(updated).toEqual({ ok: true, version: 2 });
  });

  it("round-trips a legacy leaf whose OWN state contains state/version/lifecycle keys", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "seed", { ignored: true }, "any");
    // The exact shape an in-`.json` envelope would misread: `lifecycle` would
    // hide this live row as a tombstone, and `state` would make the adapter
    // return the nested value instead of the object. The legacy test reads the
    // root JSON type, which a user object can never forge, so this is safe.
    const hostile: JsonObject = {
      state: { nested: "value" },
      version: 99,
      lifecycle: "deleted"
    };
    await writeFile(leafPath("hostile"), JSON.stringify(hostile), "utf8");

    expect(await store.get("session", "s1", "hostile")).toEqual({
      state: hostile,
      version: 1
    });
    expect((await store.getAll("session", "s1"))["hostile"]).toEqual({
      state: hostile,
      version: 1
    });
  });

  it("a key that looks like store metadata cannot collide with a real record", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "a", { which: "plain" }, 0);
    await store.set("session", "s1", "a.meta", { which: "meta" }, 0);
    await store.set("session", "s1", "a.state", { which: "state" }, 0);

    expect((await store.get("session", "s1", "a"))?.state).toEqual({ which: "plain" });
    expect((await store.get("session", "s1", "a.meta"))?.state).toEqual({ which: "meta" });
    expect((await store.get("session", "s1", "a.state"))?.state).toEqual({ which: "state" });
  });

  it("deleteAll leaves marked tombstones on disk rather than an empty tree", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "a", { v: 1 }, 0);
    await store.set("session", "s1", "a", { v: 2 }, 1); // version 2
    await store.deleteAll("session", "s1");

    // the file survives, carrying the retained version and a dropped payload
    const record = JSON.parse(await readFile(leafPath("a"), "utf8"));
    expect(record[1]).toBe(2); // version retained
    expect(record[2]).toBe("deleted");
    expect(record[3]).toEqual({}); // payload dropped
    // and the retention is what makes the straggler conflict
    expect((await store.set("session", "s1", "a", { v: 9 }, 2)).ok).toBe(false);
  });

  it("a delete retains the version and drops the payload", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "k", { secret: "value" }, 0);
    await store.delete("session", "s1", "k", 1);

    const record = JSON.parse(await readFile(leafPath("k"), "utf8"));
    expect(record[2]).toBe("deleted");
    expect(record[3]).toEqual({});
  });

  it("serializes two concurrent in-process writers to one key", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "k", { n: 0 }, 0);

    // Both read version 1 and both write against it. Exactly one may win —
    // that is the defect this issue exists to close.
    const [first, second] = await Promise.all([
      store.set("session", "s1", "k", { n: 1 }, 1),
      store.set("session", "s1", "k", { n: 2 }, 1)
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect((await store.get("session", "s1", "k"))?.version).toBe(2);
  });
});
