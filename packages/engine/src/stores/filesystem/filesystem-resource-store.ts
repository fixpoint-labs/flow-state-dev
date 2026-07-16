/**
 * Generic filesystem-backed keyed-resource store. The single CRUD
 * implementation behind both `ContentStore` (`.md` string bodies) and
 * `ResourceStateStore` (`.json` state) — a resource key maps to a nested
 * on-disk path with a leaf extension, so the store root is a browsable file
 * tree (`set("session","s1","concepts/x/overview", body)` →
 * `<root>/content/session/s1/concepts/x/overview.md`).
 *
 * The factory owns every guard: scope-id validation + containment, per-op
 * symlink safety (ancestors and leaf), a durable clean-break legacy marker
 * (BP-030), collision surfacing, and the one-shot ENOENT-retry atomic write
 * both stores share. The two public stores are thin config over this.
 */
import { lstat, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentScopeType } from "../types";
import {
  collectRecords,
  isWindowsReservedName,
  keyToRelativePath
} from "./resource-path";

/** Basename of the durable per-subtree layout marker file. */
const LAYOUT_MARKER_NAME = ".fsdev-store-layout";
/** Current on-disk layout tag stored in the marker. */
const LAYOUT_VERSION = "nested-v1";

/**
 * Files that never count as "real data" when the legacy guard scans an
 * unmarked subtree — ubiquitous OS/VCS metadata a fresh vault may carry.
 */
const METADATA_FILE_DENYLIST: ReadonlySet<string> = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".gitignore",
  ".gitkeep"
]);

/**
 * Directories descended-into but never counted as data by the legacy guard —
 * dot-dirs are NOT blanket-skipped (a scope id may legitimately start with "."),
 * only these known metadata directories are.
 */
const METADATA_DIRS: ReadonlySet<string> = new Set([".git", ".obsidian", ".svn", ".hg"]);

/** Configuration for {@link createFilesystemResourceStore}. */
export type FilesystemResourceStoreOptions<T> = {
  /** Registry root; the store owns `join(rootDir, subdir)`. */
  rootDir: string;
  /** Subtree under `rootDir` — `"content"` or `"state"`. */
  subdir: string;
  /** Leaf extension applied to every resource file — `".md"` or `".json"`. */
  ext: string;
  /** Serialize a value to its on-disk string form. */
  serialize: (value: T) => string;
  /** Parse an on-disk string back into a value. */
  deserialize: (raw: string) => T;
};

/** The six-method keyed-resource-store contract shared by both public stores. */
export interface KeyedResourceStore<T> {
  get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<T | undefined>;
  set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, value: T): Promise<void>;
  delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void>;
  getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, T>>;
  getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, T>>;
  deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void>;
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

class FilesystemResourceStore<T> implements KeyedResourceStore<T> {
  private readonly root: string;
  private readonly ext: string;
  private readonly serialize: (value: T) => string;
  private readonly deserialize: (raw: string) => T;
  private readonly markerPath: string;
  /** Memoized layout resolution — cached on SUCCESS only (see ensureLayout). */
  private layoutPromise?: Promise<void>;

  constructor(options: FilesystemResourceStoreOptions<T>) {
    this.root = path.join(options.rootDir, options.subdir);
    this.ext = options.ext;
    this.serialize = options.serialize;
    this.deserialize = options.deserialize;
    this.markerPath = path.join(this.root, LAYOUT_MARKER_NAME);
  }

  // --- path building + validation -----------------------------------------

  private validateScopeId(scopeId: string): void {
    if (
      scopeId === "" ||
      scopeId === "." ||
      scopeId === ".." ||
      isWindowsReservedName(scopeId)
    ) {
      throw new Error(`Invalid scopeId ${JSON.stringify(scopeId)}`);
    }
  }

