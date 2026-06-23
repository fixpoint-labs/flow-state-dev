/**
 * Find an in-flight scheduled request matching `(flowKind, scheduleId)`.
 * Used by the dispatch handler to honor `onOverlap: "skip"`.
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
    // Coordinate lives under the namespaced `metadata.schedule` slot (FIX-838),
    // matching what the dispatch handler stamps. Also read the legacy top-level
    // `metadata.scheduleId` so `onOverlap: "skip"` still matches requests that
    // were enqueued by the pre-namespacing build and are still in-flight across
    // a rolling deploy.
    // TODO(FIX-850): drop the flat fallback once no legacy in-flight requests remain.
    const meta = entry.metadata as
      | { schedule?: { scheduleId?: unknown }; scheduleId?: unknown }
      | undefined;
    const coord = meta?.schedule?.scheduleId ?? meta?.scheduleId;
    if (coord === scheduleId) return entry;
  }
  return null;
}
