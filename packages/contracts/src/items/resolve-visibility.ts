/**
 * Isomorphic resolution of an item's visibility.
 *
 * Lives in `@flow-state-dev/contracts` (re-exported from `@flow-state-dev/core/items`)
 * so both server-side history assembly and client-side UI filtering derive
 * `{ client, history }` from the same truth table. Pure function of
 * `(item.type, item.itemVisibility)`.
 *
 * Rules:
 * - Structural trace types (`block_trace`, `router_decision`,
 *   `state_snapshot`, `generator_step`) → `{ client: false, history: false }`,
 *   always — keyed by `item.type`, no stamp needed. `generator_step` is a
 *   replay-only resume substrate (FIX-814): client-invisible and never in LLM
 *   history.
 * - Conversational types (`message`, `reasoning`, `tool_output`)
 *   inherit visibility from `item.itemVisibility`. Absent
 *   `itemVisibility` falls back to `{ client: true, history: true }` —
 *   keeps handler emits like `ctx.emit.message("hi")` ergonomic.
 * - All other (structural) types resolve to `{ client: true, history: false }`.
 */
import type { ItemVisibility, OutputItem } from "./types";

const CONVERSATIONAL_TYPES = new Set<string>([
  "message",
  "reasoning",
  "tool_output",
]);

const TRACE_TYPES = new Set<string>([
  "block_trace",
  "router_decision",
  "state_snapshot",
  "generator_step",
]);

const CONVERSATIONAL_DEFAULT: ItemVisibility = { client: true, history: true };
const STRUCTURAL_DEFAULT: ItemVisibility = { client: true, history: false };
const TRACE_DEFAULT: ItemVisibility = { client: false, history: false };

export function resolveItemVisibility(item: OutputItem): ItemVisibility {
  if (TRACE_TYPES.has(item.type)) return TRACE_DEFAULT;

  if (CONVERSATIONAL_TYPES.has(item.type)) {
    return item.itemVisibility ?? CONVERSATIONAL_DEFAULT;
  }

  return STRUCTURAL_DEFAULT;
}
