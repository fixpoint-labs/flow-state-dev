/**
 * The liveness read backing the seam's batch liveness verb (FIX-999).
 *
 * Answers, per request id the caller supplied, whether that request still has a
 * live registration. Nothing else crosses: not an entry, not a record, not
 * another tenant's row.
 *
 * **`false` means "no live registration was found", never "definitely dead."** A
 * request that completed, one that was never registered, and one whose
 * registration was lost are indistinguishable here by construction, because
 * terminal requests are deregistered. A consumer may treat `false` as permission
 * to stop waiting; it must never treat it as proof the work did not happen.
 * Re-dispatching on a `false` answer alone is how double execution ships.
 */
import type { ActiveRequestEntry, ActiveRequestRegistry } from "../stores/types";
import type { LivenessAnswers } from "@flow-state-dev/core/types";

export type LivenessReadInputs = {
  /**
   * Only `get` is used. `listAll()` is not reachable from this seam (it
   * enumerates across tenants) and `listStale()` cannot answer the question at
   * all — see the note on freshness below.
   */
  registry: Pick<ActiveRequestRegistry, "get">;
  /** From the enablement gate. Entries older than this are treated as not live. */
  staleThresholdMs: number;
  /** The running request's server-derived principal. Never caller-supplied. */
  principal: { userId: string; tenantId: string | undefined };
  /** Whether a session lies in the caller's descendant chain. */
  isDescendantSession: (sessionId: string | undefined) => Promise<boolean>;
  /** Injectable clock, for tests. */
  now?: () => number;
};

/**
 * Whether an entry is fresh enough to count as live.
 *
 * The stale sweeper is what normally removes a crashed worker's entry, but its
 * cadence is independent of the threshold: a cadence much larger than the
 * threshold leaves a worker that died just after a sweep registered until the
 * next tick. A plain `get()` would report it alive for that entire window, which
 * blocks reconciliation on work that has already died. Comparing
 * `lastHeartbeatAt` here is correct however the cadence is configured, and adds
 * nothing for an operator to tune.
 */
function isFresh(entry: ActiveRequestEntry, nowMs: number, staleThresholdMs: number): boolean {
  return nowMs - entry.lastHeartbeatAt <= staleThresholdMs;
}

/**
 * Read liveness for a batch of request ids.
 *
 * Identity filters *before* the answer is built, so an id outside the caller's
 * lineage or under a different principal comes back indistinguishable from an
 * unknown id — there is no existence oracle here.
 *
 * The number of registry reads is bounded by the caller's own id set, never by
 * the registry's size. That is a real cost the set-shaped read appeared to avoid
 * and is the price of an answer that is correct.
 */
export async function readLiveness(
  requestIds: readonly string[],
  inputs: LivenessReadInputs
): Promise<LivenessAnswers> {
  const unique = Array.from(new Set(requestIds));
  if (unique.length === 0) return {};

  const nowMs = (inputs.now ?? Date.now)();
  const answers: Record<string, boolean> = {};

  await Promise.all(
    unique.map(async (requestId) => {
      const entry = await inputs.registry.get(requestId);

      // Absent: completed, never registered, or lost. All the same answer.
      if (entry === undefined) {
        answers[requestId] = false;
        return;
      }

      // Identity first — a caller must not learn that someone else's request
      // exists by observing a different shape of "no".
      if (entry.userId !== inputs.principal.userId) {
        answers[requestId] = false;
        return;
      }
      const entryTenant = entry.tenantId ?? undefined;
      const callerTenant = inputs.principal.tenantId ?? undefined;
      if (entryTenant !== callerTenant) {
        answers[requestId] = false;
        return;
      }
      if (!(await inputs.isDescendantSession(entry.sessionId))) {
        answers[requestId] = false;
        return;
      }

      answers[requestId] = isFresh(entry, nowMs, inputs.staleThresholdMs);
    })
  );

  return answers;
}
