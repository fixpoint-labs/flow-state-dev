/**
 * Shared filesystem-store guard + symlink-safety conformance suite.
 *
 * The content (`.md`) and state (`.json`) stores run the IDENTICAL
 * `createFilesystemResourceStore` factory, so the legacy-layout guard, symlink
 * safety, and on-disk nested layout must be verified symmetrically for both —
 * a regression in e.g. the symlinked-leaf guard would otherwise only be caught
 * on whichever path happened to carry the full matrix. Each store test file
 * calls this once with its adapter config instead of duplicating the cases.
 */
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentScopeType } from "../src/stores/types";

const MARKER = ".fsdev-store-layout";

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
  });

  describe(`${name} legacy clean-break guard`, () => {
    let rootDir: string;
    afterEach(async () => {
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });

    /** Seed a flat legacy file (pre-nested-layout) directly on disk. */
    async function seedLegacyFile(scopeId: string, resourceKey: string): Promise<void> {
      const scopeDir = path.join(rootDir, subdir, "session", encodeURIComponent(scopeId));
      await mkdir(scopeDir, { recursive: true });
      await writeFile(path.join(scopeDir, encodeURIComponent(resourceKey)), "legacy-body", "utf8");
    }

    it("throws on a populated no-marker subtree but does not throw at construction", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-legacy-`));
      await seedLegacyFile("s1", "notes");
      const store = createStore(rootDir); // construction must not throw
      await expect(store.get("session", "s1", "notes")).rejects.toThrow(/predates the nested-layout/);
      await expect(store.getAll("session", "s1")).rejects.toThrow(/predates the nested-layout/);
    });

    it("treats a dotted legacy file as real data", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-legacy-dot-`));
      await seedLegacyFile("s1", ".env");
      const store = createStore(rootDir);
      await expect(store.get("session", "s1", ".env")).rejects.toThrow(/predates the nested-layout/);
    });

    it("recovers after deleteAll clears the legacy scope", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-recover-`));
      await seedLegacyFile("s1", "notes");
      const store = createStore(rootDir);
      await expect(store.get("session", "s1", "notes")).rejects.toThrow();
      // deleteAll clears the offending files; leftover empty scaffolding must
      // not keep the guard tripping.
      await store.deleteAll("session", "s1");
      expect(await store.get("session", "s1", "notes")).toBeUndefined();
      await store.set("session", "s1", "fresh", makeValue(1));
      expect(await store.get("session", "s1", "fresh")).toEqual(makeValue(1));
    });

    it("a fresh store get returns undefined and writes no marker; first set stamps it", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-marker-`));
      const store = createStore(rootDir);
      expect(await store.get("session", "s1", "missing")).toBeUndefined();
      const markerPath = path.join(rootDir, subdir, MARKER);
      expect(await pathExists(markerPath)).toBe(false);
      await store.set("session", "s1", "notes", makeValue(1));
      expect(JSON.parse(await readFile(markerPath, "utf8"))).toEqual({ layout: "nested-v1" });
    });

    it("throws on a wrong-version marker sitting atop data", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-badmarker-`));
      await mkdir(path.join(rootDir, subdir), { recursive: true });
      await writeFile(path.join(rootDir, subdir, MARKER), JSON.stringify({ layout: "flat-v0" }), "utf8");
      await seedLegacyFile("s1", "notes");
      const store = createStore(rootDir);
      await expect(store.get("session", "s1", "notes")).rejects.toThrow(/unexpected version/);
    });

    it("throws on a corrupt (non-JSON) marker atop data", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-corrupt-`));
      await mkdir(path.join(rootDir, subdir), { recursive: true });
      await writeFile(path.join(rootDir, subdir, MARKER), "not json {{{", "utf8");
      await seedLegacyFile("s1", "notes");
      const store = createStore(rootDir);
      await expect(store.get("session", "s1", "notes")).rejects.toThrow(/corrupt/i);
    });

    it("deleteAll refuses a present-but-incompatible layout marker", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-deleteall-marker-`));
      const scopeDir = path.join(rootDir, subdir, "session", "s1");
      await mkdir(scopeDir, { recursive: true });
      // A future/unknown layout this build can't interpret — deleteAll must not
      // rm -rf data it doesn't understand (a version-rollback scenario).
      await writeFile(path.join(rootDir, subdir, MARKER), JSON.stringify({ layout: "nested-v2" }), "utf8");
      await writeFile(path.join(scopeDir, `notes${ext}`), "future data", "utf8");
      const store = createStore(rootDir);
      await expect(store.deleteAll("session", "s1")).rejects.toThrow(/unexpected version/);
      // A marker-absent (legacy/fresh) scope still deletes — covered by
      // "recovers after deleteAll clears the legacy scope".
    });

    it("does not throw on a .DS_Store-only fresh vault", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-dsstore-`));
      await mkdir(path.join(rootDir, subdir, "session", "s1"), { recursive: true });
      await writeFile(path.join(rootDir, subdir, "session", "s1", ".DS_Store"), "", "utf8");
      const store = createStore(rootDir);
      expect(await store.get("session", "s1", "missing")).toBeUndefined();
    });

    it("treats a legacy symlinked resource file as data and refuses", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-legacy-symlink-`));
      const scopeDir = path.join(rootDir, subdir, "session", "s1");
      await mkdir(scopeDir, { recursive: true });
      const external = path.join(rootDir, "external.txt");
      await writeFile(external, "legacy via symlink", "utf8");
      // An old flat store whose resource file is a symlink must not be silently
      // classified fresh (which would drop it + stamp a new-layout marker).
      await symlink(external, path.join(scopeDir, encodeURIComponent("notes")));
      const store = createStore(rootDir);
      await expect(store.get("session", "s1", "missing")).rejects.toThrow(
        /predates the nested-layout/
      );
    });

    it("refuses to write data under a marker swapped to an incompatible version", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-marker-swap-`));
      const store = createStore(rootDir);
      await store.set("session", "s1", "a", makeValue(1)); // caches layout, stamps v1 marker
      // Another process swaps the marker to a future version this build can't write.
      await writeFile(path.join(rootDir, subdir, MARKER), JSON.stringify({ layout: "nested-v2" }), "utf8");
      // The cached instance's next set must re-validate on EEXIST and refuse.
      await expect(store.set("session", "s1", "b", makeValue(2))).rejects.toThrow(/unexpected version/);
    });

    it("re-scans for legacy data on the publishing set even after a cached fresh read", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-rescan-`));
      const store = createStore(rootDir);
      expect(await store.get("session", "s1", "missing")).toBeUndefined(); // caches "fresh"
      // Another process writes flat legacy files after the cached read; the next
      // set must re-scan before stamping a marker, not trust the stale cache.
      await seedLegacyFile("s1", "notes");
      await expect(store.set("session", "s1", "new", makeValue(1))).rejects.toThrow(
        /predates the nested-layout/
      );
    });

    it("delete refuses a marker swapped to an incompatible version", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-delete-swap-`));
      const store = createStore(rootDir);
      await store.set("session", "s1", "a", makeValue(1)); // caches layout, stamps v1 marker
      await writeFile(path.join(rootDir, subdir, MARKER), JSON.stringify({ layout: "nested-v2" }), "utf8");
      // A destructive op must re-validate — never mutate a layout it can't read.
      await expect(store.delete("session", "s1", "a")).rejects.toThrow(/unexpected version/);
    });

    it("delete re-scans for legacy data after a cached fresh read", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-delete-rescan-`));
      const store = createStore(rootDir);
      expect(await store.get("session", "s1", "missing")).toBeUndefined(); // caches "fresh"
      await seedLegacyFile("s1", "notes");
      // delete must re-scan and refuse rather than rm a flat legacy file.
      await expect(store.delete("session", "s1", "notes")).rejects.toThrow(
        /predates the nested-layout/
      );
    });

    it("counts a legacy resource whose key resembles the marker name as data", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-marker-lookalike-`));
      // A legacy key `.fsdev-store-layout-notes` shares the marker prefix but is
      // NOT a marker temp — it must still trip the guard, not be skipped.
      await seedLegacyFile("s1", ".fsdev-store-layout-notes");
      const store = createStore(rootDir);
      await expect(store.get("session", "s1", "missing")).rejects.toThrow(
        /predates the nested-layout/
      );
    });

    it("rejects a symlinked layout marker instead of trusting it", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-symmarker-`));
      await mkdir(path.join(rootDir, subdir), { recursive: true });
      // An external valid marker the symlink points at — trusting it would skip
      // the legacy scan and silently drop the flat file below.
      const external = path.join(rootDir, "external-marker.json");
      await writeFile(external, JSON.stringify({ layout: "nested-v1" }), "utf8");
      await symlink(external, path.join(rootDir, subdir, MARKER));
      await seedLegacyFile("s1", "notes");
      const store = createStore(rootDir);
      await expect(store.get("session", "s1", "notes")).rejects.toThrow(/symlink/i);
    });

    it("rejects unsafe scope ids", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-scopeid-`));
      const store = createStore(rootDir);
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
      await store.set("session", "s1", "real", makeValue(1)); // stamps marker, creates scope dir
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
      // Seed a valid marker so the legacy scan is skipped — this isolates the
      // ancestor-symlink guard (the scan itself counts a symlink as data).
      await writeFile(path.join(rootDir, subdir, MARKER), JSON.stringify({ layout: "nested-v1" }), "utf8");
      await symlink(outsideDir, path.join(rootDir, subdir, "session"));

      await expect(store.get("session", "s1", "k")).rejects.toThrow(/symlink/i);
      await expect(store.set("session", "s1", "k", makeValue(1))).rejects.toThrow(/symlink/i);
    });

    it("deleteAll unlinks a symlinked scope dir instead of deleting through it", async () => {
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
      expect(await pathExists(scopeLink)).toBe(false); // symlink removed
      expect(await pathExists(keep)).toBe(true); // target dir + contents survive
    });

    it("getByPrefix does not follow a symlinked intermediate directory", async () => {
      const store = await freshStore();
      await store.set("session", "s1", "real", makeValue(1)); // stamps marker, creates scope dir
      const scopeDir = path.join(rootDir, subdir, "session", "s1");
      const outsideDir = path.join(rootDir, "outside");
      await mkdir(path.join(outsideDir, "b"), { recursive: true });
      await writeFile(path.join(outsideDir, "b", `leak${ext}`), "leaked", "utf8");
      await symlink(outsideDir, path.join(scopeDir, "a"));

      // A deep prefix whose intermediate segment `a` is a symlink must not leak.
      expect(await store.getByPrefix("session", "s1", "a/b/x")).toEqual({});
    });

    it("does not stamp the layout marker through a symlinked subtree root", async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), `fsd-${subdir}-symroot-`));
      const outsideDir = path.join(rootDir, "outside");
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, path.join(rootDir, subdir));
      const store = createStore(rootDir);

      await expect(store.set("session", "s1", "k", makeValue(1))).rejects.toThrow(/symlink/i);
      // The ancestor check runs before ensureMarker, so no marker is written
      // through the symlink into the outside directory.
      expect(await pathExists(path.join(outsideDir, MARKER))).toBe(false);
    });
  });
}
