import { describe, it, expect } from "vitest";
import { defaultMcpGuidanceFormatter } from "../../src/mcp/context";
import type { MCPCatalog } from "../../src/mcp/types";

describe("defaultMcpGuidanceFormatter", () => {
  it("returns empty string when no connected servers", () => {
    const catalog: MCPCatalog = { servers: [] };
    expect(defaultMcpGuidanceFormatter(catalog)).toBe("");
  });

  it("renders degraded output when servers lack metadata", () => {
    const catalog: MCPCatalog = {
      servers: [
        { name: "alpha", metadata: {}, status: "connected", tools: [] },
        { name: "beta", metadata: {}, status: "connected", tools: [] },
      ],
    };
    const out = defaultMcpGuidanceFormatter(catalog);
    expect(out).toContain("## MCP Tools");
    expect(out).toContain("alpha, beta");
    expect(out).toContain("mcp__alpha__tool_name");
  });

  it("omits errored servers from the guidance output", () => {
    const catalog: MCPCatalog = {
      servers: [
        { name: "alpha", metadata: {}, status: "connected", tools: [] },
        { name: "bad", metadata: {}, status: "errored", error: "x", tools: [] },
      ],
    };
    const out = defaultMcpGuidanceFormatter(catalog);
    expect(out).not.toContain("bad");
    expect(out).toContain("alpha");
  });

  it("groups servers by category with rich metadata", () => {
    const catalog: MCPCatalog = {
      servers: [
        {
          name: "linear",
          metadata: {
            description: "Issues, projects.",
            whenToUse: "User asks about tickets.",
            examples: ["mcp__linear__list_issues({})"],
            category: "project-management",
          },
          status: "connected",
          tools: [],
        },
        {
          name: "jira",
          metadata: { description: "Tickets.", category: "project-management" },
          status: "connected",
          tools: [],
        },
        {
          name: "notion",
          metadata: { description: "Pages.", category: "docs" },
          status: "connected",
          tools: [],
        },
      ],
    };

    const out = defaultMcpGuidanceFormatter(catalog);
    expect(out).toContain("### Project management");
    expect(out).toContain("#### linear");
    expect(out).toContain("#### jira");
    expect(out).toContain("### Docs");
    expect(out).toContain("#### notion");
    expect(out).toContain("Use when: User asks about tickets.");
    expect(out).toContain("mcp__linear__list_issues({})");
  });

  it("puts servers without category under 'Other'", () => {
    const catalog: MCPCatalog = {
      servers: [
        { name: "alpha", metadata: { description: "Alpha service." }, status: "connected", tools: [] },
      ],
    };
    const out = defaultMcpGuidanceFormatter(catalog);
    expect(out).toContain("### Other");
    expect(out).toContain("#### alpha");
  });

  it("emits a fallback line for bare servers in a mixed catalog (no headless heading)", () => {
    const catalog: MCPCatalog = {
      servers: [
        {
          name: "linear",
          metadata: { description: "Issues.", category: "project-management" },
          status: "connected",
          tools: [],
        },
        {
          name: "bare",
          metadata: {},
          status: "connected",
          tools: [],
        },
      ],
    };

    const out = defaultMcpGuidanceFormatter(catalog);
    expect(out).toContain("#### bare");
    expect(out).toContain("Tools are prefixed with `mcp__bare__`");
    // Sanity: there should be no `#### bare` line immediately followed by a blank or another heading.
    expect(out).not.toMatch(/#### bare\s*\n\s*(?:###|$)/);
  });
});
