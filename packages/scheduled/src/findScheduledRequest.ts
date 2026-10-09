/**
 * Find an in-flight scheduled request matching `(flow instance, scheduleId)`.
 * Used by the dispatch handler to honor `onOverlap: "skip"`. The instance is
 * matched by its id — the entry's stored owner, or for a legacy entry the
 * singleton its kind implies — so two copies of one definition never skip
 * each other's ticks.
 */
import type {
  ActiveRequestEntry,
  ActiveRequestRegistry
} from "@flow-state-dev/engine";
import { SCHEDULED_TRANSPORT_SOURCE } from "./createScheduledTransportAdapter";

export async function findScheduledRequest(
  registry: ActiveRequestRegistry,
  flowId: string,
  scheduleId: string
): Promise<ActiveRequestEntry | null> {
  const entries = await registry.listAll();
  for (const entry of entries) {
    if ((entry.flowId ?? entry.flowKind) !== flowId) continue;
    if (entry.source !== SCHEDULED_TRANSPORT_SOURCE) continue;
    // Coordinate lives under the namespaced `metadata.schedule` slot (FIX-838),
    // matching what the dispatch handler stamps.
    const meta = entry.metadata as
      | { schedule?: { scheduleId?: unknown } }
      | undefined;
    const coord = meta?.schedule?.scheduleId;
    if (coord === scheduleId) return entry;
  }
  return null;
}
