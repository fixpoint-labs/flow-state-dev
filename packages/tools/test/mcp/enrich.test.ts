import { describe, it, expect } from "vitest";
import { enrichDescription, getMcpToolMeta } from "../../src/mcp/enrich";
import { MCP_TOOL_META, type MCPServerConfig } from "../../src/mcp/types";

const linearNoCategory: MCPServerConfig = {
  name: "linear",
  transport: { type: "sse", url: "https://x" },
};

const linearWithCategory: MCPServerConfig = {
  ...linearNoCategory,
  category: "project-management",
};

describe("enrichDescription", () => {
  it("prefixes with server name in 'prefix' mode (default)", () => {
    expect(enrichDescription("List issues", linearNoCategory, "prefix")).toBe(
      "[linear] List issues",
    );
  });

  it("prefixes with server + category in 'category' mode when category is set", () => {
    expect(enrichDescription("List issues", linearWithCategory, "category")).toBe(
      "[linear · project-management] List issues",
    );
  });

  it("falls back to prefix shape in 'category' mode when category is missing", () => {
    expect(enrichDescription("List issues", linearNoCategory, "category")).toBe(
      "[linear] List issues",
    );
  });

  it("leaves description unchanged when mode is false", () => {
    expect(enrichDescription("List issues", linearWithCategory, false)).toBe("List issues");
  });

  it("handles empty original descriptions by preserving just the bracket", () => {
    expect(enrichDescription("", linearNoCategory, "prefix")).toBe("[linear] ");
  });
});

describe("getMcpToolMeta", () => {
  it("returns the attached meta when present", () => {
    const tool: any = {};
    tool[MCP_TOOL_META] = { mcp: { server: "linear", originalName: "list" } };
    expect(getMcpToolMeta(tool)).toEqual({
      mcp: { server: "linear", originalName: "list" },
    });
  });

  it("returns null for tools without meta", () => {
    expect(getMcpToolMeta({})).toBeNull();
    expect(getMcpToolMeta(null)).toBeNull();
    expect(getMcpToolMeta("not an object")).toBeNull();
  });
});
