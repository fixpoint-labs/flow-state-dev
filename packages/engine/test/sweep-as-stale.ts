/**
 * Test helper: run the stale-request sweep with a threshold of 0 only once
 * every heartbeat in the active-request registry is strictly in the past.
 *
 * Every store treats an entry as stale only when its last heartbeat is
 * strictly older than now minus the threshold. At threshold 0, an entry
 * registered or beaten in the same millisecond as the sweep is not stale, so
 * a test that sweeps right after a fast in-memory run, or while a run is
 * heartbeating, can miss the entry it means to sweep.
 */
import { detectInterruptedRequests } from "../src/execution/request-recovery";

/**
 * Wait until `Date.now()` is past the latest `lastHeartbeatAt` in the
 * registry, then sweep with `staleThresholdMs: 0`. Every entry registered so
 * far, including one whose run is still heartbeating, is swept as stale: on
 * the in-memory stores only microtasks separate the check from the sweep's
 * read of the clock, and a heartbeat is a timer callback, so no beat can land
 * between them.
 */
export async function sweepAsStale(
  stores: Parameters<typeof detectInterruptedRequests>[0]["stores"]
): ReturnType<typeof detectInterruptedRequests> {
  for (;;) {
    const entries = await stores.activeRequests.listAll();
    const lastBeat = Math.max(-Infinity, ...entries.map((entry) => entry.lastHeartbeatAt));
    if (Date.now() > lastBeat) {
      return detectInterruptedRequests({ stores, staleThresholdMs: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
