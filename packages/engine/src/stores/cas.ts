/**
 * CAS retry loop used by scope state ops.
 *
 * **There are two CAS drivers in this package, and this is the scope one.**
 * Resource state has its own (`./resource-cas.ts`) rather than calling this,
 * because its conflict *policy* differs even though the shape does not: a
 * conflict against a deleted resource and a losing create-if-absent are both
 * terminal there, where this driver retries every conflict; and it takes an
 * `AbortSignal`, which this one does not. Both suppress a no-op only against
 * a re-read, verified version (see `CASReread`). That
 * file's header carries the full policy table. Changing anything below is
 * worth checking against it, since the two are meant to diverge deliberately
 * rather than drift.
 *
 * Drives the classic load → mutate → persist cycle with exponential backoff
 * on conflict. The `persist` callback is the caller's bridge into the store
 * layer — it takes the proposed next state plus the `expectedVersion` the
 * container currently holds, performs a CAS-aware `Store.set` (or a delta
 * verb when the hint allows), and returns either the new version or the
 * store's current value/version on conflict. On conflict the container is
 * refreshed so the next retry's mutator sees the real current state, not
 * the stale in-request cache.
 */

import type { CASOptions, StateContainer } from "@flow-state-dev/core/types";
import { deepEqual } from "@flow-state-dev/core/helpers";
import { ConcurrentModificationError } from "../errors/flow-error";

export { ConcurrentModificationError };

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 10;

export type CASMutator<TState> = (
  state: Readonly<TState>
) => TState | Promise<TState>;

/**
 * Describes the intent of a scope-state mutation so the persist callback can
 * route to a native delta verb on the underlying store when one is available.
 *
 * The hint is computed at the scope-op call site (it captures user intent —
 * "increment this counter by 1") and is invariant across CAS retries. The
 * persist callback feature-detects whether the adapter implements the verb
 * and falls back to `set` with the full record when it does not.
 *
 * `patchField` carries only the path; the value is read from `nextState`
 * after the mutator runs, which makes the hint usable for both literal
 * (`patchState({ foo: 5 })`) and computed (`patchState('foo', updater)`)
 * shapes uniformly.
 */
export type CASMutationHint =
  | { kind: "set" }
  | { kind: "patchField"; path: [string] | [string, string]; commutative: boolean }
  | { kind: "incField"; path: [string]; delta: number }
  | { kind: "pushToArray"; path: [string]; values: unknown[] }
  | { kind: "deleteField"; path: [string, string] };

/**
 * Returns true when the hint describes a commutative or blind write that can
 * bypass the CAS version gate and apply unconditionally in the store.
 */
export function isCommutativeHint(hint: CASMutationHint): boolean {
  switch (hint.kind) {
    case "incField":
    case "pushToArray":
    case "deleteField":
      return true;
    case "patchField":
      return hint.commutative;
    default:
      return false;
  }
}

/**
 * Outcome of the persist callback. On conflict the caller reports the current
 * stored state and version so the CAS loop can refresh the container cache
 * before the next retry.
 */
export type CASPersistResult<TState> =
  | { ok: true; version: number; record?: TState }
  | {
      ok: false;
      currentState: TState | undefined;
      currentVersion: number;
    };

export type CASPersist<TState> = (
  state: Readonly<TState>,
  expectedVersion: number,
  hint: CASMutationHint
) => Promise<CASPersistResult<TState>>;

/**
 * Re-reads the stored state and version, used to verify a deep-equal no-op
 * before skipping `persist`. Resolves `undefined` when no record exists.
 */
export type CASReread<TState> = () => Promise<
  { state: TState; version: number } | undefined
>;

export type RunWithCASOptions<TState> = {
  container: StateContainer<TState>;
  mutator: CASMutator<TState>;
  persist: CASPersist<TState>;
  /**
   * Verifies a no-op against the store. When the mutator's output equals the
   * container's cached state, the cache may be stale: another writer can have
   * changed the stored value since this context last read it. The skip is
   * taken only when `reread` confirms the stored version is the one the
   * container holds. Without `reread` the skip cannot be verified, so the
   * write goes to `persist` and its version check decides.
   */
  reread?: CASReread<TState>;
  options?: CASOptions;
  /**
   * Intent hint forwarded to `persist`. Defaults to `{ kind: "set" }` when
   * omitted, preserving prior behavior for callers that haven't migrated.
   */
  hint?: CASMutationHint;
};

/**
 * Retries a scope CAS write gets after its first attempt: `maxRetries`,
 * default 3, floored at 0. Shared with the session-record write in
 * `createExecutionContext` so both honour one `flow.session.cas` budget.
 */
export function casMaxRetries(options?: CASOptions): number {
  return Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
}

/**
 * Waits out the exponential backoff before retry number `attempt` (1-based):
 * `baseDelayMs * 2^(attempt - 1)`, base default 10ms. Not abortable — see
 * `./resource-cas.ts` for the driver that needs that.
 */
export function waitForCASRetry(attempt: number, options?: CASOptions): Promise<void> {
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const ms = baseDelayMs * Math.pow(2, attempt - 1);
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Outcome of `runWithCAS`. `committed` is `false` only for a verified no-op:
 * the proposed next state equalled the stored state at a version `reread`
 * confirmed (or no record exists to write to). No persist call was made, no
 * version bump, and the caller should skip downstream side effects like SSE
 * emits.
 */
export type RunWithCASResult<TState> = {
  state: Readonly<TState>;
  committed: boolean;
};

const SET_HINT: CASMutationHint = { kind: "set" };

export async function runWithCAS<TState>({
  container,
  mutator,
  persist,
  reread,
  options,
  hint
}: RunWithCASOptions<TState>): Promise<RunWithCASResult<TState>> {
  const maxRetries = casMaxRetries(options);
  const persistHint = hint ?? SET_HINT;

  let attempt = 0;
  while (attempt <= maxRetries) {
    const current = container.read();

    const expectedVersion = container.getVersion();
    const nextState = await mutator(current);

    // No-op short-circuit, verified only. `current` is this context's cached
    // copy, which another writer may have replaced since it was read: a
    // mutator that deliberately restores that cached value would be skipped
    // while the other writer's value stays stored. So skip only when the
    // store confirms it still holds the version we hold; if it moved, refresh
    // and re-run the mutator against the real value, like a conflict.
    if (deepEqual(current, nextState) && reread !== undefined) {
      const fresh = await reread();
      if (fresh === undefined || fresh.version === expectedVersion) {
        return { state: current, committed: false };
      }
      container.commit(fresh.state, fresh.version);
      attempt += 1;
      if (attempt > maxRetries) {
        break;
      }
      await waitForCASRetry(attempt, options);
      continue;
    }

    const result = await persist(nextState, expectedVersion, persistHint);

    if (result.ok) {
      return { state: container.commit(nextState, result.version), committed: true };
    }

    // Conflict: refresh the container with the store's current state so the
    // next attempt's mutator sees the real current state. When the store has
    // no current value (deleted between read and write), fall back to the
    // previously cached state — the next persist will still detect the
    // mismatch via its own expectedVersion check.
    const refreshedState =
      result.currentState ?? (container.read() as TState);
    container.commit(refreshedState, result.currentVersion);

    attempt += 1;
    if (attempt > maxRetries) {
      break;
    }

    await waitForCASRetry(attempt, options);
  }

  throw new ConcurrentModificationError(
    "State update failed due to concurrent modifications",
    maxRetries + 1
  );
}
