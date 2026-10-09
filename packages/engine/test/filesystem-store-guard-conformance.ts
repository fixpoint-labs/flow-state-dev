/**
 * Shared filesystem-store guard + symlink-safety conformance suite.
 *
 * The content (`.md`) and state (`.json`) stores run the IDENTICAL
 * `createFilesystemResourceStore` factory, so scope-id validation, symlink
 * safety, and on-disk nested layout must be verified symmetrically for both —
 * a regression in e.g. the symlinked-leaf guard would otherwise only be caught
 * on whichever path happened to carry the full matrix. Each store test file
 * calls this once with its adapter config instead of duplicating the cases.
 */
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentScopeType } from "../src/stores/types";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The store contract these guard cases exercise (content or state store). */
interface GuardConformanceStore<V> {
  get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<V | undefined>;
  set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, value: V): Promise<void>;
  delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void>;
  getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, V>>;
  getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, V>>;
  deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void>;
}

interface FilesystemGuardConformanceOptions<V> {
  /** Display name, e.g. `"FilesystemContentStore"`. */
  name: string;
  /** Subtree under `rootDir` the store owns — `"content"` | `"state"`. */
  subdir: string;
  /** Leaf extension — `".md"` | `".json"`. */
  ext: string;
  /** Build the store rooted at `rootDir`. */
  createStore: (rootDir: string) => GuardConformanceStore<V>;
  /** A distinct value of the store's payload type for index `i`. */
  makeValue: (i: number) => V;
}

/**
 * Register the filesystem guard + symlink-safety cases against one store
 * adapter. Call at a test file's top level.
 */
export function createFilesystemStoreGuardConformanceTests<V>(
  options: FilesystemGuardConformanceOptions<V>
): void {
  const { name, subdir, ext, createStore, makeValue } = options;

  describe(`${name} nested on-disk layout`, () => {
    let rootDir: string;
    afterEach(async () => {
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });
    async function freshStore(): Promise<GuardConformanceStore<V>> {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-layout-`));
      return createStore(rootDir);
    }

    it("writes a nested file tree with the leaf extension", async () => {
      const store = await freshStore();
      await store.set("session", "s1", "concepts/flow-state-dev/overview", makeValue(1));
      const expected = path.join(
        rootDir,
        subdir,
        "session",
        "s1",
        "concepts",
        "flow-state-dev",
        `overview${ext}`
      );
      expect(await pathExists(expected)).toBe(true);
      expect(await store.get("session", "s1", "concepts/flow-state-dev/overview")).toEqual(
        makeValue(1)
      );
    });

    it("lets a leaf and a branch of the same name coexist", async () => {
      const store = await freshStore();
      await store.set("session", "s1", "x", makeValue(1));
      await store.set("session", "s1", "x/y", makeValue(2));

      expect(await store.get("session", "s1", "x")).toEqual(makeValue(1));
      expect(await store.get("session", "s1", "x/y")).toEqual(makeValue(2));

      const scopeDir = path.join(rootDir, subdir, "session", "s1");
      expect((await stat(path.join(scopeDir, `x${ext}`))).isFile()).toBe(true);
      expect((await stat(path.join(scopeDir, "x"))).isDirectory()).toBe(true);
    });

    it("rejects unsafe scope ids", async () => {
      const store = await freshStore();
      for (const bad of ["..", ".", "", "CON"]) {
        await expect(store.get("session", bad, "k")).rejects.toThrow();
      }
    });
  });

  describe(`${name} symlink safety`, () => {
    let rootDir: string;
    afterEach(async () => {
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });
    async function freshStore(): Promise<GuardConformanceStore<V>> {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-symlink-`));
      return createStore(rootDir);
    }

    it("rejects a symlinked resource leaf on get and delete", async () => {
      const store = await freshStore();
      await store.set("session", "s1", "real", makeValue(1)); // creates scope dir
      const outside = path.join(rootDir, `outside${ext}`);
      await writeFile(outside, "secret", "utf8");
      const scopeDir = path.join(rootDir, subdir, "session", "s1");
      await symlink(outside, path.join(scopeDir, `secret${ext}`));

      await expect(store.get("session", "s1", "secret")).rejects.toThrow(/symlink/i);
      await expect(store.delete("session", "s1", "secret")).rejects.toThrow(/symlink/i);
      expect(await pathExists(outside)).toBe(true); // target untouched
    });

    it("rejects a symlinked ancestor directory on get and set", async () => {
      const store = await freshStore();
      const outsideDir = path.join(rootDir, "outside");
      await mkdir(outsideDir, { recursive: true });
      await mkdir(path.join(rootDir, subdir), { recursive: true });
      await symlink(outsideDir, path.join(rootDir, subdir, "session"));

      await expect(store.get("session", "s1", "k")).rejects.toThrow(/symlink/i);
      await expect(store.set("session", "s1", "k", makeValue(1))).rejects.toThrow(/symlink/i);
    });

    it("deleteAll never deletes through a symlinked scope dir", async () => {
      const store = await freshStore();
      const outsideDir = path.join(rootDir, "outside");
      await mkdir(outsideDir, { recursive: true });
      const keep = path.join(outsideDir, `keep${ext}`);
      await writeFile(keep, "important", "utf8");
      const sessionDir = path.join(rootDir, subdir, "session");
      await mkdir(sessionDir, { recursive: true });
      const scopeLink = path.join(sessionDir, "s1");
      await symlink(outsideDir, scopeLink);

      await store.deleteAll("session", "s1");
      expect(await pathExists(keep)).toBe(true); // target dir + contents survive
    });

    it("getByPrefix does not follow a symlinked intermediate directory", async () => {
      const store = await freshStore();
      await store.set("session", "s1", "real", makeValue(1)); // creates scope dir
      const scopeDir = path.join(rootDir, subdir, "session", "s1");
      const outsideDir = path.join(rootDir, "outside");
      await mkdir(path.join(outsideDir, "b"), { recursive: true });
      await writeFile(path.join(outsideDir, "b", `leak${ext}`), "leaked", "utf8");
      await symlink(outsideDir, path.join(scopeDir, "a"));

      // A deep prefix whose intermediate segment `a` is a symlink must not leak.
      expect(await store.getByPrefix("session", "s1", "a/b/x")).toEqual({});
    });

    it("writes nothing through a symlinked subtree root", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-symroot-`));
      const outsideDir = path.join(rootDir, "outside");
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, path.join(rootDir, subdir));
      const store = createStore(rootDir);

      await expect(store.set("session", "s1", "k", makeValue(1))).rejects.toThrow(/symlink/i);
      expect(await readdir(outsideDir)).toEqual([]);
    });
  });
}
