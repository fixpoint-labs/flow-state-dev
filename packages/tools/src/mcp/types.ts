/**
 * Public & internal types for the MCP integration module.
 *
 * Split from capability.ts so enrichment, context, and filter modules can
 * import types without pulling the factory and its transitive dependencies.
 */
import type { CapabilityPresetCtx, GeneratorTool } from "@flow-state-dev/core";

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

export type MCPTransportConfig = {
  /**
   * `"http"` is the Streamable HTTP transport and the recommended default for
   * remote MCP servers. `"sse"` remains supported for servers that have not
   * migrated yet, but most providers (including Linear) are deprecating it.
   */
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
};

export type MCPServerMetadata = {
  description?: string;
  whenToUse?: string;
  examples?: string[];
  category?: string;
};

export type MCPServerConfig = {
  name: string;
  transport: MCPTransportConfig;
} & MCPServerMetadata;

// ---------------------------------------------------------------------------
// Catalog (serializable catalog of connected servers + their tools)
// ---------------------------------------------------------------------------

export type MCPCatalogTool = {
  name: string;               // namespaced: "mcp__linear__list_issues"
  originalName: string;       // "list_issues"
  description: string;        // pre-enrichment
  inputSchema: unknown;       // AI SDK jsonSchema() wrapper
  /**
   * The tool's input JSON Schema as plain JSON, as the server published it:
   * what a caller relaying the tool to another MCP client hands on unchanged.
   * `{ type: "object" }` when the server published none.
   */
  jsonSchema: Record<string, unknown>;
};

export type MCPCatalogServer = {
  name: string;
  metadata: MCPServerMetadata;
  status: "pending" | "connected" | "errored";
  error?: string;
  tools: MCPCatalogTool[];
};

export type MCPCatalog = {
  servers: MCPCatalogServer[];
};

// ---------------------------------------------------------------------------
// Tool metadata marker (attached to each GeneratorTool via symbol key)
// ---------------------------------------------------------------------------

export const MCP_TOOL_META = Symbol.for("fsdev.mcp.meta");

export type MCPToolMeta = {
  mcp: {
    server: string;
    originalName: string;
  };
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export type MCPClient = {
  tools(): Promise<Record<string, AiSdkMcpTool>>;
  close(): Promise<void>;
};

export type AiSdkMcpTool = {
  description?: string;
  inputSchema?: unknown;
  execute?: (args: any, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;
};

/** Options for {@link MCPManager.callTool}. */
export type MCPCallToolOptions = {
  /** Aborts the call: handed to the server's client, which cancels the request. */
  signal?: AbortSignal;
};

export type MCPManager = {
  getTools(): Promise<GeneratorTool[]>;
  getCatalog(): MCPCatalog;
  getConnectedServerNames(): string[];
  /**
   * The configs the manager was built with, headers included. A header can
   * hold a credential: never log, record or emit what this returns.
   */
  getServerConfigs(): MCPServerConfig[];
  /**
   * Call one tool by its namespaced name (`mcp__<server>__<tool>`) on its
   * server's connection, and return what the server answered, as the
   * server's client returns it (an MCP `CallToolResult`, `isError` included).
   * Connects first if `getTools()` has not run yet.
   *
   * @throws When no connected server has a tool by that name, or the call
   *   itself fails (an abort included).
   */
  callTool(name: string, args: Record<string, unknown>, options?: MCPCallToolOptions): Promise<unknown>;
  close(): Promise<void>;
};

export type CreateMcpManagerOptions = {
  servers: MCPServerConfig[];
  /** Test-only / advanced escape hatch. */
  _createClient?: (config: MCPServerConfig) => Promise<MCPClient>;
};

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

export type FilterTools = (
  ctx: CapabilityPresetCtx,
  tools: GeneratorTool[],
) => GeneratorTool[] | Promise<GeneratorTool[]>;

export type EnrichDescriptionsMode = "prefix" | "category" | false;

type CommonCapabilityOptions = {
  filterTools?: FilterTools;
  enrichDescriptions?: EnrichDescriptionsMode;
  formatGuidance?: (catalog: MCPCatalog) => string;
};

export type CreateMcpCapabilityOptions =
  | ({ servers: MCPServerConfig[]; manager?: never } & CommonCapabilityOptions)
  | ({ manager: MCPManager; servers?: never } & CommonCapabilityOptions);

