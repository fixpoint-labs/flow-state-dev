/**
 * Test helpers for MCP capability tests.
 *
 * Separated from mcp.test.ts to allow the capability builder to be imported
 * without triggering the module-level singleton in mcp-capability.ts.
 */
import { defineCapability, type CapabilityRef } from "@flow-state-dev/core";
import type { MCPManager } from "../lib/mcp";

/**
 * Builds an MCP capability from a manager instance (same logic as
 * mcp-capability.ts but without the module-level singleton).
 */
export function buildMcpCapabilityForTest(manager: MCPManager): CapabilityRef | null {
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
