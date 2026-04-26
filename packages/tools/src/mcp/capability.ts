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
  // Map to fresh objects rather than mutating. The manager caches the tool
  // list, so mutating `description` in place compounds the enrichment on
  // repeated preset invocations (e.g. "[linear] [linear] ...").
  return tools.map((tool) => {
    const meta = getMcpToolMeta(tool);
    if (!meta) return tool;
    const server = byName.get(meta.mcp.server);
    if (!server) return tool;
    const description = enrichDescription(
      (tool as any).description ?? "",
      server,
      mode,
    );
    // Shallow spread preserves `run`, MCP_TOOL_META symbol slot, inputSchema,
    // and any other own properties added by handler() or the manager.
    return { ...tool, description } as GeneratorTool;
  });
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
  const formatGuidance = options.formatGuidance ?? defaultMcpGuidanceFormatter;

  return defineCapability({
    name: "mcp",
    requestStateSchema: mcpRequestStateSchema,
    presets: {
      tools: {
        tools: async (ctx) => {
          const raw = await manager.getTools();
          const enriched = applyEnrichment(raw, manager.getServerConfigs(), enrichMode);
          // See filter.ts: CapabilityPresetCtx does not type `request`, so we cast to
          // allow filterTools implementations to read ctx.request.state.mcp.*.
          return filterTools(ctx as any, enriched);
        },
      },
      guidance: {
        context: [(_input, _ctx) => ({ mcp: formatGuidance(manager.getCatalog()) })],
      },
      default: ["tools", "guidance"],
    },
  });
}
