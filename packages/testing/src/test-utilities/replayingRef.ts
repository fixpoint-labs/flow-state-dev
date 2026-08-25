/**
 * A `updateState` double that replays its updater, so a spec can observe what
 * a caller reports when a write loses a CAS round.
 *
 * The framework's CAS loop re-invokes the mutation callback with the freshest
 * committed state after a conflict (`packages/engine/src/stores/cas.ts` — the
 * `while (attempt <= maxRetries)` loop calls `mutator` on every pass),
 * discarding the losing attempt's output. `createReplayingRef` mirrors exactly
 * that: the updater runs once against the pre-conflict state and that result is
 * thrown away, then once against the winner's state, and only the winner
 * commits.
 *
 * Use it to prove a helper is replay-safe. A helper that reports its outcome
 * through a binding declared outside its callback returns the losing attempt's
 * answer here; one that returns its outcome from the callback returns the
 * winner's.
 */

/** A replaying double, plus the state it ended up committing. */
export type ReplayingRef<TState extends object> = {
  /**
   * What a caller reads before starting the write — the pre-conflict snapshot,
   * NOT the state that ends up committing. Reading this and then using the
   * value inside the callback is the stale-read defect; a helper that derives
   * the value from the state the callback receives is immune.
   */
  state: Readonly<TState>;
  /** Applies `updater` to the losing state, discards it, then applies it to the winning state and commits. */
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
  /** The state the winning attempt produced. */
  readonly committed: Readonly<TState>;
};

/**
 * Build a replaying `updateState` double.
 *
 * @param losing  State the discarded attempt sees — the pre-conflict snapshot.
 * @param winning State the committing attempt sees — what a concurrent writer left behind.
 *
 * ```ts
 * const ref = createReplayingRef(before, afterConcurrentWriterRemovedIt)
 * expect(await evict(ref, "wm_1")).toBe(false) // not `true` from the losing attempt
 * ```
 */
export function createReplayingRef<TState extends object>(
  losing: TState,
  winning: TState
): ReplayingRef<TState> {
  let committed: TState = winning;

  return {
    state: losing,
    get committed() {
      return committed;
    },
    async updateState(updater) {
      // The losing attempt's output is discarded exactly as the CAS loop
      // discards it on a failed compare-and-swap.
      await updater(losing);
      committed = await updater(winning);
    },
  };
}
