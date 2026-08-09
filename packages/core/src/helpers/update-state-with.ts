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

/** True for any thenable, including a Promise built in another realm (an iframe, a `vm` context). */
function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as PromiseLike<T>).then === "function"
  );
}

/**
 * The updater a given runner accepts.
 *
 * A runner declares what its mutator may return (`TNext`). If that includes a
 * Promise — `updateState`, whose updater is `(s) => TState | Promise<TState>` —
 * the updater may be `async`. If it does not — `casWrite`, whose mutator must
 * return the next tasks map synchronously — the updater must be synchronous
 * too, because there is nothing to await it before the runner reads it.
 *
 * This is a conditional on `TNext` rather than overloads on `run`'s shape
 * deliberately: the repo compiles with `strictFunctionTypes` off, so parameter
 * positions are checked bivariantly and an overload set keyed on the runner's
 * signature would accept a sync runner for the async overload.
 */
export type OutcomeUpdater<TState, TNext, TResult> = [Promise<Awaited<TNext>>] extends [TNext]
  ? (
      state: TState
    ) =>
      | UpdateOutcome<Awaited<TNext>, TResult>
      | Promise<UpdateOutcome<Awaited<TNext>, TResult>>
  : (state: TState) => UpdateOutcome<Awaited<TNext>, TResult>;

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
 * **An async updater requires a runner that accepts one** — see
 * `OutcomeUpdater`. Without that constraint an `async` updater type-checks
 * against a synchronous runner and hands it a Promise where it expects the next
 * state, which the runner then persists.
 */
export async function withOutcome<TState, TNext, TResult>(
  run: (mutator: (state: TState) => TNext) => Promise<unknown>,
  updater: OutcomeUpdater<TState, TNext, TResult>
): Promise<TResult | undefined>;
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

    // Thenable rather than `instanceof Promise`: a Promise from another realm
    // fails the instanceof check, and falling through would read `.state` and
    // `.result` off the Promise itself and hand the runner `undefined`.
    // `Promise.resolve` assimilates it. The sync path below is untouched.
    if (isThenable(produced)) {
      // Only the async overload reaches here, so the runner accepts a Promise.
      return Promise.resolve(produced).then((settled) => {
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
  // `updateState`'s mutator may return a Promise, so `OutcomeUpdater` resolves
  // to the async-capable branch and an async updater is accepted here.
  // The cast is confined to this line: inside a generic body `TState` is not
  // resolved, so `OutcomeUpdater`'s conditional stays deferred and cannot be
  // shown equal to this parameter's type. At every real call site `TState` is
  // concrete, the conditional resolves, and the constraint is enforced —
  // `update-state-with.type-test.ts` pins both directions.
  return withOutcome<TState, TState | Promise<TState>, TResult>(
    (mutator) => ref.updateState(mutator),
    updater as OutcomeUpdater<TState, TState | Promise<TState>, TResult>
  );
}
