/**
 * In-flight scan helper for the scheduled adapter.
 *
 * Resolves the question "is there an active request for this
 * `(flowKind, scheduleId)` right now?" by scanning the active-request
 * registry. The adapter calls this when a schedule's `onOverlap` policy
 * is `"skip"` (the default) — a non-null result short-circuits the
 * dispatch with a 200 `{ status: "skipped" }`.
 *
 * This lives in the scheduled package, not on the
 * `ActiveRequestRegistry` interface itself: the v1 cardinality of
 * in-flight scheduled requests is tiny and the scan over `listAll()`
 * keeps every store backend free of churn. Promoting to an interface
 * method with backend-specific indexes is a non-breaking follow-up if
 * production telemetry shows the scan as hot.
 */
import type {
  ActiveRequestEntry,
  ActiveRequestRegistry
} from "@flow-state-dev/server";
import { SCHEDULED_TRANSPORT_SOURCE } from "./createScheduledTransportAdapter";

export async function findScheduledRequest(
  registry: ActiveRequestRegistry,
  flowKind: string,
  scheduleId: string
): Promise<ActiveRequestEntry | null> {
  const entries = await registry.listAll();
  for (const entry of entries) {
    if (entry.flowKind !== flowKind) continue;
    if (entry.source !== SCHEDULED_TRANSPORT_SOURCE) continue;
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (meta?.scheduleId === scheduleId) return entry;
  }
  return null;
}
