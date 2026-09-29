/**
 * Session retention policy enforcement.
 * Evicts old completed request records when a session exceeds configured limits.
 * Runs lazily after each request completes (no background process).
 */
import type { RetentionPolicy } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import { parseDuration } from "../utils/duration";

const RETENTION_COUNT_BATCH_SIZE = 16;

/**
 * Pre-resolved retention policy with maxAge converted to milliseconds.
 * Resolve once at action start, not on every write.
 */
export type ResolvedRetentionPolicy = {
  maxItems?: number;
  maxAgeMs?: number;
};

/**
 * Converts a user-facing RetentionPolicy config into numeric milliseconds.
 */
export function resolveRetentionPolicy(
  policy: RetentionPolicy | undefined
): ResolvedRetentionPolicy | undefined {
  if (policy === undefined) return undefined;
  if (policy.maxItems === undefined && policy.maxAge === undefined) return undefined;
  return {
    maxItems: policy.maxItems,
    maxAgeMs: policy.maxAge !== undefined ? parseDuration(policy.maxAge) : undefined,
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

  // A request's record turns `completed` before its run has finished writing:
  // the terminal event and `onFinished` follow, and the run leaves the active
  // registry last. Deleting it in that window would free the id with the
  // run's last writes still to land under it, where the id's next owner
  // would replay them. Skip anything still registered; a later pass takes it.
  // One registry read, bounded by in-flight work rather than session history.
  const stillRunning = new Set(
    (await stores.activeRequests.listAll()).map((entry) => entry.requestId)
  );

  // Exclude current request, sort oldest-first by completion time
  const sorted = requests
    .filter((r) => r.id !== currentRequestId && !stillRunning.has(r.id))
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
