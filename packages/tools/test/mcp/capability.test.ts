import { describe, it, expect, vi } from "vitest";
import { createMcpCapability } from "../../src/mcp/capability";
import { createMcpManager } from "../../src/mcp/manager";
import { MCP_TOOL_META } from "../../src/mcp/types";
import { createMockClientFactory, fakeMcpTool, linearConfig } from "./fixtures";

describe("createMcpCapability", () => {
  it("returns a defineCapability-branded object named 'mcp'", () => {
    const cap = createMcpCapability({ servers: [linearConfig] });
    expect((cap as any).__brand).toBe("Capability");
    expect(cap.name).toBe("mcp");
  });

  it("exposes tools and guidance presets with tools+guidance default", () => {
    const cap = createMcpCapability({ servers: [linearConfig] });
    const presets = (cap as any).__presetDefs;
    expect(Object.keys(presets).sort()).toEqual(["default", "guidance", "tools"]);
    expect(presets.default).toEqual(["tools", "guidance"]);
  });

  it("contributes requestStateSchema with disabledTools + disabledServers", () => {
    const cap = createMcpCapability({ servers: [linearConfig] });
    const schema = (cap as any).requestStateSchema;
    expect(schema).toBeDefined();
    const parsed = schema.parse({ mcp: { disabledTools: ["x"] } });
    expect(parsed.mcp.disabledTools).toEqual(["x"]);
  });

  it("enriches tool descriptions with prefix by default", async () => {
    const { factory } = createMockClientFactory({
      linear: { list_issues: fakeMcpTool("list_issues", "List issues") },
    });
    const cap = createMcpCapability({
      manager: createMcpManager({ servers: [linearConfig], _createClient: factory }),
    });
    const toolsFn = (cap as any).__presetDefs.tools.tools;
    const tools = await toolsFn({ request: { state: {} }, session: { state: {} } });
    expect(tools[0].description).toBe("[linear] List issues");
    expect((tools[0] as any)[MCP_TOOL_META].mcp.server).toBe("linear");
  });

  it("applies filterTools to narrow tools based on request state", async () => {
    const { factory } = createMockClientFactory({
      linear: {
        list_issues: fakeMcpTool("list_issues", "List"),
        create_issue: fakeMcpTool("create_issue", "Create"),
      },
    });
    const cap = createMcpCapability({
      manager: createMcpManager({ servers: [linearConfig], _createClient: factory }),
    });
    const toolsFn = (cap as any).__presetDefs.tools.tools;
    const tools = await toolsFn({
      request: { state: { mcp: { disabledTools: ["mcp__linear__list_issues"] } } },
      session: { state: {} },
    });
    expect(tools.map((t: any) => t.name)).toEqual(["mcp__linear__create_issue"]);
  });

  it("renders the guidance context block from the live catalog", async () => {
    const { factory } = createMockClientFactory({
      linear: { list_issues: fakeMcpTool("list_issues", "List") },
    });
    const cap = createMcpCapability({
      manager: createMcpManager({ servers: [linearConfig], _createClient: factory }),
    });
    // Connect first so catalog is populated
    await (cap as any).__presetDefs.tools.tools({
      request: { state: {} },
      session: { state: {} },
    });
    const contextEntries = (cap as any).__presetDefs.guidance.context;
    const ctx = { request: { state: {} }, session: { state: {} } };
    const first = contextEntries[0](null, ctx);
    expect(first).toContain("## MCP Tools");
    expect(first).toContain("linear");
    // The formatter applies titleCase to categories, so "project-management" → "Project-management".
    // We check for the partial slug that is case-invariant to the titleCase transform.
    expect(first.toLowerCase()).toContain("project-management");
  });

  it("honors a custom formatGuidance", async () => {
    const cap = createMcpCapability({
      servers: [linearConfig],
      formatGuidance: () => "custom guidance",
    });
    const ctx = { request: { state: {} }, session: { state: {} } };
    const out = (cap as any).__presetDefs.guidance.context[0](null, ctx);
    expect(out).toBe("custom guidance");
  });

  it("honors enrichDescriptions: false by passing the original description through", async () => {
    const { factory } = createMockClientFactory({
      linear: { list_issues: fakeMcpTool("list_issues", "List issues") },
    });
    const cap = createMcpCapability({
      manager: createMcpManager({ servers: [linearConfig], _createClient: factory }),
      enrichDescriptions: false,
    });
    const tools = await (cap as any).__presetDefs.tools.tools({
      request: { state: {} },
      session: { state: {} },
    });
    expect(tools[0].description).toBe("List issues");
  });
});
