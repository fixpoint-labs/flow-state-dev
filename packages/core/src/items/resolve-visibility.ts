/**
 * Isomorphic resolution of an item's visibility.
 *
 * Lives in core so both server-side history assembly and client-side UI
 * filtering derive `{ client, history }` from the same truth table. Pure
 * function of `(item.type, item.agentType)`.
 *
 * Rules:
 * - `agentType: "trace"` → neither client nor history, regardless of type.
 * - Conversational types (`message`, `reasoning`, `block_tool_output`)
 *   inherit visibility from `agentType`. Unset `agentType` on a conversational
 *   item falls back to primary-equivalent visibility — this keeps handler
 *   emits like `ctx.emitMessage("hi")` ergonomic when no generator identity
 *   is present.
 * - Structural types have fixed per-type visibility; `agentType` on them is
 *   metadata only.
 */
import type { ItemVisibility, OutputItem } from "./types";

const CONVERSATIONAL_TYPES = new Set<string>([
  "message",
  "reasoning",
  "block_tool_output",
]);

const STRUCTURAL_TYPE_DEFAULTS: Record<string, ItemVisibility> = {
  component:       { client: true,  history: false },
  container:       { client: true,  history: false },
  source:          { client: true,  history: false },
  status:          { client: true,  history: false },
  state_change:    { client: true,  history: false },
  resource_change: { client: true,  history: false },
  error:           { client: true,  history: false },
  block_output:    { client: false, history: false },
  router_decision: { client: false, history: false },
  state_snapshot:  { client: false, history: false },
  block_debug:     { client: false, history: false },
};

export function resolveItemVisibility(item: OutputItem): ItemVisibility {
  if (item.agentType === "trace") return { client: false, history: false };

  if (CONVERSATIONAL_TYPES.has(item.type)) {
    // Sub-agents are visible live but excluded from history.
    // Primary or unset (handler-emit fallback) is both.
    return item.agentType === "sub"
      ? { client: true, history: false }
      : { client: true, history: true };
  }

  return STRUCTURAL_TYPE_DEFAULTS[item.type] ?? { client: true, history: false };
}
