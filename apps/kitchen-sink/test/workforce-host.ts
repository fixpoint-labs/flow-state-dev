/**
 * Kitchen-sink's workforce kit, started on its own over in-memory stores, for
 * a test that reads what it serves: the registered flows, and the
 * installation the kit hired, read through the kit's `flows` slot as any flow
 * built on it would be handed it.
 */
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { KitInstance } from "@flow-state-dev/core";
import type { WorkerInstallation } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";

import { kitchenSinkWorkforce } from "../lib/workforce-kit";

/** What the kit served, once started. */
export interface ServedWorkforce {
  /** The installation the kit hired. */
  installation: WorkerInstallation;
  /** Every flow the app registered, by id. */
  flows: Map<string, FlowInstance>;
  state: FlowState;
}

/** Start `kit` (kitchen-sink's own by default) and read what it serves. Rejects as `ready()` does. */
export async function serveWorkforce(kit: KitInstance = kitchenSinkWorkforce()): Promise<ServedWorkforce> {
  let installation: WorkerInstallation | undefined;
  const state = createFlowState({
    kits: [kit],
    // Builds no flow: the entry only keeps the installation the kit hands it.
    fill: { [workforce.slots.flows]: { read: (hired: WorkerInstallation) => ((installation = hired), []) } },
    stores: { test: { primary: inMemoryStores() } },
  });
  await state.ready();
  const { registry } = await state.getRuntime();
  return { installation: installation!, flows: new Map(registry.list().map((flow) => [flow.id, flow])), state };
}
