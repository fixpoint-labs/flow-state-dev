/**
 * Pure helpers for MCP tool metadata: description enrichment and meta marker
 * access. Pure functions — no side effects, no I/O. Safe to call from any
 * context that has already-loaded tool state.
 */
import {
  MCP_TOOL_META,
  type EnrichDescriptionsMode,
  type MCPServerConfig,
  type MCPToolMeta,
} from "./types";

/**
 * Wraps a tool description with server attribution according to the mode.
 * Always preserves the original description; only prepends.
 */
export function enrichDescription(
  original: string,
  server: MCPServerConfig,
  mode: EnrichDescriptionsMode,
): string {
  if (mode === false) return original;
  if (mode === "category" && server.category) {
    return `[${server.name} · ${server.category}] ${original}`;
  }
  return `[${server.name}] ${original}`;
}

/**
 * Reads the MCPToolMeta marker attached to a GeneratorTool. Returns null
 * for tools that did not originate from an MCP manager.
 */
export function getMcpToolMeta(tool: unknown): MCPToolMeta | null {
  if (tool === null || typeof tool !== "object") return null;
  const meta = (tool as any)[MCP_TOOL_META];
  return (meta as MCPToolMeta | undefined) ?? null;
}
