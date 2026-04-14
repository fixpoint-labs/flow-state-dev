import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMcpManager, type MCPServerConfig } from "../lib/mcp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/** Fake MCP tool matching the AI SDK's tool shape. */
function fakeMcpTool(name: string, description: string) {
  return {
    description,
    parameters: { type: "object", properties: { query: { type: "string" } } },
    execute: vi.fn().mockResolvedValue({ result: `${name}-output` }),
  };
}

/** Creates a mock MCP client factory that returns tools based on server name. */
function createMockClientFactory(
  toolsByServer: Record<string, Record<string, ReturnType<typeof fakeMcpTool>>>,
  opts?: { failServers?: string[] },
) {
  const closeFns: Array<ReturnType<typeof vi.fn>> = [];

  const factory = async (config: MCPServerConfig) => {
    if (opts?.failServers?.includes(config.name)) {
      throw new Error("Connection refused");
    }
    const closeFn = vi.fn().mockResolvedValue(undefined);
    closeFns.push(closeFn);
    return {
      tools: async () => toolsByServer[config.name] ?? {},
      close: closeFn,
    };
  };

  return { factory, closeFns };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP Manager", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      MCP_SERVERS: process.env.MCP_SERVERS,
      LINEAR_MCP_API_KEY: process.env.LINEAR_MCP_API_KEY,
    };
    delete process.env.MCP_SERVERS;
    delete process.env.LINEAR_MCP_API_KEY;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      setEnv(key, value);
    }
  });

  describe("config resolution", () => {
    it("returns empty tools when no servers configured", async () => {
      const manager = createMcpManager();
      const tools = await manager.getTools();
      expect(tools).toEqual([]);
      expect(manager.getServerConfigs()).toEqual([]);
    });

    it("reads config from LINEAR_MCP_API_KEY env var", () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const manager = createMcpManager();
      const configs = manager.getServerConfigs();
      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe("linear");
      expect(configs[0].transport.url).toBe("https://mcp.linear.app/sse");
      expect(configs[0].transport.headers).toEqual({
        Authorization: "Bearer test-key",
      });
    });

    it("reads config from MCP_SERVERS env var", () => {
      const config = [
        {
          name: "test-server",
          transport: {
            type: "sse",
            url: "https://example.com/mcp/sse",
            headers: { "X-Key": "abc" },
          },
        },
      ];
      setEnv("MCP_SERVERS", JSON.stringify(config));
      const manager = createMcpManager();
      const configs = manager.getServerConfigs();
      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe("test-server");
      expect(configs[0].transport.url).toBe("https://example.com/mcp/sse");
    });

    it("ignores malformed MCP_SERVERS JSON", () => {
      setEnv("MCP_SERVERS", "not-json");
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const manager = createMcpManager();
      expect(manager.getServerConfigs()).toEqual([]);
      spy.mockRestore();
    });

    it("deduplicates Linear when both MCP_SERVERS and LINEAR_MCP_API_KEY set", () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const config = [
        {
          name: "linear",
          transport: { type: "sse", url: "https://custom-linear.example.com/sse" },
        },
      ];
      setEnv("MCP_SERVERS", JSON.stringify(config));
      const manager = createMcpManager();
      const configs = manager.getServerConfigs();
      expect(configs).toHaveLength(1);
      expect(configs[0].transport.url).toBe("https://custom-linear.example.com/sse");
    });
  });

  describe("tool loading", () => {
    it("converts MCP tools to handler blocks with namespaced names", async () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const { factory } = createMockClientFactory({
        linear: {
          create_issue: fakeMcpTool("create_issue", "Create an issue"),
          get_issue: fakeMcpTool("get_issue", "Get an issue"),
        },
      });

      const manager = createMcpManager({ _createClient: factory });
      const tools = await manager.getTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("mcp__linear__create_issue");
      expect(tools[0].description).toBe("Create an issue");
      expect(tools[0].kind).toBe("handler");
      expect(tools[1].name).toBe("mcp__linear__get_issue");
    });

    it("caches tools on subsequent calls (lazy init)", async () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const factorySpy = vi.fn(
        createMockClientFactory({ linear: { test_tool: fakeMcpTool("test", "A test tool") } }).factory,
      );

      const manager = createMcpManager({ _createClient: factorySpy });
      const tools1 = await manager.getTools();
      const tools2 = await manager.getTools();

      expect(tools1).toBe(tools2); // Same reference — cached
      expect(factorySpy).toHaveBeenCalledTimes(1);
    });

    it("loads tools from multiple servers", async () => {
      const config = [
        { name: "server-a", transport: { type: "sse", url: "https://a.com/sse" } },
        { name: "server-b", transport: { type: "sse", url: "https://b.com/sse" } },
      ];
      setEnv("MCP_SERVERS", JSON.stringify(config));

      const { factory } = createMockClientFactory({
        "server-a": { tool_a: fakeMcpTool("a", "Tool A") },
        "server-b": { tool_b: fakeMcpTool("b", "Tool B") },
      });

      const manager = createMcpManager({ _createClient: factory });
      const tools = await manager.getTools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("mcp__server-a__tool_a");
      expect(tools.map((t) => t.name)).toContain("mcp__server-b__tool_b");
    });
  });

  describe("error handling", () => {
    it("skips servers that fail to connect", async () => {
      const config = [
        { name: "good", transport: { type: "sse", url: "https://good.com/sse" } },
        { name: "bad", transport: { type: "sse", url: "https://bad.com/sse" } },
      ];
      setEnv("MCP_SERVERS", JSON.stringify(config));

      const { factory } = createMockClientFactory(
        { good: { good_tool: fakeMcpTool("good", "Good tool") } },
        { failServers: ["bad"] },
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const manager = createMcpManager({ _createClient: factory });
      const tools = await manager.getTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("mcp__good__good_tool");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect to "bad"'),
      );
      warnSpy.mockRestore();
    });

    it("tracks connected server names", async () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const { factory } = createMockClientFactory({
        linear: { test: fakeMcpTool("test", "Test") },
      });

      const manager = createMcpManager({ _createClient: factory });

      expect(manager.getConnectedServerNames()).toEqual([]);
      await manager.getTools();
      expect(manager.getConnectedServerNames()).toEqual(["linear"]);
    });
  });

  describe("tool execution", () => {
    it("handler blocks proxy execution to MCP tool", async () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const executeFn = vi.fn().mockResolvedValue({ id: "ISS-123", title: "New issue" });
      const { factory } = createMockClientFactory({
        linear: {
          create_issue: {
            description: "Create an issue",
            parameters: { type: "object", properties: {} },
            execute: executeFn,
          },
        },
      });

      const manager = createMcpManager({ _createClient: factory });
      const tools = await manager.getTools();
      const tool = tools[0];

      const result = await tool.run({ title: "Test issue" }, {} as any);

      expect(executeFn).toHaveBeenCalledWith({ title: "Test issue" });
      expect(result).toEqual({ id: "ISS-123", title: "New issue" });
    });

    it("handles tools without execute gracefully", async () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const { factory } = createMockClientFactory({
        linear: {
          no_exec: {
            description: "A tool without execute",
            parameters: { type: "object", properties: {} },
          } as any,
        },
      });

      const manager = createMcpManager({ _createClient: factory });
      const tools = await manager.getTools();
      const tool = tools[0];

      const result = await tool.run({}, {} as any);
      expect(result).toEqual({
        error: expect.stringContaining("does not support execution"),
      });
    });
  });

  describe("cleanup", () => {
    it("close() disconnects all clients", async () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const { factory, closeFns } = createMockClientFactory({
        linear: { test: fakeMcpTool("test", "Test") },
      });

      const manager = createMcpManager({ _createClient: factory });
      await manager.getTools();
      await manager.close();

      expect(closeFns[0]).toHaveBeenCalledTimes(1);
      expect(manager.getConnectedServerNames()).toEqual([]);
    });

    it("close() resets tool cache (re-connects on next getTools)", async () => {
      setEnv("LINEAR_MCP_API_KEY", "test-key");
      const factorySpy = vi.fn(
        createMockClientFactory({ linear: { test: fakeMcpTool("test", "Test") } }).factory,
      );

      const manager = createMcpManager({ _createClient: factorySpy });
      await manager.getTools();
      expect(factorySpy).toHaveBeenCalledTimes(1);

      await manager.close();

      // Re-load triggers a new connection
      await manager.getTools();
      expect(factorySpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe("MCP Capability", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      MCP_SERVERS: process.env.MCP_SERVERS,
      LINEAR_MCP_API_KEY: process.env.LINEAR_MCP_API_KEY,
    };
    delete process.env.MCP_SERVERS;
    delete process.env.LINEAR_MCP_API_KEY;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      setEnv(key, value);
    }
  });

  it("returns null when no servers configured", async () => {
    const { buildMcpCapabilityForTest } = await import("./mcp-test-helpers");
    const cap = buildMcpCapabilityForTest(createMcpManager());
    expect(cap).toBeNull();
  });

  it("returns a capability when servers are configured", async () => {
    setEnv("LINEAR_MCP_API_KEY", "test-key");
    const { buildMcpCapabilityForTest } = await import("./mcp-test-helpers");
    const manager = createMcpManager();
    const cap = buildMcpCapabilityForTest(manager);

    expect(cap).not.toBeNull();
    expect((cap as any).name).toBe("mcp");
  });
});
