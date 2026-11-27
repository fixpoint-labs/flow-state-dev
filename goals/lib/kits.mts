/**
 * The flows kits install, for a goal check that serves them on a router of
 * its own: the kits are installed through `createFlowState({ kits })`, the
 * install every app runs (the claim pass, the slot merge, each kit's
 * install), and the flows it registered are handed back.
 */
import type { KitInstance } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";

/**
 * Install `kits` (with the app's `fill`) and return every flow they serve.
 *
 * @throws As `ready()` does, when a kit's folder or its slots are refused.
 */
export async function kitFlows(kits: readonly KitInstance[], fill?: Readonly<Record<string, unknown>>): Promise<FlowInstance[]> {
  const state = createFlowState({ kits, ...(fill === undefined ? {} : { fill }), stores: { goal: { primary: inMemoryStores() } } });
  await state.ready();
  const flows = (await state.getRuntime()).registry.list();
  await state.dispose();
  return flows;
}
