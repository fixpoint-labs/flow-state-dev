/**
 * Filesystem-backed resource state store.
 *
 * Persists each resource state as a nested JSON file under:
 *
 *   rootDir/state/{scopeType}/{scopeId}/…/{leaf}.json
 *
 * The state-layer twin of the filesystem ContentStore. Writes are atomic via
 * temp-file-then-rename, with a one-shot ENOENT retry for concurrent scope churn.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ContentScopeType, ResourceStateStore } from "../types";
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

const LEAF_EXT = ".json";

export class FilesystemResourceStateStore implements ResourceStateStore {
  private readonly rootDir: string;
  private readonly layoutGuard: FilesystemLayoutGuard;

  constructor(rootDir: string) {
    this.rootDir = path.join(rootDir, "state");
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

  async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<JsonObject | undefined> {
    await this.layoutGuard.ensureReadable();
    const scope = this.scopeDir(scopeType, scopeId);
    const target = this.filePath(scopeType, scopeId, resourceKey);
    await assertNoSymlinkOnPath(scope, target);
    const raw = await readUtf8File(target);
    if (raw === undefined) {
      return undefined;
    }
    return JSON.parse(raw) as JsonObject;
  }

  async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, state: JsonObject): Promise<void> {
    await this.layoutGuard.ensureReadable();
    await this.layoutGuard.ensureWritable();
    const scope = this.scopeDir(scopeType, scopeId);
    const target = this.filePath(scopeType, scopeId, resourceKey);
    const label = this.scopeLabel(scopeType, scopeId);
    const serialized = JSON.stringify(state);

    for (let attempt = 0; ; attempt += 1) {
      await assertNoSymlinkOnPath(scope, target);
      try {
        await mkdirParents(target);
        await atomicWriteUtf8(target, serialized);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" && attempt === 0) {
          continue;
        }
        wrapFilesystemCollision(error, label, resourceKey, target);
      }
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

  async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, JsonObject>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, JsonObject>> {
    await this.layoutGuard.ensureReadable();
    const scope = this.scopeDir(scopeType, scopeId);
    const records = await collectRecords(scope, LEAF_EXT, keyPrefix);
    const result: Record<string, JsonObject> = {};
    for (const { resourceKey, absolutePath } of records) {
      const raw = await readUtf8File(absolutePath);
      if (raw !== undefined) {
        result[resourceKey] = JSON.parse(raw) as JsonObject;
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

export function createFilesystemResourceStateStore(rootDir: string): ResourceStateStore {
  return new FilesystemResourceStateStore(rootDir);
}
