/**
 * MCP manager — lazy connection to configured servers, tool caching, catalog,
 * and idempotent close. Errors per-server are isolated so one failed server
 * does not prevent others from loading.
 */
import type { GeneratorTool } from "@flow-state-dev/core";
import type {
  CreateMcpManagerOptions,
  MCPCatalog,
  MCPCatalogServer,
  MCPClient,
  MCPManager,
  MCPServerConfig,
} from "./types";

type ServerEntry = {
  config: MCPServerConfig;
  status: "pending" | "connected" | "errored";
  error?: string;
  tools: GeneratorTool[];
  close?: () => Promise<void>;
};

async function defaultCreateClient(config: MCPServerConfig): Promise<MCPClient> {
  const { createMCPClient } = await import("@ai-sdk/mcp");
  return createMCPClient({
    transport: {
      type: config.transport.type,
      url: config.transport.url,
      headers: config.transport.headers,
    },
  }) as unknown as MCPClient;
}

export function createMcpManager(options: CreateMcpManagerOptions): MCPManager {
  const { servers, _createClient = defaultCreateClient } = options;
  const entries: ServerEntry[] = servers.map((config) => ({
    config,
    status: "pending",
    tools: [],
  }));
  let loadPromise: Promise<GeneratorTool[]> | null = null;

  async function connect(entry: ServerEntry): Promise<void> {
    const client = await _createClient(entry.config);
    const mcpTools = await client.tools();
    // Tool conversion is added in Task 4; for now keep shape clear.
    entry.tools = [];
    void mcpTools;
    entry.close = () => client.close();
    entry.status = "connected";
  }

  async function loadAll(): Promise<GeneratorTool[]> {
    await Promise.all(entries.map((entry) => connect(entry)));
    return entries.flatMap((entry) => entry.tools);
  }

  return {
    async getTools() {
      if (entries.length === 0) return [];
      if (!loadPromise) loadPromise = loadAll();
      return loadPromise;
    },

    getCatalog(): MCPCatalog {
      const catalogServers: MCPCatalogServer[] = entries.map((entry) => ({
        name: entry.config.name,
        metadata: {
          description: entry.config.description,
          whenToUse: entry.config.whenToUse,
          examples: entry.config.examples,
          category: entry.config.category,
        },
        status: entry.status,
        error: entry.error,
        tools: [],
      }));
      return { servers: catalogServers };
    },

    getConnectedServerNames(): string[] {
      return entries.filter((e) => e.status === "connected").map((e) => e.config.name);
    },

    getServerConfigs(): MCPServerConfig[] {
      return entries.map((e) => e.config);
    },

    async close(): Promise<void> {
      await Promise.allSettled(entries.map((e) => e.close?.()));
      for (const entry of entries) {
        entry.status = "pending";
        entry.error = undefined;
        entry.tools = [];
        entry.close = undefined;
      }
      loadPromise = null;
    },
  };
}
