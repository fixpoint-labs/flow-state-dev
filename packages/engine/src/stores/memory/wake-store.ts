/**
 * In-memory WakeStore (FIX-2078 D1), for development and tests. One wake per
 * (tenant, session, entry); see `WakeStore` for the coalescing and the
 * version rule.
 */
import type { WakeInput, WakeKey, WakeRecord, WakeStore } from "../types";

/** The one string a wake is kept under. NUL never appears in an id. */
export function wakeStorageKey(key: WakeKey): string {
  return `${key.tenantId ?? ""}\u0000${key.sessionId}\u0000${key.entry}`;
}

/**
 * The wake `input` makes of `existing`: the earlier due time, the later
 * `landBy`, the next version. Shared by the memory and filesystem stores.
 */
export function coalesceWake(existing: WakeRecord | null, input: WakeInput, now: number): WakeRecord {
  if (existing === null) {
    return { ...input, version: 1, createdAt: now, updatedAt: now };
  }
  return {
    ...existing,
    dueAt: Math.min(existing.dueAt, input.dueAt),
    landBy: Math.max(existing.landBy, input.landBy),
    version: existing.version + 1,
    updatedAt: now
  };
}

class InMemoryWakeStore implements WakeStore {
  private readonly data = new Map<string, WakeRecord>();

  async owe(input: WakeInput): Promise<WakeRecord> {
    const key = wakeStorageKey(input);
    const next = coalesceWake(this.data.get(key) ?? null, input, Date.now());
    this.data.set(key, next);
    return { ...next };
  }

  async get(key: WakeKey): Promise<WakeRecord | null> {
    const found = this.data.get(wakeStorageKey(key));
    return found === undefined ? null : { ...found };
  }

  async move(key: WakeKey, version: number, dueAt: number): Promise<boolean> {
    const storageKey = wakeStorageKey(key);
    const found = this.data.get(storageKey);
    if (found === undefined || found.version !== version) return false;
    this.data.set(storageKey, { ...found, dueAt, updatedAt: Date.now() });
    return true;
  }

  async clear(key: WakeKey, version: number): Promise<boolean> {
    const storageKey = wakeStorageKey(key);
    const found = this.data.get(storageKey);
    if (found === undefined || found.version !== version) return false;
    this.data.delete(storageKey);
    return true;
  }

  async listDue(now: number, limit: number): Promise<WakeRecord[]> {
    return [...this.data.values()]
      .filter((wake) => wake.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, limit)
      .map((wake) => ({ ...wake }));
  }

  async earliestDueAt(): Promise<number | null> {
    let earliest: number | null = null;
    for (const wake of this.data.values()) {
      if (earliest === null || wake.dueAt < earliest) earliest = wake.dueAt;
    }
    return earliest;
  }
}

export function createInMemoryWakeStore(): WakeStore {
  return new InMemoryWakeStore();
}
