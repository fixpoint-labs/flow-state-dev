/**
 * MCP (Model Context Protocol) client manager for kitchen-sink.
 *
 * Manages connections to MCP servers and converts their tools into framework
 * handler blocks. Tools are lazily loaded on first access and cached. Each
 * MCP tool becomes a namespaced handler block (mcp__{server}__{tool}) that
 * proxies execution to the MCP server.
 *
 * Config comes from environment variables:
 *   - MCP_SERVERS: JSON array of MCPServerConfig objects
 *   - LINEAR_MCP_API_KEY: shorthand that auto-configures Linear MCP
 */
import { handler, type GeneratorTool } from "@flow-state-dev/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MCPServerConfig = {
  /** Display name used for tool namespacing (e.g. "linear" → mcp__linear__*) */
  name: string;
  transport: {
    type: "sse";
    url: string;
    headers?: Record<string, string>;
  };
};

export type MCPManager = {
  /** Returns handler blocks for all tools from all connected MCP servers. */
  getTools(): Promise<GeneratorTool[]>;
  /** Returns the names of servers that have successfully connected. */
  getConnectedServerNames(): string[];
  /** Returns the raw config for all configured servers. */
  getServerConfigs(): MCPServerConfig[];
  /** Closes all MCP client connections. */
  close(): Promise<void>;
};

/** MCP client interface — abstracted for testability. */
type MCPClient = {
  tools(): Promise<Record<string, { description?: string; parameters?: unknown; execute?: (args: any) => Promise<unknown> }>>;
  close(): Promise<void>;
};

export type MCPManagerOptions = {
  /** Override the MCP client factory (for testing). */
  _createClient?: (config: MCPServerConfig) => Promise<MCPClient>;
};

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveConfigs(): MCPServerConfig[] {
  const configs: MCPServerConfig[] = [];

  // Explicit config via MCP_SERVERS env var (JSON array)
  const serversJson = process.env.MCP_SERVERS;
  if (serversJson) {
    try {
      const parsed = JSON.parse(serversJson);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry.name && entry.transport?.url) {
            configs.push(entry as MCPServerConfig);
          }
        }
      }
    } catch {
      console.warn("[mcp] Failed to parse MCP_SERVERS env var — ignoring.");
    }
  }

  // Shorthand: LINEAR_MCP_API_KEY auto-configures Linear MCP server
  const linearKey = process.env.LINEAR_MCP_API_KEY;
  if (linearKey && !configs.some((c) => c.name === "linear")) {
    configs.push({
      name: "linear",
      transport: {
        type: "sse",
        url: "https://mcp.linear.app/sse",
        headers: { Authorization: `Bearer ${linearKey}` },
      },
    });
  }

  return configs;
}

// ---------------------------------------------------------------------------
// Tool conversion — MCP tool → handler block
// ---------------------------------------------------------------------------

/**
 * Convert an MCP tool (AI SDK format) into a framework handler block.
 *
 * Uses a permissive Zod schema (z.record) for framework input validation,
 * and patches the block's inputSchema with the MCP tool's JSON Schema
 * so the AI SDK sends correct parameter definitions to the model.
 *
 * The MCP server handles its own argument validation on the execute path.
 */
function mcpToolToHandler(
  serverName: string,
  toolName: string,
  mcpTool: { description?: string; parameters?: unknown; execute?: (args: any) => Promise<unknown> },
): GeneratorTool {
  const namespacedName = `mcp__${serverName}__${toolName}`;

  // Use a permissive Zod schema for the framework's input validation.
  // The MCP server validates arguments on its end.
  const validationSchema = z.record(z.unknown());

  const block = handler({
    name: namespacedName,
    description: mcpTool.description ?? `Tool from MCP server: ${serverName}`,
    inputSchema: validationSchema,
    execute: async (input: Record<string, unknown>) => {
      if (!mcpTool.execute) {
        return { error: `Tool ${toolName} on server ${serverName} does not support execution.` };
      }
      return mcpTool.execute(input);
    },
  });

  // Patch the block's inputSchema with the MCP tool's JSON Schema if available.
  // compileToolsWithExecute reads tool.inputSchema → AI SDK tool parameters.
  // The AI SDK accepts jsonSchema() objects, Zod schemas, and raw JSON Schema.
  if (mcpTool.parameters) {
    (block as any).inputSchema = mcpTool.parameters;
  }

  return block;
}

// ---------------------------------------------------------------------------
// Client connection — lazy, cached, resilient
// ---------------------------------------------------------------------------

type ClientEntry = {
  config: MCPServerConfig;
  tools: GeneratorTool[] | null;
  connected: boolean;
  error?: string;
};

/** Default client factory — uses @ai-sdk/mcp (dynamic import). */
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

async function connectAndLoadTools(
  config: MCPServerConfig,
  createClient: (config: MCPServerConfig) => Promise<MCPClient>,
): Promise<{ tools: GeneratorTool[]; close: () => Promise<void> }> {
  const client = await createClient(config);
  const mcpTools = await client.tools();
  const handlers: GeneratorTool[] = [];

  for (const [name, tool] of Object.entries(mcpTools)) {
    handlers.push(mcpToolToHandler(config.name, name, tool as any));
  }

  return {
    tools: handlers,
    close: () => client.close(),
  };
}

// ---------------------------------------------------------------------------
// Manager factory
// ---------------------------------------------------------------------------

/**
 * Creates an MCP manager that reads server config from environment variables
 * and lazily connects to servers on first tool request.
 */
export function createMcpManager(options?: MCPManagerOptions): MCPManager {
  const configs = resolveConfigs();
  const createClient = options?._createClient ?? defaultCreateClient;
  const entries = new Map<string, ClientEntry>();
  const closeFns: Array<() => Promise<void>> = [];
  let toolsPromise: Promise<GeneratorTool[]> | null = null;

  // Initialize entries from config (not yet connected)
  for (const config of configs) {
    entries.set(config.name, { config, tools: null, connected: false });
  }

  if (configs.length > 0) {
    console.log(`[mcp] Configured ${configs.length} MCP server(s): ${configs.map((c) => c.name).join(", ")}`);
  }

  async function loadAllTools(): Promise<GeneratorTool[]> {
    const allTools: GeneratorTool[] = [];

    const results = await Promise.allSettled(
      configs.map(async (config) => {
        const entry = entries.get(config.name)!;
        try {
          const { tools, close } = await connectAndLoadTools(config, createClient);
          entry.tools = tools;
          entry.connected = true;
          closeFns.push(close);
          return tools;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          entry.error = message;
          console.warn(`[mcp] Failed to connect to "${config.name}": ${message}`);
          return [];
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allTools.push(...result.value);
      }
    }

    if (allTools.length > 0) {
      console.log(`[mcp] Loaded ${allTools.length} tool(s) from MCP servers.`);
    }

    return allTools;
  }

  return {
    async getTools(): Promise<GeneratorTool[]> {
      if (configs.length === 0) return [];
      // Lazy init — connect on first tool request, cache the result.
      if (!toolsPromise) {
        toolsPromise = loadAllTools();
      }
      return toolsPromise;
    },

    getConnectedServerNames(): string[] {
      return [...entries.values()]
        .filter((e) => e.connected)
        .map((e) => e.config.name);
    },

    getServerConfigs(): MCPServerConfig[] {
      return configs;
    },

    async close(): Promise<void> {
      await Promise.allSettled(closeFns.map((fn) => fn()));
      closeFns.length = 0;
      for (const entry of entries.values()) {
        entry.connected = false;
        entry.tools = null;
      }
      toolsPromise = null;
    },
  };
}
