/**
 * Filesystem-backed content store.
 *
 * Stores each resource's content as an individual file under a directory
 * structure organized by scope type and scope ID:
 *
 *   rootDir/content/{scopeType}/{scopeId}/{encodedResourceKey}
 *
 * Resource keys are URI-encoded for filesystem safety (consistent with
 * the existing scope record ID encoding pattern). Uses atomic writes
 * via temp-file-then-rename to prevent partial-write corruption.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentScopeType, ContentStore } from "../types";

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function decodePath(value: string): string {
  return decodeURIComponent(value);
}

export class FilesystemContentStore implements ContentStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.join(rootDir, "content");
  }

  private scopeDir(scopeType: ContentScopeType, scopeId: string): string {
    return path.join(this.rootDir, scopeType, encodePath(scopeId));
  }

  private filePath(scopeType: ContentScopeType, scopeId: string, resourceKey: string): string {
    return path.join(this.scopeDir(scopeType, scopeId), encodePath(resourceKey));
  }

  async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<string | undefined> {
    try {
      return await readFile(this.filePath(scopeType, scopeId, resourceKey), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, content: string): Promise<void> {
    const dir = this.scopeDir(scopeType, scopeId);
    await mkdir(dir, { recursive: true });

    const target = this.filePath(scopeType, scopeId, resourceKey);
    const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, target);
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

  async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, string>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, string>> {
    const dir = this.scopeDir(scopeType, scopeId);
    const result: Record<string, string> = {};

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
      const content = await readFile(filePath, "utf8");
      result[resourceKey] = content;
    }

    return result;
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    const dir = this.scopeDir(scopeType, scopeId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export function createFilesystemContentStore(rootDir: string): ContentStore {
  return new FilesystemContentStore(rootDir);
}
