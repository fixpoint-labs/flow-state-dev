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
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (meta?.scheduleId === scheduleId) return entry;
  }
  return null;
}
