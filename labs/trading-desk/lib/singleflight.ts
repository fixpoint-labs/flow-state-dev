/**
 * Per-key in-flight de-dupe with NO retention after resolution.
 *
 * Distinct from `cache.ts`'s `getOrFetch`, which ALSO caches the resolved
 * value for a 120s TTL. Use `withLease` instead when the caller already has
 * its own durable cache (a database row) and only needs to collapse two
 * overlapping in-flight fetches for the same key into one upstream call —
 * retaining the value here too would be a cache on top of the durable one,
 * and could mask a fresh write for the TTL window (exactly the reason
 * FIX-801 does not wrap its fetcher in `getOrFetch`; see `etf-profile.ts`).
 *
 * A budget-guarded provider (Alpha Vantage's shared 25/day allowance) makes
 * this a correctness concern, not just an efficiency one: two overlapping
 * requests for the same ticker (two browser tabs, or a mount racing a
 * background refresh) would otherwise each pass the "is this stale/missing"
 * check and each reserve a budget unit for the same answer.
 *
 * Leaf module: no imports, no IO of its own.
 */

const leases = new Map<string, Promise<unknown>>();

/**
 * Run `fn()` for `key`, sharing one in-flight call across concurrent callers.
 * The lease is released as soon as `fn()` settles (success or failure) —
 * the NEXT call for the same key always runs `fn()` fresh, so this only
 * collapses genuinely overlapping calls, never caches a result over time.
 */
export async function withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const pending = leases.get(key);
  if (pending) return pending as Promise<T>;
  const promise = fn().finally(() => leases.delete(key));
  leases.set(key, promise);
  return promise;
}

/** Test hook — reset in-flight leases between specs. Not in the barrel. */
export function _resetLeases(): void {
  leases.clear();
}
