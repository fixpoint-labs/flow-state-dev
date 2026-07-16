/**
 * Filesystem-backed content store.
 *
 * Persists each resource as a nested file under:
 *
 *   rootDir/content/{scopeType}/{scopeId}/…/{leaf}.md
 *
 * Resource keys map to real directories; scope ids use URI encoding (legacy parity).
 * Writes are atomic via temp-file-then-rename.
 */
import path from "node:path";
import type { ContentScopeType, ContentStore } from "../types";
import { FilesystemLayoutGuard } from "./layout-guard";
import {
  assertPathUnderRoot,
  collectRecords,
  encodeScopeId,
  keyToRelativePath
} from "./resource-path";
import {
  assertNoSymlinkOnPath,
  atomicWriteUtf8,
  mkdirParents,
  readUtf8File,
  removeScopeDirectory,
  wrapFilesystemCollision
} from "./resource-path-safety";
import { rm } from "node:fs/promises";

const LEAF_EXT = ".md";

export class FilesystemContentStore implements ContentStore {
  private readonly rootDir: string;
  private readonly layoutGuard: FilesystemLayoutGuard;

  constructor(rootDir: string) {
    this.rootDir = path.join(rootDir, "content");
    this.layoutGuard = new FilesystemLayoutGuard(this.rootDir);
  }

  private scopeDir(scopeType: ContentScopeType, scopeId: string): string {
    const encoded = encodeScopeId(scopeId);
    const dir = path.join(this.rootDir, scopeType, encoded);
    assertPathUnderRoot(dir, this.rootDir);
    return dir;
  }

  private filePath(scopeType: ContentScopeType, scopeId: string, resourceKey: string): string {
    const scope = this.scopeDir(scopeType, scopeId);
    const rel = keyToRelativePath(resourceKey, LEAF_EXT);
    const target = path.join(scope, rel);
    assertPathUnderRoot(target, scope);
    return target;
  }

  private scopeLabel(scopeType: ContentScopeType, scopeId: string): string {
    return `${scopeType}/${scopeId}`;
  }

  async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<string | undefined> {
    await this.layoutGuard.ensureReadable();
    const target = this.filePath(scopeType, scopeId, resourceKey);
    const scope = this.scopeDir(scopeType, scopeId);
    await assertNoSymlinkOnPath(scope, target);
    return readUtf8File(target);
  }

  async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, content: string): Promise<void> {
    await this.layoutGuard.ensureReadable();
    await this.layoutGuard.ensureWritable();
    const scope = this.scopeDir(scopeType, scopeId);
    const target = this.filePath(scopeType, scopeId, resourceKey);
    const label = this.scopeLabel(scopeType, scopeId);
    await assertNoSymlinkOnPath(scope, target);
    try {
      await mkdirParents(target);
      await atomicWriteUtf8(target, content);
    } catch (error) {
      wrapFilesystemCollision(error, label, resourceKey, target);
    }
  }

  async delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void> {
    await this.layoutGuard.ensureReadable();
    const scope = this.scopeDir(scopeType, scopeId);
    const target = this.filePath(scopeType, scopeId, resourceKey);
    await assertNoSymlinkOnPath(scope, target);
    try {
      await rm(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, string>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, string>> {
    await this.layoutGuard.ensureReadable();
    const scope = this.scopeDir(scopeType, scopeId);
    const records = await collectRecords(scope, LEAF_EXT, keyPrefix);
    const result: Record<string, string> = {};
    for (const { resourceKey, absolutePath } of records) {
      const content = await readUtf8File(absolutePath);
      if (content !== undefined) {
        result[resourceKey] = content;
      }
    }
    return result;
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    this.layoutGuard.clearCache();
    const scope = this.scopeDir(scopeType, scopeId);
    await removeScopeDirectory(this.rootDir, scope);
  }
}

export function createFilesystemContentStore(rootDir: string): ContentStore {
  return new FilesystemContentStore(rootDir);
}
