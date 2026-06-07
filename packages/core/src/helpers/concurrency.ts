/**
 * Bounded-concurrency async fan-out for use inside handlers.
 *
 * `.parallel` / `.work` fan out blocks; this helper fans out plain async work
 * inside a single handler (e.g. provider HTTP calls across many tickers). It is
 * the one canonical implementation — the sequencer's own `.parallel` / `.work`
 * paths consume it too, so apps no longer need to re-roll a bounded `map`.
 */

/**
 * Run `mapper` over `values` with at most `maxConcurrency` calls in flight at
 * once, preserving input order in the result.
 *
 * `maxConcurrency` of `undefined` (or any value ≥ `values.length`) runs every
 * item concurrently; values below 1 are clamped to 1. An empty input resolves
 * to `[]` without invoking `mapper`. The first rejecting `mapper` call rejects
 * the returned promise.
 */
export async function mapLimit<TInput, TOutput>(
  values: readonly TInput[],
  maxConcurrency: number | undefined,
  mapper: (value: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (values.length === 0) {
    return [];
  }

  const limit = Math.max(1, maxConcurrency ?? values.length);
  const results: TOutput[] = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  };

  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(limit, values.length); index += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}
