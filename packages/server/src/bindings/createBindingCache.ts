import type { BindingCacheOptions, BindingProvider } from "@flow-state-dev/core";

type CacheEntry<T> = {
  binding: T;
  lastAccess: number;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * A {@link BindingProvider} that also supports explicit disposal of all entries.
 */
export interface CachedBindingProvider<TBinding> extends BindingProvider<TBinding> {
  /** Release a cached binding by key, calling onEvict and provider.release(). Always defined on cached providers. */
  release(key: string): Promise<void>;

  /** Release all cached bindings, calling onEvict for each. */
  disposeAll(): void;

  /** Number of currently cached entries. */
  readonly size: number;
}

const DEFAULT_MAX_SIZE = 256;
const DEFAULT_TTL_MS = 30 * 60_000; // 30 minutes

/**
 * Wraps a {@link BindingProvider} with per-process LRU caching and TTL eviction.
 *
 * Returns a `CachedBindingProvider` with the same `resolve`/`release` interface,
 * so blocks don't need to know whether caching is active.
 *
 * @example
 * ```typescript
 * const cached = createBindingCache({
 *   provider: { resolve: async (key) => new SdkSession(key) },
 *   maxSize: 100,
 *   ttlMs: 30 * 60_000,
 *   onEvict: (_key, binding) => binding.disconnect?.(),
 * });
 *
 * const session = await cached.resolve("session-123");
 * ```
 */
export function createBindingCache<TBinding>(
  options: BindingCacheOptions<TBinding>
): CachedBindingProvider<TBinding> {
  const { provider, onEvict } = options;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry<TBinding>>();

  // Track in-flight resolve calls to prevent duplicate creation for the same key
  const pending = new Map<string, Promise<TBinding>>();

  // Monotonic counter for LRU ordering (avoids Date.now() resolution issues)
  let accessCounter = 0;

  function evictEntry(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    cache.delete(key);
    onEvict?.(key, entry.binding);
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

  async function resolve(key: string): Promise<TBinding> {
    // Cache hit — refresh TTL and return
    const existing = cache.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.lastAccess = ++accessCounter;
      existing.timer = resetTimer(key);
      return existing.binding;
    }

    // Deduplicate concurrent resolve calls for the same key
    const inflight = pending.get(key);
    if (inflight) return inflight;

    const promise = provider.resolve(key).then(
      (binding: TBinding) => {
        pending.delete(key);

        // Evict LRU if at capacity
        if (cache.size >= maxSize) {
          evictLRU();
        }

        cache.set(key, {
          binding,
          lastAccess: ++accessCounter,
          timer: resetTimer(key),
        });

        return binding;
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

  const result: CachedBindingProvider<TBinding> = {
    resolve,
    release,
    disposeAll,
    get size(): number {
      return cache.size;
    },
  };

  return result;
}
