/**
 * Tests for the ContentStore interface implementations.
 *
 * Validates CRUD operations, batch operations, scope isolation, and
 * key encoding for both InMemoryContentStore and FilesystemContentStore.
 */
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import type { ContentStore } from "../src/stores/types";
import {
  createInMemoryContentStore,
  createFilesystemContentStore,
  createFilesystemStores
} from "../src";
import { createContentStoreConformanceTests } from "../src/testing";

/** True if a filesystem path exists. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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

// Run the shared cross-adapter conformance suite against the filesystem adapter.
const conformanceDirs: string[] = [];
createContentStoreConformanceTests({
  name: "FilesystemContentStore",
  createStore: async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-conformance-"));
    conformanceDirs.push(rootDir);
    return createFilesystemContentStore(rootDir);
  }
});
afterEach(async () => {
  await Promise.all(
    conformanceDirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
  );
});

const MARKER = ".fsdev-store-layout";

describe("FilesystemContentStore nested on-disk layout", () => {
  let rootDir: string;

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });

  async function freshStore(): Promise<ContentStore> {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-layout-"));
    return createFilesystemContentStore(rootDir);
  }

  it("writes a nested file tree with the leaf extension", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "concepts/flow-state-dev/overview", "body");
    const expected = path.join(
      rootDir,
      "content",
      "session",
      "s1",
      "concepts",
      "flow-state-dev",
      "overview.md"
    );
    expect(await pathExists(expected)).toBe(true);
    expect(await readFile(expected, "utf8")).toBe("body");
  });

  it("lets a leaf and a branch of the same name coexist", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "x", "leaf");
    await store.set("session", "s1", "x/y", "branch");

    expect(await store.get("session", "s1", "x")).toBe("leaf");
    expect(await store.get("session", "s1", "x/y")).toBe("branch");

    const scopeDir = path.join(rootDir, "content", "session", "s1");
    expect((await stat(path.join(scopeDir, "x.md"))).isFile()).toBe(true);
    expect((await stat(path.join(scopeDir, "x"))).isDirectory()).toBe(true);
  });
});

describe("FilesystemContentStore legacy clean-break guard", () => {
  let rootDir: string;

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });

  /** Seed a flat legacy file (pre-nested-layout) directly on disk. */
  async function seedLegacyFile(scopeId: string, resourceKey: string, body: string): Promise<void> {
    const scopeDir = path.join(rootDir, "content", "session", encodeURIComponent(scopeId));
    await mkdir(scopeDir, { recursive: true });
    await writeFile(path.join(scopeDir, encodeURIComponent(resourceKey)), body, "utf8");
  }

  it("throws on a populated no-marker subtree but does not throw at construction", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-legacy-"));
    await seedLegacyFile("s1", "notes", "old flat body");
    // Construction must not throw even with legacy data present.
    const store = createFilesystemContentStore(rootDir);
    await expect(store.get("session", "s1", "notes")).rejects.toThrow(/predates the nested-layout/);
    await expect(store.getAll("session", "s1")).rejects.toThrow(/predates the nested-layout/);
  });

  it("treats a dotted legacy file as real data", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-legacy-dot-"));
    await seedLegacyFile("s1", ".env", "SECRET=1");
    const store = createFilesystemContentStore(rootDir);
    await expect(store.get("session", "s1", ".env")).rejects.toThrow(/predates the nested-layout/);
  });

  it("recovers after deleteAll clears the legacy scope", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-recover-"));
    await seedLegacyFile("s1", "notes", "old flat body");
    const store = createFilesystemContentStore(rootDir);
    await expect(store.get("session", "s1", "notes")).rejects.toThrow();
    // deleteAll skips the guard and clears the offending files; empty
    // scaffolding left behind must not keep the guard tripping.
    await store.deleteAll("session", "s1");
    expect(await store.get("session", "s1", "notes")).toBeUndefined();
    await store.set("session", "s1", "fresh", "new body");
    expect(await store.get("session", "s1", "fresh")).toBe("new body");
  });

  it("a fresh store get returns undefined and writes no marker", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-fresh-"));
    const store = createFilesystemContentStore(rootDir);
    expect(await store.get("session", "s1", "missing")).toBeUndefined();
    expect(await pathExists(path.join(rootDir, "content", MARKER))).toBe(false);
  });

  it("the first set stamps the layout marker", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-marker-"));
    const store = createFilesystemContentStore(rootDir);
    await store.set("session", "s1", "notes", "body");
    const markerPath = path.join(rootDir, "content", MARKER);
    expect(await pathExists(markerPath)).toBe(true);
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toEqual({ layout: "nested-v1" });
  });

  it("throws on a wrong-version marker sitting atop data", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-badmarker-"));
    await mkdir(path.join(rootDir, "content"), { recursive: true });
    await writeFile(path.join(rootDir, "content", MARKER), JSON.stringify({ layout: "flat-v0" }), "utf8");
    await seedLegacyFile("s1", "notes", "body");
    const store = createFilesystemContentStore(rootDir);
    await expect(store.get("session", "s1", "notes")).rejects.toThrow(/unexpected version/);
  });

  it("does not throw on a .DS_Store-only fresh vault", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-dsstore-"));
    await mkdir(path.join(rootDir, "content", "session", "s1"), { recursive: true });
    await writeFile(path.join(rootDir, "content", "session", "s1", ".DS_Store"), "", "utf8");
    const store = createFilesystemContentStore(rootDir);
    expect(await store.get("session", "s1", "missing")).toBeUndefined();
  });

  it("rejects unsafe scope ids", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-scopeid-"));
    const store = createFilesystemContentStore(rootDir);
    for (const bad of ["..", ".", "", "CON"]) {
      await expect(store.get("session", bad, "k")).rejects.toThrow();
    }
  });

  it("isolates the guard per subtree — empty content proceeds while legacy state throws", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-isolation-"));
    // Seed a flat legacy file in the STATE subtree only.
    const stateScope = path.join(rootDir, "state", "session", "s1");
    await mkdir(stateScope, { recursive: true });
    await writeFile(path.join(stateScope, encodeURIComponent("k")), JSON.stringify({ v: 1 }), "utf8");

    const stores = createFilesystemStores({ rootDir, developmentOnly: true });
    // Content subtree is empty -> fresh -> proceeds.
    expect(await stores.content.getAll("session", "s1")).toEqual({});
    // State subtree has legacy data -> throws.
    await expect(stores.resourceState.getAll("session", "s1")).rejects.toThrow(
      /predates the nested-layout/
    );
  });

  it("throws on a corrupt (non-JSON) marker atop data", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-corrupt-"));
    const contentDir = path.join(rootDir, "content");
    const scopeDir = path.join(contentDir, "session", "s1");
    await mkdir(scopeDir, { recursive: true });
    await writeFile(path.join(contentDir, MARKER), "not json {{{", "utf8");
    await writeFile(path.join(scopeDir, encodeURIComponent("notes")), "body", "utf8");
    const store = createFilesystemContentStore(rootDir);
    await expect(store.get("session", "s1", "notes")).rejects.toThrow(/corrupt/i);
  });

  it("deleteAll refuses a present-but-incompatible layout marker", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-deleteall-marker-"));
    const contentDir = path.join(rootDir, "content");
    const scopeDir = path.join(contentDir, "session", "s1");
    await mkdir(scopeDir, { recursive: true });
    // A future/unknown layout this build can't interpret — deleteAll must not
    // rm -rf data it doesn't understand (a version-rollback scenario).
    await writeFile(path.join(contentDir, MARKER), JSON.stringify({ layout: "nested-v2" }), "utf8");
    await writeFile(path.join(scopeDir, "notes.md"), "future data", "utf8");
    const store = createFilesystemContentStore(rootDir);
    await expect(store.deleteAll("session", "s1")).rejects.toThrow(/unexpected version/);
    // A marker-absent (legacy/fresh) scope still deletes — covered by
    // "recovers after deleteAll clears the legacy scope".
  });
});

