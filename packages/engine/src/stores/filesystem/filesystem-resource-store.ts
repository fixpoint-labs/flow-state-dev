/**
 * Generic filesystem-backed keyed-resource store. The single CRUD
 * implementation behind both `ContentStore` (`.md` string bodies) and
 * `ResourceStateStore` (`.json` state) — a resource key maps to a nested
 * on-disk path with a leaf extension, so the store root is a browsable file
 * tree (`set("session","s1","concepts/x/overview", body)` →
 * `<root>/content/session/s1/concepts/x/overview.md`).
 *
 * The factory owns every guard: scope-id validation + containment, per-op
 * symlink safety (ancestors and leaf), collision surfacing, and the one-shot
 * ENOENT-retry atomic write both stores share. The two public stores are thin config over this.
 */
import { lstat, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isWindowsReservedName } from "@flow-state-dev/core/helpers";
import type { StorageScopeType } from "../types";
import {
  collectRecords,
  keyToRelativePath
} from "./resource-path";

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
  get(scopeType: StorageScopeType, scopeId: string, resourceKey: string): Promise<T | undefined>;
  set(scopeType: StorageScopeType, scopeId: string, resourceKey: string, value: T): Promise<void>;
  delete(scopeType: StorageScopeType, scopeId: string, resourceKey: string): Promise<void>;
  getAll(scopeType: StorageScopeType, scopeId: string): Promise<Record<string, T>>;
  getByPrefix(
    scopeType: StorageScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, T>>;
  deleteAll(scopeType: StorageScopeType, scopeId: string): Promise<void>;
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

class FilesystemResourceStore<T> implements KeyedResourceStore<T> {
  private readonly root: string;
  private readonly ext: string;
  private readonly serialize: (value: T) => string;
  private readonly deserialize: (raw: string) => T;

  constructor(options: FilesystemResourceStoreOptions<T>) {
    this.root = path.join(options.rootDir, options.subdir);
    this.ext = options.ext;
    this.serialize = options.serialize;
    this.deserialize = options.deserialize;
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

  private scopeDir(scopeType: StorageScopeType, scopeId: string): string {
    this.validateScopeId(scopeId);
    // `encodeURIComponent` escapes "/", so a "/"-bearing scope id stays one
    // flat dir rather than nesting.
    const dir = path.join(this.root, scopeType, encodeURIComponent(scopeId));
    const base = path.resolve(path.join(this.root, scopeType));
    if (!path.resolve(dir).startsWith(base + path.sep)) {
      throw new Error(`scopeId ${JSON.stringify(scopeId)} escapes the store root`);
    }
    return dir;
  }

  private filePath(scopeType: StorageScopeType, scopeId: string, resourceKey: string): string {
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

  private collisionError(
    error: unknown,
    scopeType: StorageScopeType,
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
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<T | undefined> {
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
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string,
    value: T
  ): Promise<void> {
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
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<void> {
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

  async getAll(scopeType: StorageScopeType, scopeId: string): Promise<Record<string, T>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: StorageScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, T>> {
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

  async deleteAll(scopeType: StorageScopeType, scopeId: string): Promise<void> {
    const dir = this.scopeDir(scopeType, scopeId);
    await this.assertAncestorsSafe(dir);
    let stat;
    try {
      stat = await lstat(dir);
    } catch (error) {
      if (errno(error) === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      await unlink(dir); // unlink the link itself, never rm -rf through it
    } else {
      await rm(dir, { recursive: true, force: true });
    }
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

