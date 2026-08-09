import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  PersistErrorHandler
} from "../types";
import { withActiveRequestSourceDefault } from "../shared";
import { atomicWriteFile } from "../../utils/atomic-write";
import {
  createSerializedWriteQueue,
  type SerializedWriteQueue
} from "../../utils/serialized-write-queue";

type RegistryFile = {
  entries: Record<string, ActiveRequestEntry>;
  updatedAt: number;
};

export type FilesystemActiveRequestRegistryOptions = {
  /** Directory where the registry file lives. */
  directory: string;
  /** Filename. Default: 'active-requests.json' */
  filename?: string;
  /** fsync before rename. Default: true */
  fsync?: boolean;
  /**
   * Fired on a registry write failure before the safety-net log (FIX-406 6B).
   */
  onPersistError?: PersistErrorHandler;
};

export class FilesystemActiveRequestRegistry implements ActiveRequestRegistry {
  /**
   * The registry file may sit on a volume every worker mounts, or in a
   * per-process temp dir — and this adapter cannot tell which from its own
   * construction. Where it cannot know, it declares not shared (FIX-999), so a
   * deployment that really is shared gets liveness refused rather than a
   * deployment that is not getting liveness that lies.
   */
  readonly sharedAcrossProcesses = false;

  private readonly filePath: string;
  private readonly directory: string;
  private readonly fsync: boolean;
  private readonly writeQueue: SerializedWriteQueue;

  constructor(options: FilesystemActiveRequestRegistryOptions) {
    this.directory = options.directory;
    this.filePath = path.join(
      options.directory,
      options.filename ?? "active-requests.json"
    );
    this.fsync = options.fsync ?? true;
    const onPersistError = options.onPersistError;
    this.writeQueue = createSerializedWriteQueue({
      label: "active-request-registry",
      onError: (err) => {
        onPersistError?.({ store: "activeRequests", id: this.filePath, error: err });
        console.error("[flow-state] active request registry write failed", err);
      }
    });
  }

  /**
   * Clean up any leftover temp files from a previous crash.
   * Call once on startup.
   */
  async cleanupTempFiles(): Promise<void> {
    // We use a pattern-based temp suffix, so just look for .tmp-* files
    // in the directory. For simplicity, we only clean the well-known temp path.
    const tempGlob = `${this.filePath}.tmp-`;
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(this.directory);
      for (const entry of entries) {
        const fullPath = path.join(this.directory, entry);
        if (fullPath.startsWith(tempGlob)) {
          await rm(fullPath, { force: true });
        }
      }
    } catch {
      // Directory may not exist yet — that's fine
    }
  }

  async register(entry: ActiveRequestEntry): Promise<void> {
    this.writeQueue.enqueue(async () => {
      const data = await this.readFile();
      data.entries[entry.requestId] = { ...entry };
      data.updatedAt = Date.now();
      await this.writeFile(data);
    });
    await this.writeQueue.drain();
  }

  async heartbeat(requestId: string): Promise<void> {
    this.writeQueue.enqueue(async () => {
      const data = await this.readFile();
      const entry = data.entries[requestId];
      if (entry !== undefined) {
        entry.lastHeartbeatAt = Date.now();
        data.updatedAt = Date.now();
        await this.writeFile(data);
      }
    });
    await this.writeQueue.drain();
  }

  async deregister(requestId: string): Promise<void> {
    this.writeQueue.enqueue(async () => {
      const data = await this.readFile();
      if (data.entries[requestId] === undefined) {
        return;
      }
      delete data.entries[requestId];
      data.updatedAt = Date.now();
      await this.writeFile(data);
    });
    await this.writeQueue.drain();
  }

  async listStale(thresholdMs: number): Promise<ActiveRequestEntry[]> {
    const data = await this.readFile();
    const cutoff = Date.now() - thresholdMs;
    const stale: ActiveRequestEntry[] = [];
    for (const entry of Object.values(data.entries)) {
      if (entry.lastHeartbeatAt < cutoff) {
        stale.push(withActiveRequestSourceDefault({ ...entry }));
      }
    }
    return stale;
  }

  async listAll(): Promise<ActiveRequestEntry[]> {
    const data = await this.readFile();
    return Object.values(data.entries).map((e) =>
      withActiveRequestSourceDefault({ ...e })
    );
  }

  async get(requestId: string): Promise<ActiveRequestEntry | undefined> {
    const data = await this.readFile();
    const entry = data.entries[requestId];
    return entry === undefined
      ? undefined
      : withActiveRequestSourceDefault({ ...entry });
  }

  private async readFile(): Promise<RegistryFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as RegistryFile;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof parsed.entries === "object" &&
        parsed.entries !== null
      ) {
        return parsed;
      }
      // Corrupt structure — treat as empty
      console.warn(
        "[flow-state] active request registry has unexpected structure, starting fresh"
      );
      return { entries: {}, updatedAt: Date.now() };
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code === "ENOENT") {
        return { entries: {}, updatedAt: Date.now() };
      }
      if (error instanceof SyntaxError) {
        // Corrupt JSON — rename for debugging and start fresh
        console.warn(
          "[flow-state] active request registry file is corrupt, starting fresh"
        );
        try {
          await rename(
            this.filePath,
            this.filePath.replace(".json", ".corrupt.json")
          );
        } catch {
          // Best effort
        }
        return { entries: {}, updatedAt: Date.now() };
      }
      throw error;
    }
  }

  private async writeFile(data: RegistryFile): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await atomicWriteFile(
      this.filePath,
      JSON.stringify(data, null, 2),
      { fsync: this.fsync }
    );
  }
}

export function createFilesystemActiveRequestRegistry(
  options: FilesystemActiveRequestRegistryOptions
): ActiveRequestRegistry {
  return new FilesystemActiveRequestRegistry(options);
}