  private scopeDir(scopeType: ContentScopeType, scopeId: string): string {
    this.validateScopeId(scopeId);
    // `encodeURIComponent` (NOT encodeSegment) keeps the scope dir name
    // byte-identical to the legacy layout, so a dotted userId (e.g. an email)
    // maps to the same dir the flat store used and the legacy guard/deleteAll
    // stay consistent. It also escapes "/", so a "/"-bearing scope id stays one
    // flat dir rather than nesting.
    const dir = path.join(this.root, scopeType, encodeURIComponent(scopeId));
    const base = path.resolve(path.join(this.root, scopeType));
    if (!path.resolve(dir).startsWith(base + path.sep)) {
      throw new Error(`scopeId ${JSON.stringify(scopeId)} escapes the store root`);
    }
    return dir;
  }

  private filePath(scopeType: ContentScopeType, scopeId: string, resourceKey: string): string {
    return path.join(this.scopeDir(scopeType, scopeId), keyToRelativePath(resourceKey, this.ext));
  }

  /**
   * Reject if any EXISTING ancestor directory of `target` — from `this.root`
   * down to (but excluding) `target` — is a symlink. Stops at the first
   * not-yet-created segment (a fresh scope has none). Guards against a recursive
   * `mkdir`/`rm` walking through a symlinked ancestor to escape the store.
   */
  private async assertAncestorsSafe(target: string): Promise<void> {
    const rel = path.relative(this.root, target);
    const parts = rel.split(path.sep);
    let dir = this.root;
    const chain = [dir];
    for (let i = 0; i < parts.length - 1; i += 1) {
      dir = path.join(dir, parts[i]);
      chain.push(dir);
    }
    for (const ancestor of chain) {
      let stat;
      try {
        stat = await lstat(ancestor);
      } catch (error) {
        if (errno(error) === "ENOENT") break;
        throw error;
      }
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to traverse symlinked store path: ${ancestor}`);
      }
    }
  }

  // --- legacy layout guard (BP-030) ---------------------------------------

  private ensureLayout(): Promise<void> {
    return (this.layoutPromise ??= this.resolveLayout().catch((error) => {
      // Cache SUCCESS only: clear so a later op re-scans once the operator
      // moves/deletes the offending subtree.
      this.layoutPromise = undefined;
      throw error;
    }));
  }

  private async resolveLayout(): Promise<void> {
    let markerRaw: string | undefined;
    try {
      markerRaw = await readFile(this.markerPath, "utf8");
    } catch (error) {
      if (errno(error) !== "ENOENT") {
        // Marker present but unreadable — refuse to trust the subtree.
        throw new Error(
          `Filesystem store layout marker at ${this.markerPath} is unreadable: ${String(error)}`
        );
      }
    }

    if (markerRaw !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(markerRaw);
      } catch {
        throw new Error(`Filesystem store layout marker at ${this.markerPath} is corrupt`);
      }
      if ((parsed as { layout?: unknown } | null)?.layout !== LAYOUT_VERSION) {
        throw new Error(
          `Filesystem store layout marker at ${this.markerPath} has an unexpected version; expected "${LAYOUT_VERSION}"`
        );
      }
      return;
    }

    if (await this.subtreeHasDataFile(this.root)) {
      throw new Error(
        `Filesystem store subtree at ${this.root} predates the nested-layout change; ` +
          `will not read its flat files — move it aside or delete it.`
      );
    }
    // Fresh (empty / only empty dirs / only denylisted metadata): proceed
    // WITHOUT writing anything, so read-only deployments and fresh-root probes
    // stay non-mutating. The marker is a `set` responsibility.
  }

  /** True if `dir`'s subtree holds ≥1 real data file. Short-circuits on the first. */
  private async subtreeHasDataFile(dir: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (errno(error) === "ENOENT") return false;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow a symlinked dir/file
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (METADATA_DIRS.has(entry.name)) continue;
        if (await this.subtreeHasDataFile(full)) return true;
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === LAYOUT_MARKER_NAME) continue;
      if (METADATA_FILE_DENYLIST.has(entry.name)) continue;
      return true; // a real data file
    }
    return false;
  }

  /**
   * Ensure the layout marker exists before the first data file of a `set`
   * lands. Create-exclusive (`wx`) + EEXIST-tolerant so it stamps once and
   * closes the read-then-set gap where a cold read cached "fresh, unmarked".
   */
  private async ensureMarker(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      await writeFile(this.markerPath, JSON.stringify({ layout: LAYOUT_VERSION }), {
        flag: "wx"
      });
    } catch (error) {
      if (errno(error) !== "EEXIST") throw error;
    }
  }

  private collisionError(
    error: unknown,
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string,
    target: string
  ): unknown {
    const code = errno(error);
    if (code === "EEXIST" || code === "ENOTDIR" || code === "EISDIR") {
      return new Error(
        `Resource key collision in ${scopeType}/${scopeId} for key ${JSON.stringify(resourceKey)}: ` +
          `path "${target}" is needed as both a file and a directory (${code}).`
      );
    }
    return error;
  }

  // --- the six methods ----------------------------------------------------

  async get(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<T | undefined> {
    await this.ensureLayout();
    const target = this.filePath(scopeType, scopeId, resourceKey);
    await this.assertAncestorsSafe(target);
    let stat;
    try {
      stat = await lstat(target);
    } catch (error) {
      if (errno(error) === "ENOENT") return undefined;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to read symlinked resource file: ${target}`);
    }
    return this.deserialize(await readFile(target, "utf8"));
  }

  async set(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string,
    value: T
  ): Promise<void> {
    await this.ensureLayout();
    await this.ensureMarker();
    const target = this.filePath(scopeType, scopeId, resourceKey);
    const parentDir = path.dirname(target);
    const serialized = this.serialize(value);
    await this.assertAncestorsSafe(target);

    // The parent dir can be transiently absent at write time — concurrent
    // writers racing the recursive mkdir on a fresh scope, or a sibling request
    // tearing the scope down — so re-create and retry once on ENOENT.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await mkdir(parentDir, { recursive: true });
      } catch (error) {
        throw this.collisionError(error, scopeType, scopeId, resourceKey, target);
      }
      const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      try {
        await writeFile(tempPath, serialized, "utf8");
        await rename(tempPath, target);
        return;
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => {});
        if (errno(error) === "ENOENT" && attempt === 0) continue;
        throw this.collisionError(error, scopeType, scopeId, resourceKey, target);
      }
    }
  }

  async delete(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<void> {
    await this.ensureLayout();
    const target = this.filePath(scopeType, scopeId, resourceKey);
    await this.assertAncestorsSafe(target);
    let stat;
    try {
      stat = await lstat(target);
    } catch (error) {
      if (errno(error) === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to delete symlinked resource file: ${target}`);
    }
    try {
      await rm(target);
    } catch (error) {
      if (errno(error) !== "ENOENT") throw error;
    }
  }

  async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, T>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, T>> {
    await this.ensureLayout();
    const dir = this.scopeDir(scopeType, scopeId);
    await this.assertAncestorsSafe(dir);
    const records = await collectRecords(dir, this.ext, keyPrefix);
    const result: Record<string, T> = {};
    for (const record of records) {
      if (!record.resourceKey.startsWith(keyPrefix)) continue;
      const raw = await readFile(record.absolutePath, "utf8");
      result[record.resourceKey] = this.deserialize(raw);
    }
    return result;
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    // Skips the legacy guard: an upgraded install with legacy data must be able
    // to tear a scope down without a read first.
    const dir = this.scopeDir(scopeType, scopeId);
    await this.assertAncestorsSafe(dir);
    let stat;
    try {
      stat = await lstat(dir);
    } catch (error) {
      if (errno(error) === "ENOENT") {
        this.layoutPromise = undefined;
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      await unlink(dir); // unlink the link itself, never rm -rf through it
    } else {
      await rm(dir, { recursive: true, force: true });
    }
    // Re-scan next op: after deleting a legacy scope's files the subtree may now
    // be fresh (empty scaffolding doesn't count as data).
    this.layoutPromise = undefined;
  }
}

/**
 * Create a filesystem-backed keyed-resource store. See
 * {@link FilesystemResourceStoreOptions}. Used by `content-store.ts`
 * (`.md`, identity serialize) and `resource-state-store.ts` (`.json`, JSON
 * serialize).
 */
export function createFilesystemResourceStore<T>(
  options: FilesystemResourceStoreOptions<T>
): KeyedResourceStore<T> {
  return new FilesystemResourceStore<T>(options);
}
