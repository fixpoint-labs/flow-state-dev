/**
 * In-memory SuspensionStore implementation for development and testing.
 */

import {
  isTerminalSuspensionStatus,
  matchesSuspensionFilter,
  type PendingUserSuspension,
  type PendingUserSuspensionQuery,
  type SuspensionFilter,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import type { SuspensionStore } from "../types";
import { listPendingForUser, missingRequestStore, type SuspensionRequestReads } from "../pending-user-suspensions";

// FIX-2770 D3.
/** What an in-memory suspension store is built with. */
export type InMemorySuspensionStoreOptions = {
  /** The request store a user's pending suspensions are joined to. Without it, `listPendingForUser` refuses. */
  requests?: SuspensionRequestReads;
};

export class InMemorySuspensionStore implements SuspensionStore {
  // FIX-2063 D2.
  /** Kept in this process only. */
  readonly persists = false;

  private readonly data = new Map<string, SuspensionRecord>();

  constructor(private readonly options: InMemorySuspensionStoreOptions = {}) {}

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

  async listPendingForUser(query: PendingUserSuspensionQuery): Promise<PendingUserSuspension[]> {
    if (this.options.requests === undefined) throw missingRequestStore("createInMemorySuspensionStore");
    return listPendingForUser(this.data.values(), this.options.requests, query);
  }
}

export function createInMemorySuspensionStore(options: InMemorySuspensionStoreOptions = {}): SuspensionStore {
  return new InMemorySuspensionStore(options);
}
