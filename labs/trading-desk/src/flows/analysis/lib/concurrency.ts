/**
 * Bounded-concurrency + backoff primitives shared by the live-data fetchers.
 *
 * Live providers (FRED, Yahoo, Finnhub) throttle a large simultaneous burst, so
 * a fan-out over many tickers/series must cap how many requests are in flight at
 * once and back off + retry the transient failures. `mapLimit` caps the burst
 * (preserving input order); `sleep` is the backoff timer the per-item retry
 * loops use. Both live here, not inlined per-caller, so there is one copy across
 * the macro tool and the portfolio quote fan-out (no duplicate helpers).
 *
 * Leaf module: no imports, no IO of its own.
 */

/** Resolve after `ms` milliseconds — the backoff timer for retry loops. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once,
 * preserving input order in the result. Caps a request burst under a provider's
 * concurrency throttle. `limit` is clamped to the item count; an empty input
 * resolves to `[]` without invoking `fn`.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}
