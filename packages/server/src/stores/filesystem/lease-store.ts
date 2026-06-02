/**
 * Filesystem-backed lease store for durable execution (FIX-140).
 *
 * Stores each lease as a JSON file: rootDir/{encodeURIComponent(requestId)}.json
 * One active lease per request at a time.
 */
import { readdir, readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
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

  private async writeLease(lease: Lease): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.filePath(lease.requestId);
    const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(tempPath, JSON.stringify(lease, null, 2), "utf8");
    await rename(tempPath, target);
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
    const existing = await this.readLease(requestId);

    if (existing && existing.expiresAt > now && existing.holder !== options.holder) {
      return null;
    }

    const lease: Lease = {
      requestId,
      leaseId: `lease_${++leaseCounter}_${Date.now()}`,
      holder: options.holder,
      acquiredAt: now,
      expiresAt: now + options.durationMs
    };

    await this.writeLease(lease);
    return lease;
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
