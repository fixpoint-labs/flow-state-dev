/**
 * MCP capability — exposes tools from connected MCP servers to generators.
 *
 * Wraps the module-level MCPManager and provides its tools through the
 * capability preset system. When no MCP servers are configured via env vars,
 * the exported capability is null (zero overhead for unconfigured environments).
 *
 * Wired into featuresCapability's dynamic `uses` so generators get MCP tools
 * alongside built-in tools without knowing the difference.
 */
import { defineCapability, type CapabilityRef } from "@flow-state-dev/core";
import { createMcpManager, type MCPManager } from "../../../../lib/mcp";

// Module-level singleton — reads config from env immediately, connects lazily.
export const mcpManager = createMcpManager();

/**
 * Creates a capability that provides tools from connected MCP servers.
 * Returns null if the manager has no configured servers.
 */
function buildMcpCapability(manager: MCPManager): CapabilityRef | null {
  if (manager.getServerConfigs().length === 0) return null;

  return defineCapability({
    name: "mcp",
    presets: {
      tools: {
        tools: async () => manager.getTools(),
        context: [
          () => {
            const servers = manager.getConnectedServerNames();
            if (servers.length === 0) return null;
            return [
              `You have access to tools from the following MCP servers: ${servers.join(", ")}.`,
              `MCP tool names are prefixed with the server name (e.g. mcp__${servers[0]}__tool_name).`,
              "Use these tools when the user's request involves the connected service.",
            ].join("\n");
          },
        ],
      },
      default: ["tools"],
    },
  });
}

/** MCP capability — null when no MCP servers are configured. */
export const mcpCapability = buildMcpCapability(mcpManager);
