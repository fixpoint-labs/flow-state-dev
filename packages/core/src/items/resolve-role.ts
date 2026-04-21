/**
 * Isomorphic resolution of an item's visibility.
 *
 * Lives in core so both server-side history assembly and client-side UI
 * filtering use the same logic. The primary API is `resolveItemVisibility()`,
 * which returns `{ client, history }` booleans derived from `(item.type,
 * item.agentType)`. Legacy `resolveItemRole()` is retained as a deprecated
 * shim.
 *
 * Visibility model (post-FIX-391):
 *   - Conversational types (`message`, `reasoning`, `block_tool_output`)
 *     derive visibility from `item.agentType`. Items with no `agentType`
 *     fall back to agent-equivalent visibility — this preserves ergonomics
 *     for handler-emitted items such as `ctx.emitMessage("hi")` that have
 *     no surrounding generator identity.
 *   - Structural types (component, status, state_change, block_output,
 *     router_decision, etc.) have fixed visibility per type.
 *   - `agentType: "trace"` always resolves to `{ client: false, history: false }`
 *     regardless of item type — trace is an observability-only channel.
 */
import type {
  AgentType,
  ItemRole,
  ItemVisibility,
  OutputItem,
} from "./types";

/**
 * Conversational item types — visibility is governed by `agentType` identity.
 * Other types are structural and have fixed per-type visibility.
 */
const CONVERSATIONAL_TYPES = new Set<string>([
  "message",
  "reasoning",
  "block_tool_output",
]);

/**
 * Visibility by `agentType` for conversational items.
 *
 * - `agent`: user-facing; in both client stream and conversation history.
 * - `sub-agent`: visible to the client for live observability but excluded
 *   from conversation history (sub-agents are deaf to prior turns by design).
 * - `trace`: observability only — never client, never history.
 */
const AGENT_TYPE_VISIBILITY: Record<AgentType, ItemVisibility> = {
  "agent":     { client: true,  history: true  },
  "sub-agent": { client: true,  history: false },
  "trace":     { client: false, history: false },
};

/**
 * Fixed visibility for structural item types. These are never
 * conversational content; agentType on them (if present) is informational
 * metadata and does not change visibility.
 */
const STRUCTURAL_TYPE_DEFAULTS: Record<string, ItemVisibility> = {
  component:                { client: true,  history: false },
  container:                { client: true,  history: false },
  source:                   { client: true,  history: false },
  status:                   { client: true,  history: false },
  state_change:             { client: true,  history: false },
  resource_change:          { client: true,  history: false },
  error:                    { client: true,  history: false },
  step_error:               { client: true,  history: false },
  block_output:             { client: false, history: false },
  router_decision:          { client: false, history: false },
  state_snapshot:           { client: false, history: false },
  block_debug:              { client: false, history: false },
};

/** Fallback for unrecognized item types — visible to client, not in history. */
const FALLBACK_DEFAULTS: ItemVisibility = { client: true, history: false };

/**
 * Fallback visibility for conversational items with no `agentType`.
 * Preserves backward-compatibility for handler-emitted items such as
 * `ctx.emitMessage("hi")` that are meant to be user-facing without
 * requiring explicit identity.
 */
const CONVERSATIONAL_NO_IDENTITY_FALLBACK: ItemVisibility = {
  client: true,
  history: true,
};

/**
 * Per-type default visibility. Kept as a public read-only view for external
 * callers (debugging, docs generation). Visibility resolution does not read
 * this map directly — see `resolveItemVisibility` for the source of truth.
 */
export const ITEM_TYPE_DEFAULTS: Readonly<Record<string, ItemVisibility>> = {
  message:                      { client: true,  history: true  },
  reasoning:                    { client: true,  history: true  },
  block_tool_output:            { client: true,  history: true  },
  ...STRUCTURAL_TYPE_DEFAULTS,
};

/**
 * Legacy `ItemRole` → `ItemVisibility`. Used only by the deprecated
 * `resolveItemRole()` shim below.
 */
function roleToVisibility(role: ItemRole): ItemVisibility {
  switch (role) {
    case "external": return { client: true,  history: true  };
    case "internal": return { client: false, history: true  };
    case "trace":    return { client: false, history: false };
  }
}

/**
 * Returns the resolved visibility of an item as two independent booleans.
 *
 * Resolution model (pure `f(type, agentType)`):
 *   1. Conversational type + explicit `agentType` → `AGENT_TYPE_VISIBILITY`.
 *   2. Conversational type + no `agentType` → agent-equivalent fallback.
 *   3. Structural type → fixed per-type visibility.
 *   4. Unknown type → fallback (client, not history).
 *
 * A trace `agentType` overrides everything to `{ client: false, history: false }`
 * regardless of type.
 */
export function resolveItemVisibility(item: OutputItem): ItemVisibility {
  if (item.agentType === "trace") {
    return AGENT_TYPE_VISIBILITY["trace"];
  }

  if (CONVERSATIONAL_TYPES.has(item.type)) {
    if (item.agentType !== undefined) {
      return AGENT_TYPE_VISIBILITY[item.agentType];
    }
    return CONVERSATIONAL_NO_IDENTITY_FALLBACK;
  }

  return STRUCTURAL_TYPE_DEFAULTS[item.type] ?? FALLBACK_DEFAULTS;
}

/**
 * @deprecated Use `resolveItemVisibility()` instead. This shim maps the new
 * boolean flags back to a legacy `ItemRole` for call sites that haven't
 * migrated yet.
 */
export function resolveItemRole(item: OutputItem): ItemRole {
  const vis = resolveItemVisibility(item);
  if (!vis.client && !vis.history) return "trace";
  if (!vis.client && vis.history) return "internal";
  return "external";
}

// Export so tests can verify role→visibility mapping.
export { roleToVisibility };
