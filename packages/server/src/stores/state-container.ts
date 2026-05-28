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
 *
 * Each scope op also computes a `CASMutationHint` that describes its intent
 * (single-field patch, increment, array append, or full set). The hint flows
 * through to the persist callback so external-store adapters can route to
 * native delta verbs (`patchField` / `incField` / `pushToArray`) when
 * implemented; adapters without the verbs fall back to `set` transparently.
 */

import type {
  CASOptions,
  ScopeStateOps,
  StateContainer
} from "@flow-state-dev/core/types";
import { deepEqual } from "@flow-state-dev/core/helpers";
import {
  runWithCAS,
  type CASMutationHint,
  type CASPersist
} from "./cas";
import { withScopeLock } from "./scope-lock";

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
    this.state = initialState;
    this.version = Math.max(0, initialVersion);
  }

  /**
   * Returns the current state directly. Callers MUST treat the result as
   * immutable — the container hands out its internal reference rather than a
   * clone to avoid per-read deep-copy overhead on the CAS hot path. All
   * in-tree scope ops respect this by spreading into a fresh object before
   * mutating.
   */
  read(): Readonly<TState> {
    return this.state as Readonly<TState>;
  }

  getVersion(): number {
    return this.version;
  }

  commit(nextState: TState, version: number): Readonly<TState> {
    this.state = nextState;
    this.version = Math.max(0, version);
    return this.read();
  }
}

export type ScopeStateOpsOptions<TState extends object> = {
  cas?: CASOptions;
  /**
   * CAS-aware persist bridge into the underlying store. Invoked inside the
   * CAS retry loop with the proposed next state, the `expectedVersion` the
   * container believes is currently stored, and a `CASMutationHint`
   * describing intent so adapters can route to native delta verbs. Returns
   * the new version on success, or the store's current value/version on
   * conflict.
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
 *   `ConcurrentModificationError`. The `hint` is ignored — there is no
 *   external store to route to.
 * - When `persist` is defined the scope is external-store backed:
 *   `runWithCAS` drives the optimistic load → mutate → persist cycle with
 *   exponential backoff. The `hint` is forwarded to the persist callback
 *   unchanged across retries (it describes user intent, not derived state).
 *   `ConcurrentModificationError` still surfaces on retry exhaustion
 *   because a remote authority can advance the version underneath us.
 */
async function applyMutation<TState extends object>(
  container: StateContainer<TState>,
  options: ScopeStateOpsOptions<TState> | undefined,
  mutator: (state: Readonly<TState>) => TState | Promise<TState>,
  hint: CASMutationHint
): Promise<boolean> {
  const persist = options?.persist;

  if (persist === undefined) {
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
    hint
  });
  return committed;
}

const SET_HINT: CASMutationHint = { kind: "set" };

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
    // Hint selection follows the FIX-405 decision tree: a single own-property
    // patch with a non-function value (literal form) or any keyed-updater call
    // routes to `patchField`; everything else (multi-field, computed shape)
    // falls back to `set`. The persist callback reads the concrete value out
    // of `nextState` after the mutator runs.
    let hint: CASMutationHint = SET_HINT;
    if (typeof updatesOrKey === "object" && updatesOrKey !== null) {
      const keys = Object.keys(updatesOrKey as Record<string, unknown>);
      if (keys.length === 1) {
        const onlyKey = keys[0] as string;
        const onlyValue = (updatesOrKey as Record<string, unknown>)[onlyKey];
        if (typeof onlyValue !== "function") {
          hint = { kind: "patchField", path: [onlyKey] };
        }
      }
    } else if (updater !== undefined) {
      hint = { kind: "patchField", path: [String(updatesOrKey)] };
    }

    return applyMutation(
      container,
      options,
      async (state) => {
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
      },
      hint
    );
  }

  async function setState(nextState: TState): Promise<boolean> {
    return applyMutation(container, options, async () => nextState, SET_HINT);
  }

  async function incState(increments: Record<string, number>): Promise<boolean> {
    // Single numeric increment routes to `incField` with the user-provided
    // delta (invariant across CAS retries). Multi-field increments fall back
    // to `set` — decomposing into N `incField` calls would bump the version
    // counter per field and break single-version semantics for one logical
    // mutation.
    const entries = Object.entries(increments);
    const hint: CASMutationHint =
      entries.length === 1
        ? { kind: "incField", path: [entries[0][0]], delta: entries[0][1] }
        : SET_HINT;

    return applyMutation(
      container,
      options,
      async (state) => {
        const next = {
          ...state
        } as Record<string, unknown>;

        for (const [field, increment] of entries) {
          const current = next[field];
          const currentNumber =
            typeof current === "number" ? current : 0;
          next[field] = currentNumber + increment;
        }

        return next as TState;
      },
      hint
    );
  }

  async function pushState(field: string, value: unknown): Promise<boolean> {
    const hint: CASMutationHint = {
      kind: "pushToArray",
      path: [field],
      values: [value]
    };

    return applyMutation(
      container,
      options,
      async (state) => {
        const next = {
          ...state
        } as Record<string, unknown>;

        const currentArray = toArray(next[field]);
        next[field] = [...currentArray, value];
        return next as TState;
      },
      hint
    );
  }

  async function setStateRecord(
    field: string,
    key: string,
    value: unknown
  ): Promise<boolean> {
    // Depth-2 path: v1 keeps the `set` fallback. Native depth>1 patching is a
    // follow-up if usage warrants it (audit showed ~7% of patches are nested).
    return applyMutation(
      container,
      options,
      async (state) => {
        const next = {
          ...state
        } as Record<string, unknown>;
        const currentRecord = toRecord(next[field]);
        next[field] = {
          ...currentRecord,
          [key]: value
        };
        return next as TState;
      },
      SET_HINT
    );
  }

  async function deleteStateRecord(
    field: string,
    key: string
  ): Promise<boolean> {
    return applyMutation(
      container,
      options,
      async (state) => {
        const next = {
          ...state
        } as Record<string, unknown>;
        const currentRecord = {
          ...toRecord(next[field])
        };
        delete currentRecord[key];
        next[field] = currentRecord;
        return next as TState;
      },
      SET_HINT
    );
  }

  async function atomicState(
    mutator: (state: Readonly<TState>) => Partial<TState>
  ): Promise<boolean> {
    return applyMutation(
      container,
      options,
      async (state) => {
        const patch = mutator(state);
        return {
          ...state,
          ...patch
        };
      },
      SET_HINT
    );
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
