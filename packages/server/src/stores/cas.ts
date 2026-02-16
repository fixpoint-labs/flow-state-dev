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

export type RunWithCASOptions<TState> = {
  container: StateContainer<TState>;
  mutator: CASMutator<TState>;
  options?: CASOptions;
};

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
  options
}: RunWithCASOptions<TState>): Promise<Readonly<TState>> {
  const maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);

  let attempt = 0;
  while (attempt <= maxRetries) {
    const current = container.read();
    const expectedVersion = container.getVersion();
    const nextState = await mutator(current);
    const persisted = await container.persist(nextState, expectedVersion);

    if (persisted !== null) {
      return persisted;
    }

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
