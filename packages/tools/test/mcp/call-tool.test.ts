/**
 * `MCPManager.callTool` and the catalog's plain `jsonSchema`: the path a
 * caller relaying a server's tools to another MCP client goes through, on the
 * same connection a generator's tools use. Scripted clients, no network.
 */
import { describe, expect, it, vi } from "vitest";
import { createMcpManager } from "../../src/mcp/manager";
import type { AiSdkMcpTool, MCPServerConfig } from "../../src/mcp/types";
import { createMockClientFactory, fakeMcpTool, linearConfig } from "./fixtures";

const githubConfig: MCPServerConfig = { name: "github", transport: { type: "http", url: "https://example.test/mcp" } };

describe("callTool", () => {
  it("calls the named tool on its own server's connection and returns what the server answered", async () => {
    const linearIssue = fakeMcpTool("get_issue", "Read one issue");
    const githubIssue = fakeMcpTool("get_issue", "Read one GitHub issue");
    const { factory } = createMockClientFactory({ linear: { get_issue: linearIssue }, github: { get_issue: githubIssue } });
    const manager = createMcpManager({ servers: [linearConfig, githubConfig], _createClient: factory });

    // Connects on first use, with no getTools() first.
    const answer = await manager.callTool("mcp__linear__get_issue", { query: "ABC-1" });

    expect(answer).toEqual({ result: "get_issue-output" });
    expect(linearIssue.execute).toHaveBeenCalledWith({ query: "ABC-1" }, {});
    // The same original name on another server is a different tool.
    expect(githubIssue.execute).not.toHaveBeenCalled();
  });

  it("hands the caller's abort signal to the server's client, and refuses a call already aborted", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const slow: AiSdkMcpTool = {
      inputSchema: { jsonSchema: { type: "object" } },
      execute: (_args, options) =>
        new Promise((_resolve, reject) => {
          seen.push(options?.abortSignal);
          options?.abortSignal?.addEventListener("abort", () => reject(new Error("cancelled by the server's client")));
        }),
    };
    const manager = createMcpManager({
      servers: [linearConfig],
      _createClient: async () => ({ tools: async () => ({ slow }), close: vi.fn().mockResolvedValue(undefined) }),
    });

    const controller = new AbortController();
    const call = manager.callTool("mcp__linear__slow", {}, { signal: controller.signal });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toBe(controller.signal);
    controller.abort();
    await expect(call).rejects.toThrow("cancelled by the server's client");

    await expect(manager.callTool("mcp__linear__slow", {}, { signal: controller.signal })).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });

  it("refuses a name no connected server has, and a server that failed to connect", async () => {
    const { factory } = createMockClientFactory(
      { linear: { get_issue: fakeMcpTool("get_issue", "Read one issue") } },
      { failServers: ["github"] },
    );
    const manager = createMcpManager({ servers: [linearConfig, githubConfig], _createClient: factory });
    await expect(manager.callTool("mcp__linear__nope", {})).rejects.toThrow("No connected MCP server has a tool named mcp__linear__nope");
    await expect(manager.callTool("mcp__github__get_issue", {})).rejects.toThrow("No connected MCP server");
    await expect(manager.callTool("get_issue", {})).rejects.toThrow("No connected MCP server");
  });
});

describe("the catalog's jsonSchema", () => {
  it("is each tool's input schema as plain JSON, unwrapped from the AI SDK's wrapper", async () => {
    const { factory } = createMockClientFactory({ linear: { get_issue: fakeMcpTool("get_issue", "Read one issue") } });
    const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });
    await manager.getTools();
    const [tool] = manager.getCatalog().servers[0]!.tools;
    expect(tool!.jsonSchema).toEqual({ type: "object", properties: { query: { type: "string" } } });
    expect(JSON.parse(JSON.stringify(tool!.jsonSchema))).toEqual(tool!.jsonSchema);
  });

  it("is an empty object schema for a tool that published none", async () => {
    const manager = createMcpManager({
      servers: [linearConfig],
      _createClient: async () => ({ tools: async () => ({ bare: {} }), close: async () => {} }),
    });
    await manager.getTools();
    expect(manager.getCatalog().servers[0]!.tools[0]!.jsonSchema).toEqual({ type: "object" });
  });
});

describe("a connection that fails", () => {
  it("keeps the server's header values out of the catalog's error and the log line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const manager = createMcpManager({
        servers: [{ ...linearConfig, transport: { type: "http", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer lin_api_SENTINEL123" } } }],
        _createClient: async () => {
          throw new Error("401: Authorization Bearer lin_api_SENTINEL123 was rejected");
        },
      });
      await manager.getTools();
      const [server] = manager.getCatalog().servers;
      expect(server!.status).toBe("errored");
      expect(server!.error).toBe("401: Authorization … was rejected");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SENTINEL");
    } finally {
      warn.mockRestore();
    }
  });

  it("takes out a short key echoed on its own, and a one-word header value, and leaves the scheme word", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const manager = createMcpManager({
        servers: [
          { ...linearConfig, transport: { type: "http", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer k3y", "X-Api-Key": "q7" } } },
        ],
        _createClient: async () => {
          throw new Error("401: Bearer token k3y rejected; api key q7 unknown");
        },
      });
      await manager.getTools();
      expect(manager.getCatalog().servers[0]!.error).toBe("401: Bearer token … rejected; api key … unknown");
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/k3y|q7/);
    } finally {
      warn.mockRestore();
    }
  });
});
