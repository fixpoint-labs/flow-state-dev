/**
 * Process-wide TTL cache for tool fetches.
 *
 * One Map keyed by `tool:JSON(args)`. Entries live for `TTL_MS` after they're
 * stored, after which the next read re-fetches. Process-scoped intentionally —
 * if another session in this server asks for the same ticker within the TTL
 * window, it should reuse the warm fetch rather than burn another API call.
 *
 * A parallel `inflight` map collapses concurrent first-time requests to a
 * single fetch — the four analysts that run at the same time will share one
 * upstream call when they ask for the same key.
 *
 * No session/resource plumbing. The cache doesn't need `ctx`, doesn't expose
 * itself through the framework, and isn't visible to clients. If we ever need
 * client-side visibility into what's been fetched, we can iterate `cache` and
 * project; until then this stays one file.
 */

const TTL_MS = 120_000;

type Entry = { value: unknown; expiresAt: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function cacheKey(tool: string, args: unknown): string {
  return `${tool}:${JSON.stringify(args)}`;
}

export async function getOrFetch<T>(
  tool: string,
  args: unknown,
  fetcher: () => Promise<T>,
): Promise<T> {
  const key = cacheKey(tool, args);

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

/** Test hook. Not exported from the package barrel. */
export function _resetCache(): void {
  cache.clear();
  inflight.clear();
}
