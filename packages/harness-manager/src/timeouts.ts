/**
 * How long a call that answers over the network may take.
 *
 * Bounds the phase's own hooks (the prompt builder, the completion check) and
 * any listing a host's phase makes with `gh`: generous for a slow API, far
 * short of a coding run's own deadline, so the verdict is never the thing that
 * hangs. `harnessDrainBudgetMs` reserves it twice.
 *
 * Every child process this package's callers start goes through
 * `@flow-state-dev/workspace`'s `run`; this is the one wait of their own that
 * the manager sizes.
 */
export const NETWORK_CALL_TIMEOUT_MS = 60_000;
