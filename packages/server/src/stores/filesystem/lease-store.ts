/**
 * Filesystem-backed lease store for durable execution (FIX-140).
 *
 * Stores each lease as a JSON file: rootDir/{encodeURIComponent(requestId)}.json
 * One active lease per request at a time.
 */
import { readdir, readFile, rm, mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { Lease, LeaseOptions } from "../../durability/types";
import type { LeaseStore } from "../types";

function leaseFilename(requestId: string): string {
  return `${encodeURIComponent(requestId)}.json`;
}

let leaseCounter = 0;

export class FilesystemLeaseStore implements LeaseStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private filePath(requestId: string): string {
    return path.join(this.rootDir, leaseFilename(requestId));
  }

  private async readLease(requestId: string): Promise<Lease | null> {
    try {
      const raw = await readFile(this.filePath(requestId), "utf8");
      return JSON.parse(raw) as Lease;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async writeLeaseExclusive(lease: Lease): Promise<boolean> {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.filePath(lease.requestId);
    try {
      const fh = await open(target, "wx");
      try {
        await fh.writeFile(JSON.stringify(lease, null, 2), "utf8");
      } finally {
        await fh.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  private async deleteLease(requestId: string): Promise<void> {
    try {
      await rm(this.filePath(requestId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async acquire(requestId: string, options: LeaseOptions): Promise<Lease | null> {
    const now = Date.now();
    const lease: Lease = {
      requestId,
      leaseId: `lease_${++leaseCounter}_${now}`,
      holder: options.holder,
      acquiredAt: now,
      expiresAt: now + options.durationMs
    };

    // Try exclusive create — only one caller can win.
    if (await this.writeLeaseExclusive(lease)) {
      return lease;
    }

    // File exists — check if the existing lease is expired or same holder.
    const existing = await this.readLease(requestId);
    if (existing && existing.expiresAt > now && existing.holder !== options.holder) {
      return null;
    }

    // Expired or same holder — delete and retry exclusive create.
    await this.deleteLease(requestId);
    if (await this.writeLeaseExclusive(lease)) {
      return lease;
    }

    // Another caller raced us on the retry — they won.
    return null;
  }

  async release(requestId: string, leaseId: string): Promise<void> {
    const existing = await this.readLease(requestId);
    if (existing?.leaseId === leaseId) {
      await this.deleteLease(requestId);
    }
  }

  async get(requestId: string): Promise<Lease | null> {
    const lease = await this.readLease(requestId);
    if (!lease) return null;
    if (lease.expiresAt <= Date.now()) {
      await this.deleteLease(requestId);
      return null;
    }
    return lease;
  }

  async pruneExpired(): Promise<void> {
    const now = Date.now();
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(this.rootDir, entry.name);
        try {
          const raw = await readFile(filePath, "utf8");
          const lease = JSON.parse(raw) as Lease;
          if (lease.expiresAt <= now) {
            await rm(filePath);
          }
        } catch {
          // skip corrupt / partial files
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export function createFilesystemLeaseStore(rootDir: string): LeaseStore {
  return new FilesystemLeaseStore(rootDir);
}
