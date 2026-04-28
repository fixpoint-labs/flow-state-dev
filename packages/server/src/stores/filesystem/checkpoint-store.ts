/**
 * Filesystem-backed sequencer checkpoint store (FIX-401).
 *
 * Stores each checkpoint as a single JSON file under:
 *
 *   rootDir/checkpoints/{encodedRequestId}/{encodedBlockInstanceId}.json
 *
 * Latest-only: `write` overwrites the existing file via atomic temp-write +
 * rename so a crash mid-write never leaves a partially serialized record.
 * Identity (`requestId`, `blockInstanceId`) is URI-encoded for filesystem
 * safety — consistent with the existing scope record encoding pattern.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SequencerCheckpoint } from "@flow-state-dev/core/types";
import type { CheckpointStore } from "../types";

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

export class FilesystemCheckpointStore implements CheckpointStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.join(rootDir, "checkpoints");
  }

  private requestDir(requestId: string): string {
    return path.join(this.rootDir, encodePath(requestId));
  }

  private filePath(requestId: string, blockInstanceId: string): string {
    return path.join(this.requestDir(requestId), `${encodePath(blockInstanceId)}.json`);
  }

  async write(checkpoint: SequencerCheckpoint): Promise<void> {
    const dir = this.requestDir(checkpoint.requestId);
    await mkdir(dir, { recursive: true });

    const target = this.filePath(checkpoint.requestId, checkpoint.blockInstanceId);
    const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await writeFile(tempPath, JSON.stringify(checkpoint), "utf8");
    await rename(tempPath, target);
  }

  async latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null> {
    try {
      const content = await readFile(this.filePath(requestId, blockInstanceId), "utf8");
      return JSON.parse(content) as SequencerCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(requestId: string, blockInstanceId: string): Promise<void> {
    try {
      await rm(this.filePath(requestId, blockInstanceId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export function createFilesystemCheckpointStore(rootDir: string): CheckpointStore {
  return new FilesystemCheckpointStore(rootDir);
}
