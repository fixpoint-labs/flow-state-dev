/**
 * Filesystem-backed resource state store.
 *
 * Stores each resource's state as an individual JSON file under a directory
 * structure organized by scope type and scope ID:
 *
 *   rootDir/state/{scopeType}/{scopeId}/{encodedResourceKey}
 *
 * The state-layer twin of the filesystem ContentStore. Resource keys are
 * URI-encoded for filesystem safety; writes are atomic via temp-file-then-
 * rename to prevent partial-write corruption.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ContentScopeType, ResourceStateStore } from "../types";

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function decodePath(value: string): string {
  return decodeURIComponent(value);
}

export class FilesystemResourceStateStore implements ResourceStateStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.join(rootDir, "state");
  }

  private scopeDir(scopeType: ContentScopeType, scopeId: string): string {
    return path.join(this.rootDir, scopeType, encodePath(scopeId));
  }

  private filePath(scopeType: ContentScopeType, scopeId: string, resourceKey: string): string {
    return path.join(this.scopeDir(scopeType, scopeId), encodePath(resourceKey));
  }

  async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<JsonObject | undefined> {
    try {
      const raw = await readFile(this.filePath(scopeType, scopeId, resourceKey), "utf8");
      return JSON.parse(raw) as JsonObject;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, state: JsonObject): Promise<void> {
    const dir = this.scopeDir(scopeType, scopeId);
    const target = this.filePath(scopeType, scopeId, resourceKey);
    const serialized = JSON.stringify(state);

    // The scope dir is created here, but it can be transiently absent at write
    // time: concurrent writers racing to create a fresh scope tree (node's
    // recursive `mkdir`), or a sibling request tearing the scope down, can leave
    // the `writeFile`/`rename` to ENOENT on the just-ensured directory. That
    // surfaced as a hard import failure ("nothing happened") with a stray
    // `…/holdings%2F…__VRSK.tmp-…` path. Re-create the dir and retry once; a
    // second ENOENT (or any other error) is real and propagates.
    for (let attempt = 0; ; attempt += 1) {
      await mkdir(dir, { recursive: true });
      const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        await writeFile(tempPath, serialized, "utf8");
        await rename(tempPath, target);
        return;
      } catch (error) {
        // Best-effort cleanup of the orphaned temp file (it may not exist).
        await rm(tempPath, { force: true }).catch(() => {});
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && attempt === 0) {
          continue;
        }
        throw error;
      }
    }
  }

  async delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void> {
    try {
      await rm(this.filePath(scopeType, scopeId, resourceKey));
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
    const dir = this.scopeDir(scopeType, scopeId);
    const result: Record<string, JsonObject> = {};

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return result;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) {
        continue;
      }
      const resourceKey = decodePath(entry.name);
      if (!resourceKey.startsWith(keyPrefix)) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      const raw = await readFile(filePath, "utf8");
      result[resourceKey] = JSON.parse(raw) as JsonObject;
    }

    return result;
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    // `force: true` already treats a missing path as success, so no ENOENT guard.
    await rm(this.scopeDir(scopeType, scopeId), { recursive: true, force: true });
  }
}

export function createFilesystemResourceStateStore(rootDir: string): ResourceStateStore {
  return new FilesystemResourceStateStore(rootDir);
}
