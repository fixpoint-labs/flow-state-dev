import type {
  CASOptions,
  ScopeStateOps,
  StateContainer
} from "@flow-state-dev/core/types";
import { runWithCAS } from "./cas";
import { cloneValue } from "../utils/clone";

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}

export class MemoryStateContainer<TState> implements StateContainer<TState> {
  private state: TState;
  private version: number;

  constructor(initialState: TState, initialVersion = 0) {
    this.state = cloneValue(initialState);
    this.version = Math.max(0, initialVersion);
  }

  read(): Readonly<TState> {
    return cloneValue(this.state) as Readonly<TState>;
  }

  getVersion(): number {
    return this.version;
  }

  async persist(
    nextState: TState,
    expectedVersion?: number
  ): Promise<Readonly<TState> | null> {
    if (
      expectedVersion !== undefined &&
      expectedVersion !== this.version
    ) {
      return null;
    }

    this.state = cloneValue(nextState);
    this.version += 1;
    return this.read();
  }
}

export type ScopeStateOpsOptions<TState extends object> = {
  cas?: CASOptions;
  maxStateSizeBytes?: number;
  onStateSizeWarning?: (detail: {
    sizeBytes: number;
    maxStateSizeBytes: number;
  }) => void;
  onPersist?: (
    state: Readonly<TState>,
    version: number
  ) => Promise<void> | void;
};

async function notifyPersist<TState extends object>(
  container: StateContainer<TState>,
  options: ScopeStateOpsOptions<TState> | undefined
): Promise<void> {
  if (options?.onPersist === undefined) {
    return;
  }

  await options.onPersist(container.read(), container.getVersion());
}

async function applyMutation<TState extends object>(
  container: StateContainer<TState>,
  options: ScopeStateOpsOptions<TState> | undefined,
  mutator: (state: Readonly<TState>) => TState | Promise<TState>
): Promise<void> {
  await runWithCAS({
    container,
    mutator,
    options: options?.cas,
    maxStateSizeBytes: options?.maxStateSizeBytes,
    onStateSizeWarning: options?.onStateSizeWarning
  });
  await notifyPersist(container, options);
}

export function createScopeStateOps<TState extends object>(
  container: StateContainer<TState>,
  options?: ScopeStateOpsOptions<TState>
): ScopeStateOps<TState> {
  async function patchState(
    updates: Partial<TState>
  ): Promise<void>;
  async function patchState<TKey extends keyof TState>(
    key: TKey,
    updater: (current: TState[TKey]) => TState[TKey]
  ): Promise<void>;
  async function patchState<TKey extends keyof TState>(
    updatesOrKey: Partial<TState> | TKey,
    updater?: (current: TState[TKey]) => TState[TKey]
  ): Promise<void> {
    await applyMutation(container, options, async (state) => {
      const next = { ...state } as TState;

      if (typeof updatesOrKey === "object" && updatesOrKey !== null) {
        return {
          ...next,
          ...updatesOrKey
        };
      }

      if (updater === undefined) {
        return next;
      }

      const key = updatesOrKey;
      const currentValue = next[key];
      next[key] = updater(currentValue);
      return next;
    });
  }

  async function setState(nextState: TState): Promise<void> {
    await applyMutation(container, options, async () => nextState);
  }

  async function incState(increments: Record<string, number>): Promise<void> {
    await applyMutation(container, options, async (state) => {
      const next = {
        ...state
      } as Record<string, unknown>;

      for (const [field, increment] of Object.entries(increments)) {
        const current = next[field];
        const currentNumber =
          typeof current === "number" ? current : 0;
        next[field] = currentNumber + increment;
      }

      return next as TState;
    });
  }

  async function pushState(field: string, value: unknown): Promise<void> {
    await applyMutation(container, options, async (state) => {
      const next = {
        ...state
      } as Record<string, unknown>;

      const currentArray = toArray(next[field]);
      next[field] = [...currentArray, value];
      return next as TState;
    });
  }

  async function setStateRecord(
    field: string,
    key: string,
    value: unknown
  ): Promise<void> {
    await applyMutation(container, options, async (state) => {
      const next = {
        ...state
      } as Record<string, unknown>;
      const currentRecord = toRecord(next[field]);
      next[field] = {
        ...currentRecord,
        [key]: value
      };
      return next as TState;
    });
  }

  async function deleteStateRecord(
    field: string,
    key: string
  ): Promise<void> {
    await applyMutation(container, options, async (state) => {
      const next = {
        ...state
      } as Record<string, unknown>;
      const currentRecord = {
        ...toRecord(next[field])
      };
      delete currentRecord[key];
      next[field] = currentRecord;
      return next as TState;
    });
  }

  async function atomicState(
    mutator: (state: Readonly<TState>) => Partial<TState>
  ): Promise<void> {
    await applyMutation(container, options, async (state) => {
      const patch = mutator(state);
      return {
        ...state,
        ...patch
      };
    });
  }

  return {
    patchState,
    setState,
    incState,
    pushState,
    setStateRecord,
    deleteStateRecord,
    atomicState
  };
}

export function createStateContainer<TState>(
  initialState: TState,
  initialVersion = 0
): StateContainer<TState> {
  return new MemoryStateContainer(initialState, initialVersion);
}
