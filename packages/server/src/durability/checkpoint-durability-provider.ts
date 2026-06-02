/**
 * Default DurabilityProvider backed by the existing store infrastructure.
 *
 * Deliberately thin — delegates to CheckpointStore, SuspensionStore, and
 * LeaseStore. Business logic (when to checkpoint, when to suspend, when
 * to resume) lives in the sequencer and runAction, not here.
 */

import type { StoreRegistry } from "../stores/types";
import type { DurabilityProvider } from "./types";

export function createCheckpointDurabilityProvider(
  stores: Pick<StoreRegistry, "checkpoints" | "suspensions" | "leases">
): DurabilityProvider {
  return {
    saveCheckpoint: (cp) => stores.checkpoints.write(cp),
    loadCheckpoint: (reqId, biId) => stores.checkpoints.latest(reqId, biId),

    suspend: (record) => stores.suspensions.set(record),
    loadSuspension: (reqId, sid) => stores.suspensions.get(reqId, sid),
    listSuspended: (filter) => stores.suspensions.list(filter),

    acquireLease: (reqId, opts) => stores.leases.acquire(reqId, opts),
    releaseLease: (reqId, lid) => stores.leases.release(reqId, lid),

    cleanup: async (reqId) => {
      await stores.suspensions.deleteForRequest(reqId);
    },
  };
}
