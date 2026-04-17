/**
 * The MCP capability factory. Wires an MCP manager (provided or internally
 * created from `servers`) into a defineCapability with two presets:
 *   - tools: tool array filtered through filterTools, with enriched descriptions
 *   - guidance: system-prompt block generated from the live catalog
 *
 * Also contributes a requestStateSchema so flows inherit typed
 * `ctx.request.state.mcp.{disabledTools,disabledServers}` for free.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { GeneratorTool, DefinedCapability } from "@flow-state-dev/core";
import { createMcpManager } from "./manager";
import { defaultMcpGuidanceFormatter } from "./context";
import { defaultMcpFilterTools, mcpRequestStateSchema } from "./filter";
import { enrichDescription, getMcpToolMeta } from "./enrich";
import type {
  CreateMcpCapabilityOptions,
  EnrichDescriptionsMode,
  MCPCatalog,
  MCPManager,
  MCPServerConfig,
} from "./types";

function applyEnrichment(
  tools: GeneratorTool[],
  servers: MCPServerConfig[],
  mode: EnrichDescriptionsMode,
): GeneratorTool[] {
  if (mode === false) return tools;
  const byName = new Map(servers.map((s) => [s.name, s]));
  for (const tool of tools) {
    const meta = getMcpToolMeta(tool);
    if (!meta) continue;
    const server = byName.get(meta.mcp.server);
    if (!server) continue;
    (tool as any).description = enrichDescription(
      (tool as any).description ?? "",
      server,
      mode,
    );
  }
  return tools;
}

export function createMcpCapability(
  options: CreateMcpCapabilityOptions,
): DefinedCapability {
  const manager: MCPManager =
    "manager" in options && options.manager
      ? options.manager
      : createMcpManager({ servers: (options as { servers: MCPServerConfig[] }).servers });

  const enrichMode: EnrichDescriptionsMode = options.enrichDescriptions ?? "prefix";
  const filterTools = options.filterTools ?? defaultMcpFilterTools;
  const formatGuidance =
    options.formatGuidance ?? ((catalog: MCPCatalog) => defaultMcpGuidanceFormatter(catalog));

  return defineCapability({
    name: "mcp",
    requestStateSchema: mcpRequestStateSchema,
    presets: {
      tools: {
        tools: async (ctx) => {
          const raw = await manager.getTools();
          const enriched = applyEnrichment(raw, manager.getServerConfigs(), enrichMode);
          return filterTools(ctx as any, enriched);
        },
      },
      guidance: {
        context: [(_input, _ctx) => formatGuidance(manager.getCatalog())],
      },
      default: ["tools", "guidance"],
    },
  });
}
