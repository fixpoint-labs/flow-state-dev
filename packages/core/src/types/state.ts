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

export interface ScopeStateOps<TState extends object> {
  patchState(updates: Partial<TState>): Promise<void>;
  patchState<TKey extends keyof TState>(
    key: TKey,
    updater: (current: TState[TKey]) => TState[TKey]
  ): Promise<void>;

  setState(nextState: TState): Promise<void>;
  incState(increments: Record<string, number>): Promise<void>;
  pushState(field: string, value: unknown): Promise<void>;
  setStateRecord(field: string, key: string, value: unknown): Promise<void>;
  deleteStateRecord(field: string, key: string): Promise<void>;

  atomicState(mutator: (state: Readonly<TState>) => Partial<TState>): Promise<void>;
}
