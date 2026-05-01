/**
 * Per-request state container and scope state operation builder.
 *
 * The container is a same-request read-through cache over a scope's state.
 * `applyMutation` dispatches between two write paths:
 *   - In-memory scopes (no `persist`) serialize through `withScopeLock`,
 *     commit `version + 1` directly, and never throw
 *     `ConcurrentModificationError`.
 *   - External-store scopes (`persist` defined) drive the classic
 *     `runWithCAS` retry loop. A successful or conflicting persist refreshes
 *     the container via `container.commit(state, version)`; CAS still owns
 *     `ConcurrentModificationError` at the durable boundary.
 */

import type {
  CASOptions,
  ScopeStateOps,
  StateContainer
} from "@flow-state-dev/core/types";
import { deepEqual } from "@flow-state-dev/core/utils";
import {
  DEFAULT_MAX_STATE_SIZE_BYTES,
  estimateSizeBytes,
  runWithCAS,
  type CASPersist
} from "./cas";
import { withScopeLock } from "./scope-lock";
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
   *
   * When omitted, the scope is treated as in-memory: mutators serialize
   * through a per-container FIFO queue (`withScopeLock`) instead of the
   * CAS retry loop. There is no version check, no retry, no
   * `ConcurrentModificationError`.
   */
  persist?: CASPersist<TState>;
  /**
   * Total budget for an in-memory mutation (queue wait + execution). Throws
   * `ScopeMutationTimeoutError` when exceeded. Defaults to the flow's
   * `request.mutationTimeoutMs` (resolved by `createExecutionContext`).
   * Ignored when `persist` is set — external-store CAS uses its own retry
   * semantics. Set to `Infinity` to disable.
   */
  mutationTimeoutMs?: number;
};

/**
 * Apply a mutator to the container's state.
 *
 * Two-tier dispatch:
 * - When `persist` is undefined the scope is in-memory: `withScopeLock`
 *   serializes mutators per-container, the deep-equal short-circuit
 *   skips persist + version bump on no-op writes, and a successful
 *   commit bumps the version by one. No retries, no
 *   `ConcurrentModificationError`.
 * - When `persist` is defined the scope is external-store backed:
 *   `runWithCAS` drives the optimistic load → mutate → persist cycle with
 *   exponential backoff. `ConcurrentModificationError` still surfaces on
 *   retry exhaustion because a remote authority can advance the version
 *   underneath us.
 */
async function applyMutation<TState extends object>(
  container: StateContainer<TState>,
  options: ScopeStateOpsOptions<TState> | undefined,
  mutator: (state: Readonly<TState>) => TState | Promise<TState>
): Promise<boolean> {
  const persist = options?.persist;

  if (persist === undefined) {
    const sizeThreshold =
      options?.maxStateSizeBytes ?? DEFAULT_MAX_STATE_SIZE_BYTES;
    const onSizeWarning = options?.onStateSizeWarning;

    let committed = false;
    await withScopeLock(
      container,
      async () => {
        const current = container.read();
        const next = await mutator(current);

        // No-op short-circuit (matches runWithCAS): structurally-equal
        // outputs skip the commit + version bump and return false so
        // callers can suppress redundant `state_change` emits.
        if (deepEqual(current, next)) return;

        const nextSizeBytes = estimateSizeBytes(next);
        if (nextSizeBytes > sizeThreshold) {
          onSizeWarning?.({
            sizeBytes: nextSizeBytes,
            maxStateSizeBytes: sizeThreshold
          });
        }

        container.commit(next, container.getVersion() + 1);
        committed = true;
      },
      { timeoutMs: options?.mutationTimeoutMs }
    );
    return committed;
  }

  const { committed } = await runWithCAS({
    container,
    mutator,
    persist,
    options: options?.cas,
    maxStateSizeBytes: options?.maxStateSizeBytes,
    onStateSizeWarning: options?.onStateSizeWarning
  });
  return committed;
}

export function createScopeStateOps<TState extends object>(
  container: StateContainer<TState>,
  options?: ScopeStateOpsOptions<TState>
): ScopeStateOps<TState> {
  async function patchState(
    updates: Partial<TState>
  ): Promise<boolean>;
  async function patchState<TKey extends keyof TState>(
    key: TKey,
    updater: (current: TState[TKey]) => TState[TKey]
  ): Promise<boolean>;
  async function patchState<TKey extends keyof TState>(
    updatesOrKey: Partial<TState> | TKey,
    updater?: (current: TState[TKey]) => TState[TKey]
  ): Promise<boolean> {
    return applyMutation(container, options, async (state) => {
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

  async function setState(nextState: TState): Promise<boolean> {
    return applyMutation(container, options, async () => nextState);
  }

  async function incState(increments: Record<string, number>): Promise<boolean> {
    return applyMutation(container, options, async (state) => {
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

  async function pushState(field: string, value: unknown): Promise<boolean> {
    return applyMutation(container, options, async (state) => {
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
  ): Promise<boolean> {
    return applyMutation(container, options, async (state) => {
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
  ): Promise<boolean> {
    return applyMutation(container, options, async (state) => {
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
  ): Promise<boolean> {
    return applyMutation(container, options, async (state) => {
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
