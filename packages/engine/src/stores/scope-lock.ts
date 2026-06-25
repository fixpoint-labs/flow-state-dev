/**
 * Per-`StateContainer` async FIFO mutation queue. The two-tier dispatch
 * lives in `applyMutation`; CAS retries still apply at the durable
 * boundary in `runWithCAS`.
 */

const tails = new WeakMap<object, Promise<unknown>>();

export class ScopeMutationTimeoutError extends Error {
  readonly code: string;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`State mutation exceeded ${timeoutMs}ms timeout (queue wait + execution).`);
    this.name = "ScopeMutationTimeoutError";
    this.code = "SCOPE_MUTATION_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

export interface WithScopeLockOptions {
  /**
   * Total budget for queue wait + mutator execution. Throws
   * `ScopeMutationTimeoutError` if exceeded. The clock starts when the
   * mutator is enqueued, so head-of-line blocking counts against the
   * budget. `undefined`, `Infinity`, or a non-positive value disables
   * the timeout.
   */
  timeoutMs?: number;
}

/**
 * Run `fn` exclusively against `container`. Mutators submitted to the same
 * container run sequentially in submission order; mutators on different
 * containers are independent.
 *
 * Errors from `fn` are surfaced to the caller. The internal tail swallows
 * them so a throwing mutator does not poison subsequent enqueuers.
 *
 * `timeoutMs` is caller-facing only — it does not cancel the in-flight
 * mutator or release the lock early. Use it as a bounded-error safety
 * net for hangs, not as a cancellation primitive.
 */
export function withScopeLock<TContainer extends object, T>(
  container: TContainer,
  fn: () => Promise<T>,
  options?: WithScopeLockOptions
): Promise<T> {
  const previousTail = tails.get(container) ?? Promise.resolve();
  // `.then(fn, fn)` (poison resistance): a thrown earlier mutator must
  // not skip our turn or shift the queue. Both branches invoke `fn` so
  // we run regardless of upstream outcome.
  const run = previousTail.then(fn, fn);
  // Stored tail swallows so the next enqueuer's `.then(fn, fn)` sees a
  // resolved upstream — caller-facing `run` still rejects on failure.
  tails.set(
    container,
    run.catch(() => undefined)
  );

  const timeoutMs = options?.timeoutMs;
  if (timeoutMs === undefined || timeoutMs === Infinity || timeoutMs <= 0) {
    return run;
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ScopeMutationTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  return Promise.race([run, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
