/**
 * Isomorphic resolution of an item's visibility role.
 *
 * Lives in core so both server-side history assembly and client-side UI
 * filtering use the same logic. Handles backward compatibility with
 * pre-role items by falling back to the legacy `trace` boolean, the
 * structural item type list, and the execution phase.
 */
import type { ItemRole, OutputItem } from "./types";

/**
 * Structural item types that default to `"trace"` when the item has no
 * explicit `itemRole`. These carry lifecycle/diagnostic metadata rather
 * than conversational content.
 */
const STRUCTURAL_TRACE_TYPES = new Set<string>([
  "block_output",
  "router_decision",
  "sequencer_state_snapshot",
  "container",
  "state_change",
  "resource_change"
]);

/**
 * Returns the resolved visibility role of an item.
 *
 * Resolution order:
 *   1. Explicit `itemRole` on the item.
 *   2. Legacy `trace: true` → `"trace"`.
 *   3. Structural item type (block_output, router_decision, etc.) → `"trace"`.
 *   4. `provenance.phase === "work"` → `"trace"` (conservative fallback: less
 *      context is safer than too much for pre-role work items).
 *   5. Default → `"external"`.
 */
export function resolveItemRole(item: OutputItem): ItemRole {
  if (item.itemRole !== undefined) {
    return item.itemRole;
  }

  if (item.trace === true) {
    return "trace";
  }

  if (STRUCTURAL_TRACE_TYPES.has(item.type)) {
    return "trace";
  }

  if (item.provenance?.phase === "work") {
    return "trace";
  }

  return "external";
}
