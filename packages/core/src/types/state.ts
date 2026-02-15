export type CASOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
};

export interface StateContainer<TState = unknown> {
  read(): Readonly<TState>;
  getVersion(): number;
  persist(nextState: TState, expectedVersion?: number): Promise<Readonly<TState> | null>;
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
