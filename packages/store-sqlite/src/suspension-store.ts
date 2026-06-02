/**
 * In-memory SuspensionStore for the SQLite adapter package. Temporary
 * until native SQLite implementation ships in a follow-up PR (FIX-140 PR 3).
 * Inlined to respect the type-only import boundary from @flow-state-dev/server.
 */

import type { SuspensionFilter, SuspensionRecord } from "@flow-state-dev/core/types";
import type { SuspensionStore } from "@flow-state-dev/server";

export class InMemorySuspensionStore implements SuspensionStore {
  private readonly data = new Map<string, SuspensionRecord>();

  private key(requestId: string, suspensionId: string): string {
    return `${requestId}:${suspensionId}`;
  }

  async set(record: SuspensionRecord): Promise<void> {
    this.data.set(this.key(record.requestId, record.suspensionId), record);
  }

  async get(requestId: string, suspensionId: string): Promise<SuspensionRecord | null> {
    return this.data.get(this.key(requestId, suspensionId)) ?? null;
  }

  async list(filter?: SuspensionFilter): Promise<SuspensionRecord[]> {
    let results = Array.from(this.data.values());
    if (filter?.flowKind) results = results.filter((r) => r.flowKind === filter.flowKind);
    if (filter?.userId) results = results.filter((r) => r.userId === filter.userId);
    if (filter?.sessionId) results = results.filter((r) => r.sessionId === filter.sessionId);
    if (filter?.status) results = results.filter((r) => r.status === filter.status);
    if (filter?.limit !== undefined) results = results.slice(0, filter.limit);
    return results;
  }

  async deleteForRequest(requestId: string): Promise<void> {
    for (const [key, record] of this.data) {
      if (record.requestId === requestId) this.data.delete(key);
    }
  }
}
