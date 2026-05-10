/**
 * In-memory LRU + TTL cache for dispatch idempotency.
 *
 * Keyed on `(flowKind, dedupeKey)`. Entries fall out of the cache after
 * `ttlMs` or when the cache exceeds `maxEntries`. The cache is per
 * adapter instance — multi-process deployments rely on the host
 * scheduler's idempotency for cross-process guarantees, by design.
 */

export interface IdempotencyCache {
  /**
   * Has this `(flowKind, dedupeKey)` pair been recorded within the
   * configured window? Updates LRU recency on the lookup so seen entries
   * stay hot.
   */
  seen(flowKind: string, dedupeKey: string): boolean;
  /** Record a `(flowKind, dedupeKey)` pair as just seen. */
  record(flowKind: string, dedupeKey: string): void;
  /** Test seam: clear all entries. */
  clear(): void;
}

export interface CreateIdempotencyCacheOptions {
  /** Max distinct entries retained. Default 1024. */
  maxEntries?: number;
  /** Test seam: pluggable clock returning ms since epoch. */
  now?: () => number;
}

/**
 * Build the cache. `ttlMs <= 0` disables dedupe entirely (every call to
 * `seen` returns false; `record` is a no-op).
 */
export function createIdempotencyCache(
  ttlMs: number,
  options: CreateIdempotencyCacheOptions = {}
): IdempotencyCache {
  if (ttlMs <= 0) {
    return {
      seen: () => false,
      record: () => undefined,
      clear: () => undefined
    };
  }

  const maxEntries = options.maxEntries ?? 1024;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, number>();

  function makeKey(flowKind: string, dedupeKey: string): string {
    return `${flowKind}::${dedupeKey}`;
  }

  function evictExpired(): void {
    const cutoff = now() - ttlMs;
    for (const [key, ts] of entries) {
      if (ts >= cutoff) break; // entries iterate in insertion order
      entries.delete(key);
    }
  }

  return {
    seen(flowKind, dedupeKey) {
      evictExpired();
      const key = makeKey(flowKind, dedupeKey);
      const ts = entries.get(key);
      if (ts === undefined) return false;
      // Refresh LRU order without changing recorded timestamp.
      entries.delete(key);
      entries.set(key, ts);
      return true;
    },
    record(flowKind, dedupeKey) {
      const key = makeKey(flowKind, dedupeKey);
      entries.delete(key);
      entries.set(key, now());
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
    }
  };
}
