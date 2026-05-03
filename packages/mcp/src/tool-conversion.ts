/**
 * Action → MCP tool conversion.
 *
 * Per FIX-22 § 3.3: tool names are derived deterministically from the
 * action key via `decamelize`. The flow IS the MCP server (one server
 * per flow at `POST /api/flows/:kind/mcp`), so the tool name is bare —
 * no flow-kind prefix.
 *
 * Per FIX-22 § 3.4: `description` is required at flow registration and
 * becomes the LLM-facing tool description.
 *
 * Per FIX-22 § 3.8: tool results are text-only in v1 — `outputSchema`,
 * `structuredContent`, and progress notifications are deferred.
 */
import type { ActionConfig } from "@flow-state-dev/core/types";
import decamelize from "decamelize";
import { toolInputJsonSchema, type JsonSchemaObject } from "./schema";

/**
 * MCP `Tool` shape returned by `tools/list`. We hand-build this rather
 * than depending on the SDK type to keep the v1 surface tight; the
 * fields covered here are the entire v1 contract.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

/**
 * Derive the MCP tool name from an action key. Uses `decamelize` with
 * underscore separators and consecutive-uppercase normalization so
 * `URLParser` → `url_parser` and `getHTTPSProxy` → `get_https_proxy`.
 * Hyphens in the source key are preserved as-is (legal per MCP's
 * `[A-Za-z0-9_.-]{1,128}` charset).
 */
export function toolNameFromActionKey(actionKey: string): string {
  return decamelize(actionKey, { separator: "_", preserveConsecutiveUppercase: false });
}

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Validate a derived tool name against the MCP charset rules. Throws
 * with a descriptive error pointing back to the source action key.
 */
export function validateToolName(toolName: string, sourceKey: string): void {
  if (!TOOL_NAME_PATTERN.test(toolName)) {
    throw new Error(
      `MCP tool name "${toolName}" derived from action "${sourceKey}" violates the ` +
      `MCP tool name charset (must match [A-Za-z0-9_.-]{1,128}). Rename the action.`
    );
  }
}

/**
 * Resolve the set of actions exposed via MCP for a given flow.
 *
 * Excludes actions that opt out via `action.mcp.enabled === false`.
 * Tool names come from `action.mcp.name` when set, otherwise are derived
 * deterministically from the action key. Throws if two exposed actions
 * resolve to the same tool name — the MCP client cache keys on tool
 * name, so collisions are catastrophic and must surface at startup.
 *
 * Returns `Map<toolName, { actionKey, action }>` so the dispatcher can
 * look up the underlying action by tool name in O(1).
 */
export function resolveExposedActions(
  flowKind: string,
  actions: Record<string, ActionConfig>
): Map<string, { actionKey: string; action: ActionConfig }> {
  const result = new Map<string, { actionKey: string; action: ActionConfig }>();

  for (const [actionKey, action] of Object.entries(actions)) {
    if (action.mcp?.enabled === false) continue;

    const overrideName = action.mcp?.name;
    const toolName =
      typeof overrideName === "string" && overrideName.length > 0
        ? overrideName
        : toolNameFromActionKey(actionKey);
    validateToolName(toolName, actionKey);

    const existing = result.get(toolName);
    if (existing !== undefined) {
      throw new Error(
        `Flow "${flowKind}" exposes actions "${existing.actionKey}" and "${actionKey}" ` +
        `which both resolve to the MCP tool name "${toolName}". Rename one of them ` +
        `or set a distinct \`mcp.name\` override.`
      );
    }
    result.set(toolName, { actionKey, action });
  }

  return result;
}

/**
 * Build an MCP `Tool` from an `ActionConfig`. Caller is responsible for
 * ensuring `action.description` is non-empty (validated in `defineFlow`).
 */
export function actionToMcpTool(toolName: string, action: ActionConfig): McpTool {
  return {
    name: toolName,
    description: action.description ?? "",
    inputSchema: toolInputJsonSchema(action.inputSchema)
  };
}
