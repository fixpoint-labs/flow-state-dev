import { describe, it, expect, vi } from "vitest";
import { createMcpManager } from "../../src/mcp/manager";
import { createMockClientFactory, fakeMcpTool, linearConfig } from "./fixtures";

describe("createMcpManager", () => {
  describe("config + connection baseline", () => {
    it("returns empty tools when no servers configured", async () => {
      const manager = createMcpManager({ servers: [] });
      expect(manager.getServerConfigs()).toEqual([]);
      expect(await manager.getTools()).toEqual([]);
    });

    it("exposes the configured servers via getServerConfigs", () => {
      const manager = createMcpManager({ servers: [linearConfig] });
      expect(manager.getServerConfigs()).toEqual([linearConfig]);
    });

    it("does not connect until getTools is called (lazy)", async () => {
      const { factory } = createMockClientFactory({
        linear: { t: fakeMcpTool("t", "Test") },
      });
      const factorySpy = vi.fn(factory);

      const manager = createMcpManager({
        servers: [linearConfig],
        _createClient: factorySpy,
      });
      expect(factorySpy).toHaveBeenCalledTimes(0);

      await manager.getTools();
      expect(factorySpy).toHaveBeenCalledTimes(1);
    });

    it("tracks connected server names after first getTools", async () => {
      const { factory } = createMockClientFactory({
        linear: { t: fakeMcpTool("t", "Test") },
      });
      const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });

      expect(manager.getConnectedServerNames()).toEqual([]);
      await manager.getTools();
      expect(manager.getConnectedServerNames()).toEqual(["linear"]);
    });
  });

  describe("tool loading + namespacing", () => {
    it("converts MCP tools to handler blocks with namespaced names", async () => {
      const { factory } = createMockClientFactory({
        linear: {
          create_issue: fakeMcpTool("create_issue", "Create an issue"),
          get_issue: fakeMcpTool("get_issue", "Get an issue"),
        },
      });

      const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });
      const tools = await manager.getTools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual([
        "mcp__linear__create_issue",
        "mcp__linear__get_issue",
      ]);
      expect(tools[0].kind).toBe("handler");
    });

    it("keeps the AI-SDK jsonSchema wrapper intact on the block", async () => {
      const wrappedSchema = { jsonSchema: { type: "object", properties: {} } };
      const { factory } = createMockClientFactory({
        linear: {
          get_attachment: {
            description: "no-arg tool",
            inputSchema: wrappedSchema,
            execute: vi.fn(),
          },
        },
      });

      const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });
      const tools = await manager.getTools();

      expect((tools[0] as any).inputSchema).toBe(wrappedSchema);
    });

    it("attaches MCPToolMeta marker so filters can identify origin", async () => {
      const { MCP_TOOL_META } = await import("../../src/mcp/types");
      const { factory } = createMockClientFactory({
        linear: { list_issues: fakeMcpTool("list_issues", "List issues") },
      });

      const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });
      const [tool] = await manager.getTools();

      expect((tool as any)[MCP_TOOL_META]).toEqual({
        mcp: { server: "linear", originalName: "list_issues" },
      });
    });

    it("caches tools on subsequent calls (lazy init only fires once)", async () => {
      const { factory } = createMockClientFactory({
        linear: { t: fakeMcpTool("t", "Test") },
      });
      const factorySpy = vi.fn(factory);

      const manager = createMcpManager({ servers: [linearConfig], _createClient: factorySpy });
      const first = await manager.getTools();
      const second = await manager.getTools();

      expect(first).toBe(second);
      expect(factorySpy).toHaveBeenCalledTimes(1);
    });

    it("proxies tool execution to the MCP client", async () => {
      const executeFn = vi.fn().mockResolvedValue({ id: "ISS-1" });
      const { factory } = createMockClientFactory({
        linear: {
          create_issue: {
            description: "Create an issue",
            inputSchema: { jsonSchema: { type: "object", properties: {} } },
            execute: executeFn,
          },
        },
      });

      const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });
      const [tool] = await manager.getTools();
      const result = await tool.run({ title: "Test" }, {} as any);

      expect(executeFn).toHaveBeenCalledWith({ title: "Test" });
      expect(result).toEqual({ id: "ISS-1" });
    });

    it("reports a helpful error when MCP tool has no execute", async () => {
      const { factory } = createMockClientFactory({
        linear: {
          no_exec: {
            description: "No execute",
            inputSchema: { jsonSchema: { type: "object", properties: {} } },
          } as any,
        },
      });

      const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });
      const [tool] = await manager.getTools();
      const result = await tool.run({}, {} as any);

      expect(result).toEqual({ error: expect.stringContaining("does not support execution") });
    });
  });

  describe("error resilience", () => {
    it("skips servers that fail to connect and returns tools from healthy ones", async () => {
      const { factory } = createMockClientFactory(
        { good: { ok: fakeMcpTool("ok", "Ok") } },
        { failServers: ["bad"] },
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const manager = createMcpManager({
        servers: [
          { name: "good", transport: { type: "sse", url: "https://good.com" } },
          { name: "bad", transport: { type: "sse", url: "https://bad.com" } },
        ],
        _createClient: factory,
      });

      const tools = await manager.getTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("mcp__good__ok");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to connect to "bad"'));
      warnSpy.mockRestore();
    });

    it("marks failed servers as errored in the catalog", async () => {
      const { factory } = createMockClientFactory({}, { failServers: ["bad"] });
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const manager = createMcpManager({
        servers: [{ name: "bad", transport: { type: "sse", url: "https://bad.com" } }],
        _createClient: factory,
      });
      await manager.getTools();

      const catalog = manager.getCatalog();
      expect(catalog.servers[0].status).toBe("errored");
      expect(catalog.servers[0].error).toBe("Connection refused");
    });
  });
});
