/**
 * Outcome-returning wrappers over the framework's state-mutation runners.
 *
 * A mutation callback may run more than once: the CAS retry loop re-invokes it
 * with the freshest committed state after a conflict
 * (`packages/engine/src/stores/cas.ts` — `await mutator(current)` inside
 * `while (attempt <= maxRetries)`). A callback that reports its outcome by
 * assigning to a binding declared outside itself therefore reports whichever
 * attempt happened to assign last, including attempts that never committed.
 *
 * These helpers give the callback a way to *return* its outcome alongside the
 * next state, so the value the caller receives always describes the invocation
 * whose state was handed back — there is nothing to reset and nothing to
 * forget. `scripts/validate-updater-purity.mjs` enforces that no other
 * mutation callback in the repo writes outward.
 */

/** What an outcome-returning updater hands back: the next state, plus what it did. */
export type UpdateOutcome<TState, TResult> = {
  /** The state to commit — exactly what the underlying runner expects back. */
  state: TState;
  /** What this invocation did. Returned to the caller when this invocation is the one that commits. */
  result: TResult;
};

/**
 * Run a mutation through `run`, returning the updater's own outcome.
 *
 * `run` is any function that applies a mutator — `ref.updateState`,
 * a scope's `atomicState`, or a wrapper like the task collection's `casWrite`.
 * Parameterising by the runner rather than by a resource is what lets one
 * helper cover every replay entry point.
 *
 * Returns `undefined` when the updater never completed an invocation — either
 * the runner did not invoke it, or every invocation threw and the runner
 * absorbed it. `undefined` means "nothing was reported", which is also the
 * correct answer for "nothing was committed".
 *
 * A synchronous updater keeps the mutator synchronous, which runners that
 * require a sync mutator (`casWrite`) depend on.
 */
export async function withOutcome<TState, TNext, TResult>(
  run: (mutator: (state: TState) => TNext) => Promise<unknown>,
  updater: (
    state: TState
  ) => UpdateOutcome<TNext, TResult> | Promise<UpdateOutcome<TNext, TResult>>
): Promise<TResult | undefined> {
  let outcome: TResult | undefined;

  await run((state) => {
    // Cleared per invocation, not once per write: a runner that absorbs a
    // throwing attempt and returns normally must not surface the previous
    // attempt's outcome for a write that did not commit.
    outcome = undefined;

    const produced = updater(state);

    if (produced instanceof Promise) {
      // The updater is async, so the mutator is too. Only runners that accept
      // `TState | Promise<TState>` back (i.e. `updateState`) can infer a
      // `TNext` this branch satisfies; a sync-only runner rejects it at the
      // call site, which is the intended constraint.
      return produced.then((settled) => {
        outcome = settled.result;
        return settled.state;
      }) as TNext;
    }

    outcome = produced.result;
    return produced.state;
  });

  return outcome;
}

/** The subset of a resource handle these helpers need — `ResourceRef`, `ResourceContext`, and test doubles all satisfy it. */
export type UpdateStateRunner<TState> = {
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<unknown>;
};

/**
 * `withOutcome` bound to a resource's `updateState`, so the 20-odd resource-side
 * call sites never see the runner argument.
 *
 * ```ts
 * return (await updateStateWith(ref, (s) => {
 *   const idx = s.entries.findIndex((e) => e.id === id)
 *   if (idx < 0) return { state: s, result: false }
 *   return { state: { ...s, entries: withoutIndex(s.entries, idx) }, result: true }
 * })) ?? false
 * ```
 */
export async function updateStateWith<TState, TResult>(
  ref: UpdateStateRunner<TState>,
  updater: (
    state: TState
  ) => UpdateOutcome<TState, TResult> | Promise<UpdateOutcome<TState, TResult>>
): Promise<TResult | undefined> {
  // Wrapped rather than passed by reference so the ref keeps its `this`.
  return withOutcome<TState, TState | Promise<TState>, TResult>(
    (mutator) => ref.updateState(mutator),
    updater as (
      state: TState
    ) =>
      | UpdateOutcome<TState | Promise<TState>, TResult>
      | Promise<UpdateOutcome<TState | Promise<TState>, TResult>>
  );
}
