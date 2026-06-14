/**
 * Session retention policy enforcement.
 * Evicts old completed request records when a session exceeds configured limits.
 * Runs lazily after each request completes (no background process).
 */
import type { RetentionPolicy } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import { parseDuration } from "@flow-state-dev/core";

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
    // maxItems policy below counts `req.items.length` per request.
    withItems: true,
  });

  // Exclude current request, sort oldest-first by completion time
  const sorted = requests
    .filter((r) => r.id !== currentRequestId)
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
    // Count items in the current request (always kept)
    const currentRequest = await stores.request.get(currentRequestId);
    let totalItems = currentRequest?.items?.length ?? 0;

    // Walk newest-first, accumulating items until budget is exceeded
    const newestFirst = [...remaining].reverse();
    const keep = new Set<string>();
    for (const req of newestFirst) {
      const reqItemCount = req.items?.length ?? 0;
      if (totalItems + reqItemCount <= policy.maxItems) {
        totalItems += reqItemCount;
        keep.add(req.id);
      }
    }

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
