/**
 * A `updateState` double that replays its updater, so a spec can observe what
 * a caller reports when a write loses a CAS round.
 *
 * The framework's CAS loop re-invokes the mutation callback with the freshest
 * committed state after a conflict (`packages/engine/src/stores/cas.ts` —
 * `await mutator(current)` inside `while (attempt <= maxRetries)`), discarding
 * the losing attempt's output. `createReplayingRef` mirrors exactly that: the
 * updater runs once against the pre-conflict state and that result is thrown
 * away, then once against the winner's state, and only the winner commits.
 *
 * Use it to prove a helper is replay-safe. A helper that reports its outcome
 * through a binding declared outside its callback returns the losing attempt's
 * answer here; one that returns its outcome from the callback returns the
 * winner's.
 */

/** A replaying double, plus what it observed. */
export type ReplayingRef<TState extends object> = {
  /** The state the winning attempt sees — also what callers read via `ref.state`. */
  state: Readonly<TState>;
  /** Applies `updater` to the losing state, discards it, then applies it to the winning state and commits. */
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
  /** Every state the updater produced, in attempt order. The last entry is what committed. */
  attempts: TState[];
  /** The committed state after the winning attempt. */
  readonly committed: Readonly<TState>;
  /** How many times the updater ran. */
  readonly invocations: number;
};

export type CreateReplayingRefOptions = {
  /**
   * How many losing attempts to run before the winning one. Default `1` — the
   * single-conflict case, which is what every migrated site's spec asserts.
   * `0` makes the double single-invocation, for the behaviour-preserving half
   * of a migration's evidence.
   */
  losingAttempts?: number;
};

/**
 * Build a replaying `updateState` double.
 *
 * @param losing  State each discarded attempt sees — the pre-conflict snapshot.
 * @param winning State the committing attempt sees — what a concurrent writer left behind.
 *
 * ```ts
 * const ref = createReplayingRef(before, afterConcurrentWriterRemovedIt)
 * expect(await evict(ref, "wm_1")).toBe(false) // not `true` from the losing attempt
 * ```
 */
export function createReplayingRef<TState extends object>(
  losing: TState,
  winning: TState,
  options?: CreateReplayingRefOptions
): ReplayingRef<TState> {
  const losingAttempts = options?.losingAttempts ?? 1;
  const attempts: TState[] = [];
  let committed: TState = winning;

  return {
    state: winning,
    attempts,
    get committed() {
      return committed;
    },
    get invocations() {
      return attempts.length;
    },
    async updateState(updater) {
      for (let i = 0; i < losingAttempts; i += 1) {
        // The losing attempt's output is discarded exactly as the CAS loop
        // discards it on a failed compare-and-swap.
        attempts.push(await updater(losing));
      }
      const next = await updater(winning);
      attempts.push(next);
      committed = next;
    },
  };
}
