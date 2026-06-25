/**
 * `@flow-state-dev/mcp` — MCP transport adapter for the Flow State Dev
 * runtime. Exposes every flow with `mcp.enabled: true` as its own MCP
 * server over Streamable HTTP at `POST /api/flows/:kind/mcp`.
 *
 * Mount alongside the built-in HTTP adapter:
 *
 *   import { createFlowApiRouter } from "@flow-state-dev/engine";
 *   import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
 *
 *   const router = createFlowApiRouter({
 *     registry,
 *     stores,
 *     adapters: [createMcpTransportAdapter()]
 *   });
 *
 * See FIX-22 for the design and v1 limitations (stateless only, single
 * JSON tool result, no progress notifications).
 */
export {
  createMcpTransportAdapter,
  MCP_TRANSPORT_SOURCE,
  type CreateMcpTransportAdapterOptions
} from "./createMcpTransportAdapter";
export {
  toolNameFromActionKey,
  resolveExposedActions,
  actionToMcpTool,
  type McpTool
} from "./tool-conversion";
export { toolResultFromExecution, type McpToolResult } from "./result-formatting";
export { toolInputJsonSchema } from "./schema";
