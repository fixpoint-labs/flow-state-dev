/**
 * Shared test fixtures for MCP module tests. All tests use these fakes —
 * no test hits a real MCP server.
 */
import { vi } from "vitest";
import type { MCPServerConfig, AiSdkMcpTool, MCPClient } from "../../src/mcp/types";

export type MockTool = {
  description: string;
  inputSchema: { jsonSchema: Record<string, unknown> };
  execute?: (args: unknown) => Promise<unknown>;
};

export function fakeMcpTool(name: string, description: string): MockTool {
  return {
    description,
    inputSchema: {
      jsonSchema: { type: "object", properties: { query: { type: "string" } } },
    },
    execute: vi.fn().mockResolvedValue({ result: `${name}-output` }),
  };
}

export function createMockClientFactory(
  toolsByServer: Record<string, Record<string, MockTool>>,
  opts?: { failServers?: string[] },
) {
  const closeFns: Array<ReturnType<typeof vi.fn>> = [];

  const factory = async (config: MCPServerConfig): Promise<MCPClient> => {
    if (opts?.failServers?.includes(config.name)) {
      throw new Error("Connection refused");
    }
    const closeFn = vi.fn().mockResolvedValue(undefined);
    closeFns.push(closeFn);
    return {
      tools: async () =>
        toolsByServer[config.name] as unknown as Record<string, AiSdkMcpTool> ?? {},
      close: closeFn,
    };
  };

  return { factory, closeFns };
}

export const linearConfig: MCPServerConfig = {
  name: "linear",
  description: "Project management: issues, projects, cycles, teams.",
  whenToUse: "User asks about tasks, tickets, or project work.",
  examples: ["To list bugs: mcp__linear__list_issues({ filter: { labels: ['bug'] } })"],
  category: "project-management",
  transport: {
    type: "http",
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: "Bearer test-key" },
  },
};

export const notionConfig: MCPServerConfig = {
  name: "notion",
  description: "Pages, databases, comments, search.",
  category: "docs",
  transport: { type: "sse", url: "https://notion.example.com/sse" },
};
