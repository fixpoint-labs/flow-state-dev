/**
 * CAS retry loop used by scope state ops.
 *
 * Drives the classic load → mutate → persist cycle with exponential backoff
 * on conflict. The `persist` callback is the caller's bridge into the store
 * layer — it takes the proposed next state plus the `expectedVersion` the
 * container currently holds, performs a CAS-aware `Store.set`, and returns
 * either the new version or the store's current value/version on conflict.
 * On conflict the container is refreshed so the next retry's mutator sees
 * the real current state, not the stale in-request cache.
 */

import type { CASOptions, StateContainer } from "@flow-state-dev/core/types";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 10;

export class ConcurrentModificationError extends Error {
  readonly code: string;
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "ConcurrentModificationError";
    this.code = "CONCURRENT_MODIFICATION";
    this.attempts = attempts;
  }
}

export type CASMutator<TState> = (
  state: Readonly<TState>
) => TState | Promise<TState>;

/**
 * Outcome of the persist callback. On conflict the caller reports the current
 * stored state and version so the CAS loop can refresh the container cache
 * before the next retry.
 */
export type CASPersistResult<TState> =
  | { ok: true; version: number }
  | {
      ok: false;
      currentState: TState | undefined;
      currentVersion: number;
    };

export type CASPersist<TState> = (
  state: Readonly<TState>,
  expectedVersion: number
) => Promise<CASPersistResult<TState>>;

export type RunWithCASOptions<TState> = {
  container: StateContainer<TState>;
  mutator: CASMutator<TState>;
  persist: CASPersist<TState>;
  options?: CASOptions;
  maxStateSizeBytes?: number;
  onStateSizeWarning?: (detail: {
    sizeBytes: number;
    maxStateSizeBytes: number;
  }) => void;
};

const DEFAULT_MAX_STATE_SIZE_BYTES = 10 * 1024;

function estimateSizeBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runWithCAS<TState>({
  container,
  mutator,
  persist,
  options,
  maxStateSizeBytes,
  onStateSizeWarning
}: RunWithCASOptions<TState>): Promise<Readonly<TState>> {
  const maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const sizeThreshold = maxStateSizeBytes ?? DEFAULT_MAX_STATE_SIZE_BYTES;

  let attempt = 0;
  while (attempt <= maxRetries) {
    const current = container.read();
    const currentSizeBytes = estimateSizeBytes(current);
    if (currentSizeBytes > sizeThreshold) {
      onStateSizeWarning?.({
        sizeBytes: currentSizeBytes,
        maxStateSizeBytes: sizeThreshold
      });
    }

    const expectedVersion = container.getVersion();
    const nextState = await mutator(current);
    const result = await persist(nextState, expectedVersion);

    if (result.ok) {
      return container.commit(nextState, result.version);
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

    const delay = baseDelayMs * Math.pow(2, attempt - 1);
    await wait(delay);
  }

  throw new ConcurrentModificationError(
    "State update failed due to concurrent modifications",
    maxRetries + 1
  );
}
