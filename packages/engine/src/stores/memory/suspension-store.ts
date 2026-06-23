/**
 * In-memory SuspensionStore implementation for development and testing.
 */

import {
  isTerminalSuspensionStatus,
  matchesSuspensionFilter,
  type SuspensionFilter,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import type { SuspensionStore } from "../types";

export class InMemorySuspensionStore implements SuspensionStore {
  private readonly data = new Map<string, SuspensionRecord>();

  private key(requestId: string, suspensionId: string): string {
    return `${requestId}:${suspensionId}`;
  }

  async set(record: SuspensionRecord): Promise<void> {
    this.data.set(this.key(record.requestId, record.suspensionId), record);
  }

  async get(
    requestId: string,
    suspensionId: string
  ): Promise<SuspensionRecord | null> {
    return this.data.get(this.key(requestId, suspensionId)) ?? null;
  }

  async list(filter?: SuspensionFilter): Promise<SuspensionRecord[]> {
    const results = Array.from(this.data.values())
      .filter((r) => matchesSuspensionFilter(r, filter))
      // Sort newest-first to match the filesystem/SQLite/Postgres adapters
      // (which order by created_at DESC) so `limit` keeps the same end across
      // every store and the DevTool list orders identically in dev and prod.
      .sort((a, b) => b.createdAt - a.createdAt);

    return filter?.limit !== undefined ? results.slice(0, filter.limit) : results;
  }

  async deleteForRequest(requestId: string): Promise<void> {
    for (const [key, record] of this.data) {
      if (record.requestId === requestId) {
        this.data.delete(key);
      }
    }
  }

  async pruneTerminalBefore(cutoffMs: number, limit: number): Promise<number> {
    let deleted = 0;
    for (const [key, record] of this.data) {
      if (deleted >= limit) break;
      if (
        isTerminalSuspensionStatus(record.status) &&
        record.resolvedAt !== undefined &&
        record.resolvedAt < cutoffMs
      ) {
        this.data.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export function createInMemorySuspensionStore(): SuspensionStore {
  return new InMemorySuspensionStore();
}
