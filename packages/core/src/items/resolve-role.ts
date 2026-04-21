/**
 * Isomorphic resolution of an item's visibility.
 *
 * Lives in core so both server-side history assembly and client-side UI
 * filtering use the same logic. The primary API is `resolveItemVisibility()`,
 * which returns `{ client, history }` booleans. Legacy `resolveItemRole()`
 * is retained as a deprecated shim.
 */
import type { ItemRole, ItemVisibility, OutputItem } from "./types";

/**
 * Per-type default visibility. Items without explicit `client`/`history`
 * fields fall back to these defaults based on their `type`.
 */
export const ITEM_TYPE_DEFAULTS: Record<string, ItemVisibility> = {
  message:                      { client: true,  history: true  },
  reasoning:                    { client: true,  history: true  },
  block_tool_output:            { client: true,  history: true  },
  component:                    { client: true,  history: false },
  container:                    { client: true,  history: false },
  source:                       { client: true,  history: false },
  status:                       { client: true,  history: false },
  state_change:                 { client: true,  history: false },
  resource_change:              { client: true,  history: false },
  error:                        { client: true,  history: false },
  step_error:                   { client: true,  history: false },
  block_output:                 { client: false, history: false },
  router_decision:              { client: false, history: false },
  state_snapshot:               { client: false, history: false },
};

const FALLBACK_DEFAULTS: ItemVisibility = { client: true, history: false };

/**
 * Maps a legacy `ItemRole` to the equivalent `{ client, history }` pair.
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
 * Resolution order:
 *   1. Explicit `client`/`history` on the item (either field set).
 *   2. Legacy `itemRole` mapped to booleans.
 *   3. Legacy `trace: true` → `{ client: false, history: false }`.
 *   4. Per-type defaults from `ITEM_TYPE_DEFAULTS`.
 */
export function resolveItemVisibility(item: OutputItem): ItemVisibility {
  const hasExplicit = item.client !== undefined || item.history !== undefined;
  if (hasExplicit) {
    const typeDefaults = ITEM_TYPE_DEFAULTS[item.type] ?? FALLBACK_DEFAULTS;
    return {
      client: item.client ?? typeDefaults.client,
      history: item.history ?? typeDefaults.history,
    };
  }

  if (item.itemRole !== undefined) {
    return roleToVisibility(item.itemRole);
  }

  if (item.trace === true) {
    return { client: false, history: false };
  }

  return ITEM_TYPE_DEFAULTS[item.type] ?? FALLBACK_DEFAULTS;
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
