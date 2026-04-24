/**
 * Per-request state container and scope state operation builder.
 *
 * The container is a same-request read-through cache over a scope's state.
 * It does NOT enforce CAS — that responsibility lives in the `Store.set`
 * contract (`expectedVersion` predicate). The CAS retry loop (`runWithCAS`)
 * calls `container.commit(state, version)` to refresh the cache after a
 * successful write or a conflict.
 */

import type {
  CASOptions,
  ScopeStateOps,
  StateContainer
} from "@flow-state-dev/core/types";
import { runWithCAS, type CASPersist } from "./cas";
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

  commit(nextState: TState, version: number): Readonly<TState> {
    this.state = cloneValue(nextState);
    this.version = Math.max(0, version);
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
  /**
   * CAS-aware persist bridge into the underlying store. Invoked inside the
   * CAS retry loop with the proposed next state and the `expectedVersion`
   * the container believes is currently stored. Returns the new version on
   * success, or the store's current value/version on conflict.
   */
  persist?: CASPersist<TState>;
};

/**
 * Fallback persist for state that has no backing store (e.g. target state
 * shared across sibling blocks). The container itself plays the role of the
 * CAS authority — the callback checks expectedVersion against the container's
 * current version synchronously so interleaved concurrent mutators can't
 * silently overwrite each other's commits.
 */
function createContainerPersist<TState>(
  container: StateContainer<TState>
): CASPersist<TState> {
  return async (nextState, expectedVersion) => {
    const currentVersion = container.getVersion();
    if (currentVersion !== expectedVersion) {
      return {
        ok: false,
        currentState: container.read() as TState,
        currentVersion
      };
    }
    // Commit inside the callback so the version check and the update form
    // one atomic (microtask-free) step. runWithCAS does a second, idempotent
    // commit after ok — with no store backing it, the sync pre-commit here
    // is what prevents concurrent mutators from all passing the v-check.
    container.commit(nextState, expectedVersion + 1);
    return { ok: true, version: expectedVersion + 1 };
  };
}

async function applyMutation<TState extends object>(
  container: StateContainer<TState>,
  options: ScopeStateOpsOptions<TState> | undefined,
  mutator: (state: Readonly<TState>) => TState | Promise<TState>
): Promise<void> {
  const persist = options?.persist ?? createContainerPersist(container);

  await runWithCAS({
    container,
    mutator,
    persist,
    options: options?.cas,
    maxStateSizeBytes: options?.maxStateSizeBytes,
    onStateSizeWarning: options?.onStateSizeWarning
  });
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
