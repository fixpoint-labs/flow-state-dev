/**
 * Tests for the ContentStore interface implementations.
 *
 * Validates CRUD operations, batch operations, scope isolation, and
 * key encoding for both InMemoryContentStore and FilesystemContentStore.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import type { ContentStore } from "../src/stores/types";
import {
  createInMemoryContentStore,
  createFilesystemContentStore
} from "../src";
import { createContentStoreConformanceTests } from "../src/testing";

function runContentStoreTests(
  name: string,
  createStore: () => Promise<{ store: ContentStore; cleanup?: () => Promise<void> }>
) {
  describe(name, () => {
    let store: ContentStore;
    let cleanup: (() => Promise<void>) | undefined;

    afterEach(async () => {
      if (cleanup) {
        await cleanup();
        cleanup = undefined;
      }
    });

    async function setup(): Promise<ContentStore> {
      const result = await createStore();
      store = result.store;
      cleanup = result.cleanup;
      return store;
    }

    it("set then get returns the content", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", "hello world");
      expect(await s.get("session", "s1", "notes")).toBe("hello world");
    });

    it("get returns undefined for missing key", async () => {
      const s = await setup();
      expect(await s.get("session", "s1", "missing")).toBeUndefined();
    });

    it("set overwrites existing content", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", "first");
      await s.set("session", "s1", "notes", "second");
      expect(await s.get("session", "s1", "notes")).toBe("second");
    });

    it("delete removes content", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", "value");
      await s.delete("session", "s1", "notes");
      expect(await s.get("session", "s1", "notes")).toBeUndefined();
    });

    it("delete is a no-op for missing key", async () => {
      const s = await setup();
      await expect(s.delete("session", "s1", "nonexistent")).resolves.toBeUndefined();
    });

    it("getAll returns all content for a scope instance", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", "note content");
      await s.set("session", "s1", "config", "config content");
      await s.set("session", "s1", "readme", "readme content");

      const all = await s.getAll("session", "s1");
      expect(all).toEqual({
        notes: "note content",
        config: "config content",
        readme: "readme content"
      });
    });

    it("getAll returns empty object for unknown scope", async () => {
      const s = await setup();
      const all = await s.getAll("session", "nonexistent");
      expect(all).toEqual({});
    });

    it("getByPrefix returns only keys matching the prefix", async () => {
      const s = await setup();
      await s.set("session", "s1", "files/a.ts", "a");
      await s.set("session", "s1", "files/b.ts", "b");
      await s.set("session", "s1", "notes", "n");

      const matched = await s.getByPrefix("session", "s1", "files/");
      expect(matched).toEqual({ "files/a.ts": "a", "files/b.ts": "b" });
    });

    it("getByPrefix with an empty prefix returns all keys in scope", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", "n");
      await s.set("session", "s1", "files/a.ts", "a");

      const all = await s.getByPrefix("session", "s1", "");
      expect(all).toEqual({ notes: "n", "files/a.ts": "a" });
    });

    it("getByPrefix returns empty object when nothing matches", async () => {
      const s = await setup();
      await s.set("session", "s1", "notes", "n");
      expect(await s.getByPrefix("session", "s1", "files/")).toEqual({});
    });

    it("getByPrefix isolates by scope type and id", async () => {
      const s = await setup();
      await s.set("session", "s1", "k/1", "session");
      await s.set("user", "s1", "k/1", "user");
      await s.set("session", "s2", "k/1", "other");

      expect(await s.getByPrefix("session", "s1", "k/")).toEqual({ "k/1": "session" });
    });

    it("deleteAll removes all content for a scope instance", async () => {
      const s = await setup();
      await s.set("session", "s1", "a", "1");
      await s.set("session", "s1", "b", "2");
      await s.deleteAll("session", "s1");

      expect(await s.get("session", "s1", "a")).toBeUndefined();
      expect(await s.get("session", "s1", "b")).toBeUndefined();
      expect(await s.getAll("session", "s1")).toEqual({});
    });

    it("deleteAll is a no-op for unknown scope", async () => {
      const s = await setup();
      await expect(s.deleteAll("session", "nonexistent")).resolves.toBeUndefined();
    });

    it("isolates content between different scope types", async () => {
      const s = await setup();
      await s.set("session", "id1", "key", "session-value");
      await s.set("user", "id1", "key", "user-value");
      await s.set("org", "id1", "key", "project-value");

      expect(await s.get("session", "id1", "key")).toBe("session-value");
      expect(await s.get("user", "id1", "key")).toBe("user-value");
      expect(await s.get("org", "id1", "key")).toBe("project-value");
    });

    it("isolates content between different scope IDs", async () => {
      const s = await setup();
      await s.set("session", "s1", "key", "value-1");
      await s.set("session", "s2", "key", "value-2");

      expect(await s.get("session", "s1", "key")).toBe("value-1");
      expect(await s.get("session", "s2", "key")).toBe("value-2");
    });

    it("deleteAll does not affect other scope instances", async () => {
      const s = await setup();
      await s.set("session", "s1", "key", "value-1");
      await s.set("session", "s2", "key", "value-2");

      await s.deleteAll("session", "s1");
      expect(await s.get("session", "s1", "key")).toBeUndefined();
      expect(await s.get("session", "s2", "key")).toBe("value-2");
    });

    it("handles resource keys with special characters", async () => {
      const s = await setup();
      const specialKey = "files/src/utils.ts";
      await s.set("session", "s1", specialKey, "file content");
      expect(await s.get("session", "s1", specialKey)).toBe("file content");

      const all = await s.getAll("session", "s1");
      expect(all[specialKey]).toBe("file content");
    });

    it("handles empty string content", async () => {
      const s = await setup();
      await s.set("session", "s1", "empty", "");
      expect(await s.get("session", "s1", "empty")).toBe("");
    });

    it("handles large content", async () => {
      const s = await setup();
      const large = "x".repeat(100_000);
      await s.set("session", "s1", "large", large);
      expect(await s.get("session", "s1", "large")).toBe(large);
    });
  });
}

runContentStoreTests("InMemoryContentStore", async () => ({
  store: createInMemoryContentStore()
}));

runContentStoreTests("FilesystemContentStore", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-store-"));
  return {
    store: createFilesystemContentStore(rootDir),
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
});

// Shared getByPrefixPaged conformance — each suite tracks its own temp dir
// so the filesystem backend cleans up per-test.
const fsConformanceRootDirs: string[] = [];
createContentStoreConformanceTests({
  name: "InMemoryContentStore",
  createStore: () => createInMemoryContentStore()
});
createContentStoreConformanceTests({
  name: "FilesystemContentStore",
  createStore: async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-store-paged-"));
    fsConformanceRootDirs.push(rootDir);
    return createFilesystemContentStore(rootDir);
  },
  cleanup: async () => {
    for (const dir of fsConformanceRootDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
