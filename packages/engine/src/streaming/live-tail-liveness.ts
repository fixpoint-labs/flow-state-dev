/**
 * How long a live-tail stream waits in silence before it gives up on a
 * request. The stream route passes it to `RequestStore.subscribeToEvents`,
 * and session retention derives its terminal grace window from it: a request
 * is only evicted once every stream that was tailing it has ended.
 */

/** Default live-tail liveness timeout, overridable via `LIVE_TAIL_LIVENESS_MS`. */
export const DEFAULT_LIVE_TAIL_LIVENESS_MS = 30_000;

/** The effective live-tail liveness timeout for this process, in milliseconds. */
export function resolveLiveTailLivenessMs(): number {
  const raw = process.env.LIVE_TAIL_LIVENESS_MS;
  if (raw === undefined || raw === "") return DEFAULT_LIVE_TAIL_LIVENESS_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIVE_TAIL_LIVENESS_MS;
}
