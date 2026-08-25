/**
 * Read the pending side-chain count off a status item, in either spelling.
 *
 * The sequencer emits structural `status` items carrying only a count of
 * side-chain tasks still draining. FIX-766 renamed that field
 * `backgroundTasks` → `sideChainTasks`, and the field is **persisted**: it
 * rides on a `StatusItem`, which is stored in the request's durable item log
 * whenever the emit is not transient. So a reader that knows only the new name
 * sees `undefined` for
 *
 *   - any status row written by a pre-upgrade engine, and
 *   - any persisted row from before the deploy, replayed into the DevTool.
 *
 * The consequence is not a wrong number, it is a **missing row**: the trace
 * tree drops status items that have neither a message nor a count, so a
 * mixed-version or replayed trace loses the only indication that side-chain
 * draining is happening at all.
 *
 * Dual-reading here costs nothing at runtime and touches no write path — new
 * items are written under the new name only. This is BP-030 applied where it
 * actually applies: tolerate the old shape on read.
 */
import type { StatusItem } from "@flow-state-dev/core/items";

/** A status item as it may arrive: either spelling of the count, or neither. */
type StatusItemWithCount = StatusItem & {
  sideChainTasks?: number;
  /** Pre-FIX-766 spelling. Read-only — never written by current code. */
  backgroundTasks?: number;
};

/**
 * The pending side-chain count, or `undefined` when the item carries none.
 *
 * Prefers the current spelling so a row carrying both (which nothing writes,
 * but which a hand-edited fixture could) resolves to the current one.
 */
export function sideChainTaskCount(item: StatusItem): number | undefined {
  const withCount = item as StatusItemWithCount;
  const current = withCount.sideChainTasks;
  if (typeof current === "number") return current;
  const legacy = withCount.backgroundTasks;
  return typeof legacy === "number" ? legacy : undefined;
}

/** The synthesized label for a status row that carries only a count. */
export function sideChainTaskLabel(count: number): string {
  return count === 0 ? "side chains complete" : `side chains: ${count} pending`;
}
