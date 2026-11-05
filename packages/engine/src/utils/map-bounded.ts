/**
 * `Promise.all` over a mapping, with at most `limit` calls in flight.
 *
 * For a fan-out whose width a caller controls (one store read per listed
 * row), so a long list costs time rather than a burst of concurrent reads.
 * Results keep the input's order; the first rejection rejects the whole map,
 * as `Promise.all` does.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}
