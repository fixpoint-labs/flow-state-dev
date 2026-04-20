/**
 * Public API for the MCP integration module.
 *
 * Re-exports the factory functions, default implementations, and types needed
 * to wire MCP servers into a flow via `uses: [createMcpCapability(...)]`.
 */
export { createMcpCapability } from "./capability";
export { createMcpManager } from "./manager";
export { defaultMcpGuidanceFormatter } from "./context";
export { defaultMcpFilterTools, mcpRequestStateSchema } from "./filter";
export { getMcpToolMeta } from "./enrich";
export { MCP_TOOL_META } from "./types";
export type {
  CreateMcpCapabilityOptions,
  CreateMcpManagerOptions,
  EnrichDescriptionsMode,
  FilterTools,
  MCPCatalog,
  MCPCatalogServer,
  MCPCatalogTool,
  MCPClient,
  MCPManager,
  MCPServerConfig,
  MCPServerMetadata,
  MCPToolMeta,
  MCPTransportConfig,
} from "./types";
