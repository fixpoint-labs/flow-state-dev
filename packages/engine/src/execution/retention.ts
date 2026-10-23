/**
 * Session retention policy enforcement.
 * Evicts old past turns (completed or interrupted request records,
 * `past-turns.ts`) when a session exceeds configured limits.
 * Runs lazily after each request completes (no background process).
 */
import type { RetentionPolicy } from "@flow-state-dev/core/types";
import type { RequestRecord, StoreRegistry } from "../stores/types";
import { parseDuration } from "../utils/duration";
import { resolveLiveTailLivenessMs } from "../streaming/live-tail-liveness";
import { DEFAULT_STALE_SWEEP_THRESHOLD_MS } from "../runtime-config";
import type { DurabilityProvider } from "../durability/types";
import { PAST_TURN_STATUSES } from "./past-turns";
import { parkedInterruptedIds } from "../durability/stop-suspended";

const RETENTION_COUNT_BATCH_SIZE = 16;

/** When a past turn ended: its completion, or when it was found interrupted. */
const endedAt = (r: RequestRecord): number => r.completedAtMs ?? r.interruptedAt ?? r.startedAtMs;

/**
 * Pre-resolved retention policy with maxAge converted to milliseconds.
 * Resolve once at action start, not on every write.
 */
export type ResolvedRetentionPolicy = {
  maxItems?: number;
  maxAgeMs?: number;
  /**
   * How long after a request's run has finished it stays exempt from
   * eviction, measured from `finalizedAtMs` (or, on a record from before that
   * field, from its completion). A live-tail stream may still be following the
   * request; deleting it earlier frees the id while that stream reads it, and
   * whoever takes the id next could have their own run read by it.
   * `resolveRetentionPolicy` always sets it; absent means no window.
   */
  terminalGraceMs?: number;
  /**
   * The rollout-safety bound: how long after completion a record with no
   * `finalizedAtMs` field at all stays exempt. Such a record was written by a
   * version that never stamps, so nothing says when its run stopped writing;
   * during a rolling deploy that run may still be in `onFinished` on an old
   * instance. It is held for the stale-request threshold (the point at which a
   * run with no heartbeat counts as dead) or `maxAge`, whichever is larger,
   * plus `terminalGraceMs`. `resolveRetentionPolicy` always sets it; absent
   * means `terminalGraceMs` alone.
   */
  legacyGraceMs?: number;
};

/**
 * Converts a user-facing RetentionPolicy config into numeric milliseconds.
 */
export function resolveRetentionPolicy(
  policy: RetentionPolicy | undefined,
  options: {
    /** The host's stale-request threshold; the larger of it and the default is used. */
    staleThresholdMs?: number;
  } = {}
): ResolvedRetentionPolicy | undefined {
  if (policy === undefined) return undefined;
  if (policy.maxItems === undefined && policy.maxAge === undefined) return undefined;
  const maxAgeMs = policy.maxAge !== undefined ? parseDuration(policy.maxAge) : undefined;
  // One liveness timeout for any stream still tailing the request to end,
  // and one more as margin: the stamp and this pass may read different
  // clocks.
  const terminalGraceMs = 2 * resolveLiveTailLivenessMs();
  const staleThresholdMs = Math.max(
    options.staleThresholdMs ?? 0,
    DEFAULT_STALE_SWEEP_THRESHOLD_MS
  );
  return {
    maxItems: policy.maxItems,
    maxAgeMs,
    terminalGraceMs,
    legacyGraceMs: Math.max(staleThresholdMs, maxAgeMs ?? 0) + terminalGraceMs,
  };
}

/**
 * Applies retention policy to a session's past turns: the same set history
 * reads (`PAST_TURN_STATUSES`), so a turn retention would delete stops
 * reaching prompts too.
 *
 * Eviction operates at request granularity — entire old requests are removed,
 * not individual items within a request. The current request is never evicted,
 * and neither is a parked interrupted request (a pending gate, or a logged
 * gate owed a re-drive: `parkedInterruptedIds`), which `provider` reads (none
 * is parked without one: nothing can suspend). An interrupted record nothing
 * else protects is read whole to find its last gate. A failed read rejects,
 * and nothing is deleted. A record is deleted only while it is still in the
 * status it was judged in (`RequestStore.deleteIfStatus`).
 */
