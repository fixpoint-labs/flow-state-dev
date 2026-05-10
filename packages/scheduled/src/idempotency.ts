/**
 * In-memory LRU + TTL cache for `(flowKind, dedupeKey)` dispatch
 * dedupe. Per-adapter; multi-process deploys rely on the host
 * scheduler's idempotency for cross-process guarantees.
 */

export interface IdempotencyCache {
  seen(flowKind: string, dedupeKey: string): boolean;
  record(flowKind: string, dedupeKey: string): void;
  clear(): void;
}

export interface CreateIdempotencyCacheOptions {
  /** Max distinct entries retained. Default 1024. */
  maxEntries?: number;
  /** Pluggable clock for tests. Default `Date.now`. */
  now?: () => number;
}

/** `ttlMs <= 0` disables dedupe entirely. */
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

  // Map insertion order = `record()` order; iteration walks oldest-first.
  // The early-break is only sound while we never reshuffle entries, so
  // `seen()` is a pure read — touch-on-read would invalidate the order.
  function evictExpired(): void {
    const cutoff = now() - ttlMs;
    for (const [key, ts] of entries) {
      if (ts >= cutoff) break;
      entries.delete(key);
    }
  }

  return {
    seen(flowKind, dedupeKey) {
      evictExpired();
      const ts = entries.get(makeKey(flowKind, dedupeKey));
      return ts !== undefined && ts >= now() - ttlMs;
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
