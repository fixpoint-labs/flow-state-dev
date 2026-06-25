/**
 * Filesystem-backed sequencer checkpoint store (FIX-401).
 *
 * Stores each checkpoint as a single JSON file under:
 *
 *   rootDir/checkpoints/{encodeURIComponent(requestId)}/{sha256(blockInstanceId)[:32]}.json
 *
 * The basename is derived from a truncated SHA-256 digest of the
 * `blockInstanceId` so deeply-nested compositions (pattern skills, FIX-654)
 * never overflow the 255-byte per-component filesystem limit. The canonical
 * `blockInstanceId` is preserved in the JSON body so DevTool, logs, and
 * operator inspection are unaffected. Latest-only: `write` overwrites the
 * existing file via atomic temp-write + rename so a crash mid-write never
 * leaves a partially serialized record.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SequencerCheckpoint } from "@flow-state-dev/core/types";
import type { CheckpointStore } from "../types";

// 128 bits of SHA-256, hex-encoded. P(collision) < 1e-12 at 10^10 checkpoints,
// six orders of magnitude past any realistic on-disk volume for this store.
// Hex (lowercase) is safe on case-insensitive filesystems (APFS default);
// base32/base64 are not.
const FILENAME_HASH_HEX_CHARS = 32;

function encodeRequestDir(requestId: string): string {
  return encodeURIComponent(requestId);
}

/**
 * Returns the on-disk basename for a checkpoint. The hash bounds filename
 * length regardless of composition depth; the canonical `blockInstanceId`
 * lives in the JSON body for operator inspection.
 */
function checkpointFilename(blockInstanceId: string): string {
  const digest = createHash("sha256").update(blockInstanceId, "utf8").digest("hex");
  return `${digest.slice(0, FILENAME_HASH_HEX_CHARS)}.json`;
}

export class FilesystemCheckpointStore implements CheckpointStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.join(rootDir, "checkpoints");
  }

  private requestDir(requestId: string): string {
    return path.join(this.rootDir, encodeRequestDir(requestId));
  }

  private filePath(requestId: string, blockInstanceId: string): string {
    return path.join(this.requestDir(requestId), checkpointFilename(blockInstanceId));
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

  async deleteForRequest(requestId: string): Promise<void> {
    try {
      await rm(this.requestDir(requestId), { recursive: true });
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
