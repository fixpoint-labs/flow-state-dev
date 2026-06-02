/**
 * In-memory LeaseStore for the SQLite adapter package. Temporary until
 * native SQLite implementation ships in a follow-up PR (FIX-140 PR 3).
 */

import type { Lease, LeaseOptions } from "@flow-state-dev/server";
import type { LeaseStore } from "@flow-state-dev/server";

export class InMemoryLeaseStore implements LeaseStore {
  private readonly data = new Map<string, Lease>();
  private leaseCounter = 0;

  async acquire(requestId: string, options: LeaseOptions): Promise<Lease | null> {
    const existing = this.data.get(requestId);
    const now = Date.now();
    if (existing && existing.expiresAt > now && existing.holder !== options.holder) {
      return null;
    }
    const lease: Lease = {
      requestId,
      leaseId: `lease_${++this.leaseCounter}`,
      holder: options.holder,
      acquiredAt: now,
      expiresAt: now + options.durationMs,
    };
    this.data.set(requestId, lease);
    return lease;
  }

  async release(requestId: string, leaseId: string): Promise<void> {
    const existing = this.data.get(requestId);
    if (existing?.leaseId === leaseId) this.data.delete(requestId);
  }

  async get(requestId: string): Promise<Lease | null> {
    const lease = this.data.get(requestId);
    if (!lease) return null;
    if (lease.expiresAt <= Date.now()) {
      this.data.delete(requestId);
      return null;
    }
    return lease;
  }

  async pruneExpired(): Promise<void> {
    const now = Date.now();
    for (const [key, lease] of this.data) {
      if (lease.expiresAt <= now) this.data.delete(key);
    }
  }
}
