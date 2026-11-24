// FIX-2063 D2.
/**
 * Whether a host gets durable execution.
 *
 * On by default wherever the checkpoint and suspension stores persist.
 * `durable: false` turns it off; `durable: true` turns it on even over
 * in-memory stores (how tests opt in). With no answer, a store that says
 * `persists: false` gets none, because a stop held there is lost when the
 * process ends.
 *
 * `createFlowState`, the no-config `fsdev dev` router and the no-config
 * `fsdev run` all call this. `createFlowApiRouter` and `runAction` take a
 * provider only when given one.
 */
import type { StoreRegistry } from "../stores/types";
import { createCheckpointDurabilityProvider } from "./checkpoint-durability-provider";
import type { DurabilityProvider } from "./types";

/** The checkpoint provider over these stores, or none when this host is not durable. */
export function resolveDurabilityProvider(options: {
  stores: Pick<StoreRegistry, "checkpoints" | "suspensions" | "leases">;
  /** The host's `durable` setting. Absent: on wherever the stores persist. */
  durable?: boolean;
}): DurabilityProvider | undefined {
  return (options.durable ?? storesPersist(options.stores)) ? createCheckpointDurabilityProvider(options.stores) : undefined;
}

/** Whether a registry keeps its data past the process: `false` for the in-memory stores. */
export function storesPersist(stores: Pick<StoreRegistry, "checkpoints" | "suspensions">): boolean {
  return stores.checkpoints.persists !== false && stores.suspensions.persists !== false;
}
