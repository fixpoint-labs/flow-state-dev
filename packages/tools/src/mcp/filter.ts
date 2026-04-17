/**
 * Default filter hook for MCP tools plus the request-state schema fragment
 * the capability contributes. Apps that want session-persistent disables
 * compose on top of the default; apps that want a fully custom policy pass
 * their own filterTools.
 */
import { z } from "zod";
import type { GeneratorTool } from "@flow-state-dev/core";
import { getMcpToolMeta } from "./enrich";
import type { FilterTools } from "./types";

/**
 * Schema contributed to the flow's requestStateSchema. Gives flows a typed
 * `ctx.request.state.mcp` surface consumed by `defaultMcpFilterTools`.
 */
export const mcpRequestStateSchema = z
  .object({
    mcp: z
      .object({
        disabledTools: z.array(z.string()).optional(),
        disabledServers: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

/**
 * Default filter: reads `ctx.request.state.mcp.disabledTools` and
 * `disabledServers` and removes any matching entries. Tools without
 * MCPToolMeta always pass through.
 */
export const defaultMcpFilterTools: FilterTools = (ctx, tools) => {
  // CapabilityPresetCtx does not type `request`; cast is safe because the
  // runtime always shapes it as { state: requestState } when request scope is
  // threaded into preset callbacks.
  const mcp = (ctx.request?.state as any)?.mcp ?? {};
  const disabledTools: string[] = mcp.disabledTools ?? [];
  const disabledServers: string[] = mcp.disabledServers ?? [];

  if (disabledTools.length === 0 && disabledServers.length === 0) return tools;

  return tools.filter((tool: GeneratorTool) => {
    if (disabledTools.includes(tool.name)) return false;
    const meta = getMcpToolMeta(tool);
    return !meta || !disabledServers.includes(meta.mcp.server);
  });
};
