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
  type: "sse";
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
  execute?: (args: any) => Promise<unknown>;
};

export type MCPManager = {
  getTools(): Promise<GeneratorTool[]>;
  getCatalog(): MCPCatalog;
  getConnectedServerNames(): string[];
  getServerConfigs(): MCPServerConfig[];
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

