/**
 * Session retention policy enforcement.
 * Evicts old completed request records when a session exceeds configured limits.
 * Runs lazily after each request completes (no background process).
 */
import type { RetentionPolicy } from "@flow-state-dev/core/types";
import type { RequestRecord, StoreRegistry } from "../stores/types";
import { parseDuration } from "../utils/duration";
import { resolveLiveTailLivenessMs } from "../streaming/live-tail-liveness";
import { DEFAULT_STALE_SWEEP_THRESHOLD_MS } from "../runtime-config";

const RETENTION_COUNT_BATCH_SIZE = 16;

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
 * Applies retention policy to a session's completed request history.
 *
 * Eviction operates at request granularity — entire old requests are removed,
 * not individual items within a request. The current request is never evicted.
 */
export async function applyRetentionPolicy(
  stores: StoreRegistry,
  sessionId: string,
  currentRequestId: string,
  policy: ResolvedRetentionPolicy,
  now: number = Date.now(),
  tenantId?: string
): Promise<{ deletedRequestIds: string[] }> {
  const deletedRequestIds: string[] = [];

  const requests = await stores.request.list({
    sessionId,
    // Scope the prune to this request's tenant (FIX-682). Retention is
    // otherwise tenant-blind (no separate per-tenant policy), but a per-session
    // prune must never delete another tenant's requests that share a bare
    // session id. Always pass the tenant (possibly undefined).
    tenantId,
    status: "completed",
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
  // stamping is stamped by the stale-request sweep.
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
  const graceCutoff = now - (policy.terminalGraceMs ?? 0);
  const legacyCutoff = now - (policy.legacyGraceMs ?? policy.terminalGraceMs ?? 0);
  const stillRunning = new Set(
    (await stores.activeRequests.listAll()).map((entry) => entry.requestId)
  );
  const isEvictable = (r: RequestRecord): boolean => {
    if (r.finalizedAtMs === null) return false;
    if (r.finalizedAtMs === undefined) {
      return (r.completedAtMs ?? r.startedAtMs) <= legacyCutoff;
    }
    return r.finalizedAtMs <= graceCutoff;
  };

  // Exclude current request, sort oldest-first by completion time
  const sorted = requests
    .filter((r) => {
      if (r.id === currentRequestId || stillRunning.has(r.id)) return false;
      return isEvictable(r);
    })
    .sort(
      (a, b) =>
        (a.completedAtMs ?? a.startedAtMs) - (b.completedAtMs ?? b.startedAtMs)
    );

  let remaining = sorted;

  // Phase 1: maxAge — delete requests completed before the cutoff
  if (policy.maxAgeMs !== undefined) {
    const cutoff = now - policy.maxAgeMs;
    const expired: string[] = [];
    const kept: typeof sorted = [];
    for (const req of remaining) {
      if ((req.completedAtMs ?? req.startedAtMs) < cutoff) {
        expired.push(req.id);
      } else {
        kept.push(req);
      }
    }
    for (const id of expired) {
      await stores.request.delete(id);
      deletedRequestIds.push(id);
    }
    remaining = kept;
  }

  // Phase 2: maxItems — count items from newest requests, evict the rest
  if (policy.maxItems !== undefined) {
    const maxItems = policy.maxItems;
    // Count in bounded batches so attacker-grown histories cannot enqueue an
    // unbounded burst of database work. The current request is always kept;
    // count it too.
    const newestFirst = [...remaining].reverse();
    const requestIds = [currentRequestId, ...newestFirst.map((req) => req.id)];
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
    const [currentCount = 0, ...historyCounts] = counts;

    // Walk newest-first, accumulating items until budget is exceeded
    let totalItems = currentCount;
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
      if (!keep.has(req.id)) {
        await stores.request.delete(req.id);
        deletedRequestIds.push(req.id);
      }
    }
  }

  return { deletedRequestIds };
}