describe("FilesystemContentStore symlink safety", () => {
  let rootDir: string;

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });

  async function freshStore(): Promise<ContentStore> {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-symlink-"));
    return createFilesystemContentStore(rootDir);
  }

  it("rejects a symlinked resource leaf on get and delete", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "real", "body"); // stamps marker, creates scope dir
    const outside = path.join(rootDir, "outside.md");
    await writeFile(outside, "secret", "utf8");
    const scopeDir = path.join(rootDir, "content", "session", "s1");
    await symlink(outside, path.join(scopeDir, "secret.md"));

    await expect(store.get("session", "s1", "secret")).rejects.toThrow(/symlink/i);
    await expect(store.delete("session", "s1", "secret")).rejects.toThrow(/symlink/i);
    expect(await pathExists(outside)).toBe(true); // target untouched
  });

  it("rejects a symlinked ancestor directory on get and set", async () => {
    const store = await freshStore();
    const outsideDir = path.join(rootDir, "outside");
    await mkdir(outsideDir, { recursive: true });
    await mkdir(path.join(rootDir, "content"), { recursive: true });
    await symlink(outsideDir, path.join(rootDir, "content", "session"));

    await expect(store.get("session", "s1", "k")).rejects.toThrow(/symlink/i);
    await expect(store.set("session", "s1", "k", "body")).rejects.toThrow(/symlink/i);
  });

  it("deleteAll unlinks a symlinked scope dir instead of deleting through it", async () => {
    const store = await freshStore();
    const outsideDir = path.join(rootDir, "outside");
    await mkdir(outsideDir, { recursive: true });
    const keep = path.join(outsideDir, "keep.md");
    await writeFile(keep, "important", "utf8");
    const sessionDir = path.join(rootDir, "content", "session");
    await mkdir(sessionDir, { recursive: true });
    const scopeLink = path.join(sessionDir, "s1");
    await symlink(outsideDir, scopeLink);

    await store.deleteAll("session", "s1");
    expect(await pathExists(scopeLink)).toBe(false); // symlink removed
    expect(await pathExists(keep)).toBe(true); // target dir + contents survive
  });

  it("getByPrefix does not follow a symlinked intermediate directory", async () => {
    const store = await freshStore();
    await store.set("session", "s1", "real", "body"); // stamps marker, creates scope dir
    const scopeDir = path.join(rootDir, "content", "session", "s1");
    const outsideDir = path.join(rootDir, "outside");
    await mkdir(path.join(outsideDir, "b"), { recursive: true });
    await writeFile(path.join(outsideDir, "b", "leak.md"), "leaked", "utf8");
    await symlink(outsideDir, path.join(scopeDir, "a"));

    // A deep prefix whose intermediate segment `a` is a symlink must not leak.
    expect(await store.getByPrefix("session", "s1", "a/b/x")).toEqual({});
  });

  it("does not stamp the layout marker through a symlinked subtree root", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-content-symroot-"));
    const outsideDir = path.join(rootDir, "outside");
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, path.join(rootDir, "content"));
    const store = createFilesystemContentStore(rootDir);

    await expect(store.set("session", "s1", "k", "body")).rejects.toThrow(/symlink/i);
    // The ancestor check must run before ensureMarker, so no marker is written
    // through the symlink into the outside directory.
    expect(await pathExists(path.join(outsideDir, MARKER))).toBe(false);
  });
});