export async function applyRetentionPolicy(
  stores: StoreRegistry,
  sessionId: string,
  currentRequestId: string,
  policy: ResolvedRetentionPolicy,
  now: number = Date.now(),
  tenantId?: string,
  provider?: Pick<DurabilityProvider, "listSuspended" | "loadSuspension">
): Promise<{ deletedRequestIds: string[] }> {
  const deletedRequestIds: string[] = [];

  const requests = await stores.request.list({
    sessionId,
    // Scope the prune to this request's tenant (FIX-682). Retention is
    // otherwise tenant-blind (no separate per-tenant policy), but a per-session
    // prune must never delete another tenant's requests that share a bare
    // session id. Always pass the tenant (possibly undefined).
    tenantId,
    status: PAST_TURN_STATUSES,
    // No `withItems` — maxAge needs only timestamps and maxItems counts via
    // `countItems`, so item payloads stay out of the retention read (FIX-685).
  });

  // A request's record turns `completed` before its run has finished writing
  // (the terminal event and `onFinished` follow), and a live-tail stream may
  // still be following it. Deleting it then would free the id while either is
  // active, so a request is evictable only once its run has stamped
  // `finalizedAtMs` and the grace window has passed since. Time alone cannot
  // stand in for the stamp: `onFinished` is unbounded, and a process-local
  // registry cannot see a run in another process. A run that dies before
  // stamping is stamped by the stale-request sweep if it was heartbeating
  // through its tail; otherwise its record is kept.
  //
  // - `finalizedAtMs: null` — the run has not finished: never evicted here.
  // - absent — written by a version that never stamps (BP-030). During a
  //   rolling deploy its run may still be writing on an old instance, so it is
  //   held for `legacyGraceMs` after completion (the rollout-safety bound, see
  //   `ResolvedRetentionPolicy`), never for the short grace window alone.
  //
  // A request still in the active registry is skipped too, as a cheap extra
  // check. Skipped requests are evicted by a later pass, which runs when the
  // session's next request completes: retention is lazy, and a session nothing
  // is written to is not growing.
  //
  // Only the deletion of a protected request waits. Its items are still
  // history the session holds, so they count toward `maxItems` below, and
  // evictable history makes room for them.
  const graceCutoff = now - (policy.terminalGraceMs ?? 0);
  const legacyCutoff = now - (policy.legacyGraceMs ?? policy.terminalGraceMs ?? 0);
  const stillRunning = new Set(
    (await stores.activeRequests.listAll()).map((entry) => entry.requestId)
  );
  const isEvictable = (r: RequestRecord): boolean => {
    // An interrupted record the stale sweep wrote has no run left to stamp
    // `finalizedAtMs`: it is held for the rollout-safety bound after the
    // sweep marked it, like a record from a version that never stamps.
    if (r.status === "interrupted" && typeof r.finalizedAtMs !== "number") {
      return (r.interruptedAt ?? r.startedAtMs) <= legacyCutoff;
    }
    if (r.finalizedAtMs === null) return false;
    if (r.finalizedAtMs === undefined) {
      return (r.completedAtMs ?? r.startedAtMs) <= legacyCutoff;
    }
    return r.finalizedAtMs <= graceCutoff;
  };

  // Exclude current request, sort oldest-first by when each turn ended
  const history = requests.filter((r) => r.id !== currentRequestId);
  // The list carries no items; a parked check needs an interrupted record's
  // log, so only the interrupted records nothing else protects are read whole.
  // A failed read must abort the pass (it rejects), never default to "not
  // parked": that would delete a request a resume or re-drive still drives.
  const heldAnyway = (r: RequestRecord): boolean => stillRunning.has(r.id) || !isEvictable(r);
  const interruptedLogs =
    provider === undefined
      ? []
      : (
          await Promise.all(
            history.filter((r) => r.status === "interrupted" && !heldAnyway(r)).map((r) => stores.request.get(r.id))
          )
        ).filter((r): r is RequestRecord => r !== undefined);
  const parked = await parkedInterruptedIds(provider, interruptedLogs);
  const isProtected = (r: RequestRecord): boolean => heldAnyway(r) || parked.has(r.id);
  const protectedIds = history.filter(isProtected).map((r) => r.id);
  const sorted = history
    .filter((r) => !isProtected(r))
    .sort((a, b) => endedAt(a) - endedAt(b));

  let remaining = sorted;

  // Each record was judged by the status it was listed in, and is deleted
  // only while it still has it. The durability sweep can re-drive an
  // interrupted turn in between (`interrupted` → `in_progress`); that record
  // is a running request again and is left alone. There is deliberately no
  // incarnation fence: for the record to be back in the judged status, a
  // re-driven run would have to go back to `interrupted`, which takes at least
  // the stale-request threshold, far longer than this pass.
  const evict = async (req: RequestRecord): Promise<void> => {
    const { applied } = await stores.request.deleteIfStatus(req.id, [req.status]);
    if (applied) deletedRequestIds.push(req.id);
  };

  // Phase 1: maxAge — delete turns that ended before the cutoff
  if (policy.maxAgeMs !== undefined) {
    const cutoff = now - policy.maxAgeMs;
    const expired: RequestRecord[] = [];
    const kept: typeof sorted = [];
    for (const req of remaining) {
      if (endedAt(req) < cutoff) {
        expired.push(req);
      } else {
        kept.push(req);
      }
    }
    for (const req of expired) await evict(req);
    remaining = kept;
  }

  // Phase 2: maxItems — count items from newest requests, evict the rest
  if (policy.maxItems !== undefined) {
    const maxItems = policy.maxItems;
    // Count in bounded batches so attacker-grown histories cannot enqueue an
    // unbounded burst of database work. The current request and protected
    // requests are always kept; count them too.
    const newestFirst = [...remaining].reverse();
    const requestIds = [
      currentRequestId,
      ...protectedIds,
      ...newestFirst.map((req) => req.id)
    ];
    const counts: number[] = [];
    for (let i = 0; i < requestIds.length; i += RETENTION_COUNT_BATCH_SIZE) {
      counts.push(
        ...(await Promise.all(
          requestIds
            .slice(i, i + RETENTION_COUNT_BATCH_SIZE)
            .map((id) => stores.request.countItems(id))
        ))
      );
    }
    const keptCounts = counts.slice(0, 1 + protectedIds.length);
    const historyCounts = counts.slice(1 + protectedIds.length);

    // Walk newest-first, accumulating items until budget is exceeded
    let totalItems = keptCounts.reduce((sum, n) => sum + n, 0);
    const keep = new Set<string>();
    newestFirst.forEach((req, i) => {
      const reqItemCount = historyCounts[i] ?? 0;
      if (totalItems + reqItemCount <= maxItems) {
        totalItems += reqItemCount;
        keep.add(req.id);
      }
    });

    // Delete requests that didn't fit
    for (const req of remaining) {
      if (!keep.has(req.id)) await evict(req);
    }
  }

  return { deletedRequestIds };
}
