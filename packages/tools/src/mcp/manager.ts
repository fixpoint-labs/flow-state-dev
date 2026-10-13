/**
 * MCP manager — lazy connection to configured servers, tool caching, catalog,
 * a call path for one tool by its namespaced name, and idempotent close.
 * Per-server connection errors are isolated so one failed server does not
 * prevent others from loading.
 *
 * FSD's one MCP client: a generator's tools (`createMcpCapability`) and the
 * tools relayed to a coding run (`callTool` + the catalog's `jsonSchema`)
 * both go through it.
 */
import { handler } from "@flow-state-dev/core";
import type { GeneratorTool } from "@flow-state-dev/core";
import { z } from "zod";
import { MCP_TOOL_META, type MCPToolMeta, type AiSdkMcpTool } from "./types";
import type {
  CreateMcpManagerOptions,
  MCPCallToolOptions,
  MCPCatalog,
  MCPCatalogServer,
  MCPCatalogTool,
  MCPClient,
  MCPManager,
  MCPServerConfig,
} from "./types";

type ServerEntry = {
  config: MCPServerConfig;
  status: "pending" | "connected" | "errored";
  error?: string;
  tools: GeneratorTool[];
  catalogTools: MCPCatalogTool[];
  /** Each tool as its server's client returned it, by original name: what `callTool` executes. */
  clientTools: Record<string, AiSdkMcpTool>;
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

/** The plain JSON Schema behind an AI SDK `jsonSchema()` wrapper, or the value itself when it is one. */
function plainJsonSchema(inputSchema: unknown): Record<string, unknown> {
  const inner =
    typeof inputSchema === "object" && inputSchema !== null && "jsonSchema" in inputSchema
      ? (inputSchema as { jsonSchema: unknown }).jsonSchema
      : inputSchema;
  return typeof inner === "object" && inner !== null && !Array.isArray(inner)
    ? (inner as Record<string, unknown>)
    : { type: "object" };
}

/**
 * `text` with each secret replaced by `…`, longest first so a value and a
 * word inside it both go. Empty secrets are skipped. The one redaction rule
 * for MCP error text: this manager's connection failures and a relay's own.
 *
 * @param text The message to redact.
 * @param secrets Values that must not appear in it, such as a key or an address.
 * @returns The message with every secret taken out.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  return [...new Set(secrets)]
    .filter((secret): secret is string => secret !== undefined && secret.length > 0)
    .sort((a, b) => b.length - a.length)
    .reduce((redacted, secret) => redacted.split(secret).join("…"), text);
}

/**
 * A connection failure's message with the server's header values taken out,
 * so a credential a client echoed in its error never reaches the catalog or a
 * log line. Each value is removed whole, and so is each of its credential
 * words, however short: every word but a leading scheme (`Bearer` in
 * `Bearer <key>`), which is left so the message still reads.
 */
function withoutHeaderValues(message: string, config: MCPServerConfig): string {
  const headers = (config.transport as { headers?: Record<string, string> }).headers ?? {};
  const secrets = Object.values(headers).flatMap((value) => {
    const words = value.trim().split(/\s+/);
    return [value, ...(words.length > 1 ? words.slice(1) : words)];
  });
  return redactSecrets(message, secrets);
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
    catalogTools: [],
    clientTools: {},
  }));
  let loadPromise: Promise<GeneratorTool[]> | null = null;

  async function connect(entry: ServerEntry): Promise<void> {
    const client = await _createClient(entry.config);
    const mcpTools = await client.tools();
    const handlers: GeneratorTool[] = [];
    const catalog: MCPCatalogTool[] = [];
    for (const [originalName, mcpTool] of Object.entries(mcpTools)) {
      handlers.push(mcpToolToHandler(entry.config.name, originalName, mcpTool));
      catalog.push({
        name: `mcp__${entry.config.name}__${originalName}`,
        originalName,
        description: mcpTool.description ?? `Tool from MCP server: ${entry.config.name}`,
        inputSchema: mcpTool.inputSchema,
        jsonSchema: plainJsonSchema(mcpTool.inputSchema),
      });
    }
    entry.tools = handlers;
    entry.catalogTools = catalog;
    entry.clientTools = mcpTools;
    entry.close = () => client.close();
    entry.status = "connected";
  }

  async function loadAll(): Promise<GeneratorTool[]> {
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await connect(entry);
        } catch (err) {
          const message = withoutHeaderValues(err instanceof Error ? err.message : String(err), entry.config);
          entry.status = "errored";
          entry.error = message;
          console.warn(`[mcp] Failed to connect to "${entry.config.name}": ${message}`);
        }
      }),
    );
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
        tools: entry.catalogTools,
      }));
      return { servers: catalogServers };
    },

    getConnectedServerNames(): string[] {
      return entries.filter((e) => e.status === "connected").map((e) => e.config.name);
    },

    getServerConfigs(): MCPServerConfig[] {
      return entries.map((e) => e.config);
    },

    async callTool(name: string, args: Record<string, unknown>, options: MCPCallToolOptions = {}): Promise<unknown> {
      if (entries.length > 0) {
        if (!loadPromise) loadPromise = loadAll();
        await loadPromise;
      }
      for (const entry of entries) {
        if (entry.status !== "connected") continue;
        const prefix = `mcp__${entry.config.name}__`;
        if (!name.startsWith(prefix)) continue;
        const tool = entry.clientTools[name.slice(prefix.length)];
        if (tool === undefined) continue;
        if (!tool.execute) throw new Error(`Tool ${name} on server ${entry.config.name} does not support execution.`);
        options.signal?.throwIfAborted();
        return tool.execute(args, options.signal === undefined ? {} : { abortSignal: options.signal });
      }
      throw new Error(`No connected MCP server has a tool named ${name}.`);
    },

    async close(): Promise<void> {
      await Promise.allSettled(entries.map((e) => e.close?.()));
      for (const entry of entries) {
        entry.status = "pending";
        entry.error = undefined;
        entry.tools = [];
        entry.catalogTools = [];
        entry.clientTools = {};
        entry.close = undefined;
      }
      loadPromise = null;
    },
  };
}
