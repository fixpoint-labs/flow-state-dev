/**
 * Isomorphic resolution of an item's visibility.
 *
 * Lives in core so both server-side history assembly and client-side UI
 * filtering derive `{ client, history }` from the same truth table. Pure
 * function of `(item.type, item.agentType)`.
 *
 * Rules:
 * - `agentType: "trace"` → neither client nor history, regardless of type.
 *   The four trace item types (`block_output`, `router_decision`,
 *   `state_snapshot`, `block_debug`) are always emitted with this stamp.
 * - Conversational types (`message`, `reasoning`, `block_tool_output`)
 *   inherit visibility from `agentType`. Unset `agentType` on a conversational
 *   item falls back to primary-equivalent visibility — this keeps handler
 *   emits like `ctx.emitMessage("hi")` ergonomic when no generator identity
 *   is present.
 * - All other (structural) types resolve to `{ client: true, history: false }`.
 */
import type { ItemVisibility, OutputItem } from "./types";

const CONVERSATIONAL_TYPES = new Set<string>([
  "message",
  "reasoning",
  "block_tool_output",
]);

const STRUCTURAL_DEFAULT: ItemVisibility = { client: true, history: false };
const TRACE_DEFAULT: ItemVisibility = { client: false, history: false };

export function resolveItemVisibility(item: OutputItem): ItemVisibility {
  if (item.agentType === "trace") return TRACE_DEFAULT;

  if (CONVERSATIONAL_TYPES.has(item.type)) {
    return item.agentType === "sub"
      ? { client: true, history: false }
      : { client: true, history: true };
  }

  return STRUCTURAL_DEFAULT;
}
