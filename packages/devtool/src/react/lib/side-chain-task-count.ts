/**
 * Read the pending side-chain count off a status item.
 *
 * The sequencer emits structural `status` items carrying only a count of
 * side-chain tasks still draining, under `sideChainTasks`. A row with neither a
 * message nor a count has nothing to render, so the trace tree drops it.
 */
import type { StatusItem } from "@flow-state-dev/core/items";

/** The pending side-chain count, or `undefined` when the item carries none. */
export function sideChainTaskCount(item: StatusItem): number | undefined {
  return typeof item.sideChainTasks === "number" ? item.sideChainTasks : undefined;
}

/** The synthesized label for a status row that carries only a count. */
export function sideChainTaskLabel(count: number): string {
  return count === 0 ? "side chains complete" : `side chains: ${count} pending`;
}
