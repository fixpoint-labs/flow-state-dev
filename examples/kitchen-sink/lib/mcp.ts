/**
 * MCP (Model Context Protocol) shorthand for kitchen-sink.
 *
 * Reads `LINEAR_MCP_API_KEY` from the environment and builds an MCP capability
 * with curated metadata. Apps needing additional servers import them inline.
 * Heavy lifting (client management, tool namespacing, filtering, guidance)
 * lives in `@flow-state-dev/tools/mcp`.
 */
import { createMcpCapability, type MCPServerConfig } from "@flow-state-dev/tools/mcp";

function resolveServers(): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];

  const linearKey = process.env.LINEAR_MCP_API_KEY;
  if (linearKey) {
    servers.push({
      name: "linear",
      description: "Project management: issues, projects, cycles, teams.",
      whenToUse: "User asks about tasks, tickets, sprint status, or project work.",
      examples: [
        "To find open bugs: mcp__linear__list_issues({ filter: { state: 'open', labels: ['bug'] } })",
        "To create a task: mcp__linear__create_issue({ title, teamId })",
      ],
      category: "project-management",
      transport: {
        type: "sse",
        url: "https://mcp.linear.app/sse",
        headers: { Authorization: `Bearer ${linearKey}` },
      },
    });
  }

  return servers;
}

const servers = resolveServers();

export const mcpCapability = servers.length > 0
  ? createMcpCapability({ servers })
  : null;
