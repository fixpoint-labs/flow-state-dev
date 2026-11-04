/**
 * The client's reconnect delay: 1 s, doubling, at most 30 s. Shared by the
 * session stream and `subscribe`'s socket, which each decide for themselves
 * when a try counts as failed and when to start over.
 */

/** The first delay. */
export const BACKOFF_INITIAL_MS = 1_000;
/** The longest delay. */
export const BACKOFF_MAX_MS = 30_000;

/** The delay before try `attempt` (0 for the first retry). */
export function backoffDelay(attempt: number, initialMs = BACKOFF_INITIAL_MS, maxMs = BACKOFF_MAX_MS): number {
  return Math.min(maxMs, initialMs * 2 ** Math.max(0, attempt));
}
