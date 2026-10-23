/**
 * The one rule for whether a host gets durable execution (FIX-2063 D2).
 *
 * Durable execution is on by default wherever stores persist. `durable: false`
 * turns it off; `durable: true` turns it on even over in-memory stores (how
 * tests opt in). With no answer, the stores decide: a host whose checkpoint or
 * suspension store says it does not persist (the in-memory adapter) gets none,
 * because a stop held there is lost silently when the process ends.
 *
 * `createFlowState`, the no-config `fsdev dev` router and the no-config
 * `fsdev run` all take their provider from here, so the default changes in
 * one place. The low-level `createFlowApiRouter` and `runAction` still take a
 * provider only when given one.
 */
import type { StoreRegistry } from "../stores/types";
import { createCheckpointDurabilityProvider } from "./checkpoint-durability-provider";
import type { DurabilityProvider } from "./types";

/** What the rule reads: the host's stores and its `durable` setting. */
export interface DurabilityDefaultOptions {
  stores: Pick<StoreRegistry, "checkpoints" | "suspensions" | "leases">;
  /** The host's `durable` setting. Absent: on wherever the stores persist. */
  durable?: boolean;
}

/** `true` when both stores a stop is held in keep it past the process. */
export function storesPersist(stores: Pick<StoreRegistry, "checkpoints" | "suspensions">): boolean {
  return stores.checkpoints.persists !== false && stores.suspensions.persists !== false;
}

/**
 * The checkpoint provider over `stores`, or `undefined` when this host runs
 * without durable execution.
 */
export function resolveDurabilityProvider(options: DurabilityDefaultOptions): DurabilityProvider | undefined {
  const on = options.durable ?? storesPersist(options.stores);
  return on ? createCheckpointDurabilityProvider(options.stores) : undefined;
}
