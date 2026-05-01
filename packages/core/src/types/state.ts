export type CASOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
};

/**
 * In-request state cache used by the CAS retry loop.
 *
 * The container holds the last-known state and version for a scope within a
 * single request so repeated reads don't re-hit the underlying store. It no
 * longer enforces CAS — the store's `set(expectedVersion)` contract does that.
 * The container is refreshed on both successful writes and write conflicts so
 * its view stays consistent with the store.
 */
export interface StateContainer<TState = unknown> {
  read(): Readonly<TState>;
  getVersion(): number;
  /**
   * Replace the cached state and version. Called after a successful CAS write
   * (with the new version) and after a conflict (with the store's current
   * value/version so the next retry starts from the true current state).
   */
  commit(nextState: TState, version: number): Readonly<TState>;
}

/**
 * Scope-level state-mutation surface. Every method's resolved boolean is
 * `true` when the write produced a real state change and `false` when the
 * proposed update was structurally equal to the current state — in which
 * case the framework suppresses the persist call and the corresponding
 * `state_change` SSE emit. Existing callers that ignore the return value
 * remain source-compatible.
 */
export interface ScopeStateOps<TState extends object> {
  patchState(updates: Partial<TState>): Promise<boolean>;
  patchState<TKey extends keyof TState>(
    key: TKey,
    updater: (current: TState[TKey]) => TState[TKey]
  ): Promise<boolean>;

  setState(nextState: TState): Promise<boolean>;
  incState(increments: Record<string, number>): Promise<boolean>;
  pushState(field: string, value: unknown): Promise<boolean>;
  setStateRecord(field: string, key: string, value: unknown): Promise<boolean>;
  deleteStateRecord(field: string, key: string): Promise<boolean>;

  atomicState(mutator: (state: Readonly<TState>) => Partial<TState>): Promise<boolean>;
}
