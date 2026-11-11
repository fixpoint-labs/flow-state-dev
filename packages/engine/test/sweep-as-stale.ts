/**
 * Run the stale-request sweep in a test once every registered request's last
 * heartbeat is in the past.
 *
 * The sweep treats an entry as stale only when its last heartbeat is strictly
 * older than now minus the threshold, in every store. With the threshold at 0,
 * an entry registered or beaten in the same millisecond as the sweep is not
 * stale, so a test that sweeps right after a fast run, or while a run is
 * heartbeating, can miss the entry it means to sweep. On a warm worker a whole
 * in-memory run fits in one millisecond often enough to fail CI now and then
 * while the file passes on its own.
 */
import { detectInterruptedRequests } from "../src/execution/request-recovery";

type SweepOptions = Parameters<typeof detectInterruptedRequests>[0];

/**
 * Sweep with a threshold of 0 once the clock is past every heartbeat in the
 * active-request registry.
 *
 * The check and the sweep's own read of the clock are separated only by
 * microtasks on the in-memory stores, and a heartbeat is a timer callback, so
 * no beat can land between them: every entry registered so far is stale to the
 * sweep, including one whose run is still heartbeating.
 */
export async function sweepAsStale(
  stores: SweepOptions["stores"],
  options: Omit<SweepOptions, "stores" | "staleThresholdMs"> = {}
): ReturnType<typeof detectInterruptedRequests> {
  for (;;) {
    const entries = await stores.activeRequests.listAll();
    const lastBeat = Math.max(-Infinity, ...entries.map((entry) => entry.lastHeartbeatAt));
    if (Date.now() > lastBeat) {
      return detectInterruptedRequests({ ...options, stores, staleThresholdMs: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
