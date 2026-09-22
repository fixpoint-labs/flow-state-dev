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
 *
 * **`true` means "still live", which includes "queued and not yet started."** A
 * request handed to an external dispatcher is live from the moment it is
 * accepted, not from the moment a worker picks it up (FIX-999).
 */
import type { ActiveRequestEntry, ActiveRequestRegistry } from "../stores/types";
import type { FlowInstance, LivenessAnswers } from "@flow-state-dev/core/types";
import { matchesOrgFilter, tenantMatches } from "../stores/scope-keys";
import { ownsRecord } from "./record-owner";

export type LivenessReadInputs = {
  /**
   * Only `get` is used. `listAll()` is not reachable from this seam (it
   * enumerates across tenants) and `listStale()` cannot answer the question at
   * all — see the note on freshness below.
   */
  registry: Pick<ActiveRequestRegistry, "get">;
  /** From the enablement gate. Entries older than this are treated as not live. */
  staleThresholdMs: number;
  /**
   * The running flow instance. An entry another instance owns — another
   * kind, or a same-kind peer — is not this caller's work, even under the
   * same principal and session.
   */
  flow: FlowInstance;
  /**
   * The running request's server-derived principal. Never caller-supplied.
   *
   * `orgId` is read **only** by the dispatch-run arm below, which is the one
   * path that does not inherit the organization boundary by descent. Optional
   * so a host that supplies no arm is unaffected; a host that supplies one
   * without it gets refusals rather than a cross-organization answer.
   */
  principal: { userId: string; tenantId: string | undefined; orgId?: string };
  /** Whether a session lies in the caller's descendant chain. */
  isDescendantSession: (sessionId: string | undefined) => Promise<boolean>;
  /**
   * Whether a session is a dispatch run of this caller's own flow and principal
   * (FIX-1440) — the second arm, beside the descendant walk.
   *
   * Work a dispatcher started is a session of the flow in its own right, and
   * asking whether it is still running should not depend on where it hangs. So
   * a session that records a dispatching session, under this principal, tenant
   * and flow instance, answers here even when the walk does not reach it.
   *
   * It does **not** replace the walk. The walk re-checks principal, tenant and
   * flow at every hop and is what keeps this read from widening past a
   * subtree; dropping it would turn "work I started" into "anything of mine on
   * this flow", which is a security change rather than a navigation fix.
   *
   * Optional: a host that supplies neither arm gets the walk alone.
   */
  isDispatchRunOfCaller?: (sessionId: string | undefined) => Promise<boolean>;
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
 *
 * A queued-but-unclaimed entry is the one case where that comparison asks the
 * wrong question, so it is answered before the comparison rather than by tuning
 * it — see `queuedAt` on `ActiveRequestEntry` (FIX-999).
 */
function isFresh(entry: ActiveRequestEntry, nowMs: number, staleThresholdMs: number): boolean {
  // Accepted into an external queue, not yet claimed. No worker exists to beat
  // for it, so its age is queue wait, not death — it is live by construction.
  //
  // This is deliberately unbounded HERE. The bound lives in the one place that
  // can act on it: `detectInterruptedRequests` reaps an unclaimed entry once it
  // outlives the queued grace, and this read then sees no entry at all and says
  // `false`. Duplicating the grace here would put a second clock on the same
  // question, and the moment the two disagreed this read would start reporting
  // a row that still exists as dead — reintroducing the exact false negative
  // being fixed, just at a longer timescale.
  if (entry.queuedAt != null) return true;

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
      // The same null-vs-undefined-tolerant comparison every other
      // tenant-boundary check in the engine uses (BP-030), rather than a
      // second hand-rolled copy of it.
      if (!tenantMatches(entry.tenantId, inputs.principal.tenantId)) {
        answers[requestId] = false;
        return;
      }
      // Flow-instance identity, checked on the ENTRY rather than on a session
      // record. The descendant check below deliberately accepts the caller's
      // own session, so this is what stands between "a request I started" and
      // "any request the same principal happens to be running under this
      // session id" — including one a same-kind peer instance is running.
      if (!ownsRecord(inputs.flow, entry)) {
        answers[requestId] = false;
        return;
      }
      // Two arms, and the order is the cheap one first: a session in the
      // caller's own chain never reaches the second read.
      //
      // The organization is conjoined on the SECOND arm only, and on both the
      // entry here and the session record there. The walk gets the boundary for
      // free — a run in another organization is not in the caller's chain — but
      // one person can act for two organizations under one tenant, and the
      // runtime treats those as two identities. Checking it on the walk's path
      // too would narrow a shipped answer for a legacy entry that carries no
      // organization at all, which is not this change's to do.
      if (!(await inputs.isDescendantSession(entry.sessionId))) {
        const sameOrg = matchesOrgFilter({ orgId: inputs.principal.orgId }, entry.orgId);
        if (!sameOrg || !(await inputs.isDispatchRunOfCaller?.(entry.sessionId))) {
          answers[requestId] = false;
          return;
        }
      }

      answers[requestId] = isFresh(entry, nowMs, inputs.staleThresholdMs);
    })
  );

  return answers;
}
