import { describe, it, expect } from "vitest";
import { defaultMcpFilterTools, mcpRequestStateSchema } from "../../src/mcp/filter";
import { MCP_TOOL_META, type MCPToolMeta } from "../../src/mcp/types";
import type { GeneratorTool } from "@flow-state-dev/core";

function makeTool(namespacedName: string, server?: string, originalName?: string): GeneratorTool {
  const tool: any = { name: namespacedName, kind: "handler", description: "" };
  if (server && originalName) {
    const meta: MCPToolMeta = { mcp: { server, originalName } };
    tool[MCP_TOOL_META] = meta;
  }
  return tool as GeneratorTool;
}

function ctx(state: unknown) {
  return { request: { state }, session: { state: {} } };
}

describe("defaultMcpFilterTools", () => {
  const linearList = makeTool("mcp__linear__list_issues", "linear", "list_issues");
  const linearCreate = makeTool("mcp__linear__create_issue", "linear", "create_issue");
  const notionSearch = makeTool("mcp__notion__search", "notion", "search");
  const nonMcp = makeTool("web_search");

  it("returns tools unchanged when state has no mcp overrides", async () => {
    const tools = [linearList, linearCreate, notionSearch, nonMcp];
    expect(await defaultMcpFilterTools(ctx({}), tools)).toEqual(tools);
    expect(await defaultMcpFilterTools(ctx({ mcp: {} }), tools)).toEqual(tools);
  });

  it("filters out tools listed in disabledTools", async () => {
    const tools = [linearList, linearCreate, notionSearch];
    const result = await defaultMcpFilterTools(
      ctx({ mcp: { disabledTools: ["mcp__linear__list_issues"] } }),
      tools,
    );
    expect(result).toEqual([linearCreate, notionSearch]);
  });

  it("filters all tools from disabledServers", async () => {
    const tools = [linearList, linearCreate, notionSearch];
    const result = await defaultMcpFilterTools(
      ctx({ mcp: { disabledServers: ["linear"] } }),
      tools,
    );
    expect(result).toEqual([notionSearch]);
  });

  it("non-mcp tools pass through unchanged", async () => {
    const tools = [linearList, nonMcp];
    const result = await defaultMcpFilterTools(
      ctx({ mcp: { disabledServers: ["linear"] } }),
      tools,
    );
    expect(result).toEqual([nonMcp]);
  });

  it("applies both disabledTools and disabledServers simultaneously", async () => {
    const result = await defaultMcpFilterTools(
      ctx({
        mcp: {
          disabledTools: ["mcp__linear__list_issues"],
          disabledServers: ["notion"],
        },
      }),
      [linearList, linearCreate, notionSearch, nonMcp],
    );
    expect(result).toEqual([linearCreate, nonMcp]);
  });
});

describe("mcpRequestStateSchema", () => {
  it("parses a valid partial mcp override", () => {
    expect(
      mcpRequestStateSchema.parse({ mcp: { disabledTools: ["x"], disabledServers: ["y"] } }),
    ).toEqual({ mcp: { disabledTools: ["x"], disabledServers: ["y"] } });
  });

  it("accepts an empty object (all fields optional)", () => {
    expect(mcpRequestStateSchema.parse({})).toEqual({});
  });
});
