import type { HandleCacheOptions, HandleProvider } from "@flow-state-dev/core";

type CacheEntry<T> = {
  handle: T;
  lastAccess: number;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * A {@link HandleProvider} that also supports explicit disposal of all entries.
 */
export interface CachedHandleProvider<THandle> extends HandleProvider<THandle> {
  /** Release a cached handle by key, calling onEvict and provider.release(). Always defined on cached providers. */
  release(key: string): Promise<void>;

  /** Release all cached handles, calling onEvict for each. */
  disposeAll(): void;

  /** Number of currently cached entries. */
  readonly size: number;
}

const DEFAULT_MAX_SIZE = 256;
const DEFAULT_TTL_MS = 30 * 60_000; // 30 minutes

/**
 * Wraps a {@link HandleProvider} with per-process LRU caching and TTL eviction.
 *
 * Returns a `CachedHandleProvider` with the same `resolve`/`release` interface,
 * so blocks don't need to know whether caching is active.
 *
 * @example
 * ```typescript
 * const cached = createHandleCache({
 *   provider: { resolve: async (key) => new SdkSession(key) },
 *   maxSize: 100,
 *   ttlMs: 30 * 60_000,
 *   onEvict: (_key, handle) => handle.disconnect?.(),
 * });
 *
 * const handle = await cached.resolve("session-123");
 * ```
 */
export function createHandleCache<THandle>(
  options: HandleCacheOptions<THandle>
): CachedHandleProvider<THandle> {
  const { provider, onEvict } = options;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry<THandle>>();

  // Track in-flight resolve calls to prevent duplicate creation for the same key
  const pending = new Map<string, Promise<THandle>>();

  // Monotonic counter for LRU ordering (avoids Date.now() resolution issues)
  let accessCounter = 0;

  function evictEntry(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    cache.delete(key);
    onEvict?.(key, entry.handle);
  }

  function evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;
    for (const [key, entry] of cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      evictEntry(oldestKey);
    }
  }

  function resetTimer(key: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => evictEntry(key), ttlMs);
  }

  async function resolve(key: string): Promise<THandle> {
    // Cache hit — refresh TTL and return
    const existing = cache.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.lastAccess = ++accessCounter;
      existing.timer = resetTimer(key);
      return existing.handle;
    }

    // Deduplicate concurrent resolve calls for the same key
    const inflight = pending.get(key);
    if (inflight) return inflight;

    const promise = provider.resolve(key).then(
      (handle: THandle) => {
        pending.delete(key);

        // Evict LRU if at capacity
        if (cache.size >= maxSize) {
          evictLRU();
        }

        cache.set(key, {
          handle,
          lastAccess: ++accessCounter,
          timer: resetTimer(key),
        });

        return handle;
      },
      (err: unknown) => {
        pending.delete(key);
        throw err;
      }
    );

    pending.set(key, promise);
    return promise;
  }

  async function release(key: string): Promise<void> {
    evictEntry(key);
    await provider.release?.(key);
  }

  function disposeAll(): void {
    for (const key of [...cache.keys()]) {
      evictEntry(key);
    }
  }

  const result: CachedHandleProvider<THandle> = {
    resolve,
    release,
    disposeAll,
    get size(): number {
      return cache.size;
    },
  };

  return result;
}
