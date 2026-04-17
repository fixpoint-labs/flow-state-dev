/**
 * MCP manager — lazy connection to configured servers, tool caching, catalog,
 * and idempotent close. Converts MCP tool definitions into namespaced handler
 * blocks and attaches MCPToolMeta markers for downstream filtering.
 *
 * Per-server error isolation is added in Task 6.
 */
import { handler } from "@flow-state-dev/core";
import type { GeneratorTool } from "@flow-state-dev/core";
import { z } from "zod";
import { MCP_TOOL_META, type MCPToolMeta, type AiSdkMcpTool } from "./types";
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

const passthroughSchema = z.record(z.unknown());

/**
 * Convert a single MCP tool definition into a framework handler block.
 *
 * Two post-construction mutations are deliberate:
 *   1. `inputSchema` is overridden with the MCP tool's native AI-SDK
 *      `jsonSchema()` wrapper (when provided) so the AI SDK can consume it
 *      directly without our passthrough Zod schema being in the way.
 *   2. The `MCP_TOOL_META` symbol-keyed marker is attached so capability-level
 *      filters can identify MCP-origin tools without parsing tool names.
 *      This marker is invisible to the rest of the framework.
 *
 * The MCP server is authoritative for argument validation on the execute
 * path; our passthrough schema is only a permissive framework-level fallback.
 */
function mcpToolToHandler(
  serverName: string,
  originalName: string,
  mcpTool: AiSdkMcpTool,
): GeneratorTool {
  const namespacedName = `mcp__${serverName}__${originalName}`;

  const block = handler({
    name: namespacedName,
    description: mcpTool.description ?? `Tool from MCP server: ${serverName}`,
    inputSchema: passthroughSchema,
    execute: async (input: Record<string, unknown>) => {
      if (!mcpTool.execute) {
        // Deliberate soft-fail: surface the configuration issue to the model as a
        // tool result rather than throwing. A missing `execute` is an MCP server
        // defect, but for Phase 1 we'd rather keep the flow running than abort.
        return {
          error: `Tool ${originalName} on server ${serverName} does not support execution.`,
        };
      }
      return mcpTool.execute(input);
    },
  });

  // Override the passthrough Zod schema with the AI SDK jsonSchema() wrapper so
  // the generator's normalizeToolSchema passes it through unmodified. `as any`
  // is needed because the block's `inputSchema` is typed as `typeof passthroughSchema`.
  if (mcpTool.inputSchema !== undefined) {
    (block as any).inputSchema = mcpTool.inputSchema;
  }

  (block as any)[MCP_TOOL_META] = {
    mcp: { server: serverName, originalName },
  } satisfies MCPToolMeta;

  return block;
}

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
    const handlers: GeneratorTool[] = [];
    for (const [originalName, mcpTool] of Object.entries(mcpTools)) {
      handlers.push(mcpToolToHandler(entry.config.name, originalName, mcpTool));
    }
    entry.tools = handlers;
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
