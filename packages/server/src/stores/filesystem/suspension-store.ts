/**
 * Filesystem-backed suspension record store for durable execution (FIX-140).
 *
 * Stores each suspension as a JSON file under:
 *   rootDir/{encodeURIComponent(requestId)}/{encodeURIComponent(suspensionId)}.json
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SuspensionFilter, SuspensionRecord } from "@flow-state-dev/core/types";
import type { SuspensionStore } from "../types";

function encodeDir(id: string): string {
  return encodeURIComponent(id);
}

function encodeFilename(id: string): string {
  return `${encodeURIComponent(id)}.json`;
}

export class FilesystemSuspensionStore implements SuspensionStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private requestDir(requestId: string): string {
    return path.join(this.rootDir, encodeDir(requestId));
  }

  private filePath(requestId: string, suspensionId: string): string {
    return path.join(this.requestDir(requestId), encodeFilename(suspensionId));
  }

  async set(record: SuspensionRecord): Promise<void> {
    const dir = this.requestDir(record.requestId);
    await mkdir(dir, { recursive: true });

    const target = this.filePath(record.requestId, record.suspensionId);
    const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await writeFile(tempPath, JSON.stringify(record, null, 2), "utf8");
    await rename(tempPath, target);
  }

  async get(requestId: string, suspensionId: string): Promise<SuspensionRecord | null> {
    try {
      const content = await readFile(this.filePath(requestId, suspensionId), "utf8");
      return JSON.parse(content) as SuspensionRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async list(filter?: SuspensionFilter): Promise<SuspensionRecord[]> {
    let results: SuspensionRecord[] = [];

    try {
      const requestDirs = await readdir(this.rootDir, { withFileTypes: true });
      for (const entry of requestDirs) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(this.rootDir, entry.name);
        const files = await readdir(dirPath, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".json")) continue;
          try {
            const raw = await readFile(path.join(dirPath, file.name), "utf8");
            results.push(JSON.parse(raw) as SuspensionRecord);
          } catch {
            // skip corrupt / partial files
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    if (filter?.flowKind) {
      results = results.filter((r) => r.flowKind === filter.flowKind);
    }
    if (filter?.userId) {
      results = results.filter((r) => r.userId === filter.userId);
    }
    if (filter?.sessionId) {
      results = results.filter((r) => r.sessionId === filter.sessionId);
    }
    if (filter?.status) {
      results = results.filter((r) => r.status === filter.status);
    }

    results.sort((a, b) => b.createdAt - a.createdAt);

    if (filter?.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async deleteForRequest(requestId: string): Promise<void> {
    const dir = this.requestDir(requestId);
    try {
      await rm(dir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export function createFilesystemSuspensionStore(rootDir: string): SuspensionStore {
  return new FilesystemSuspensionStore(rootDir);
}
