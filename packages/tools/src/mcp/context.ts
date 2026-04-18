/**
 * Pure selection-guidance formatter for MCP. Produces a markdown block for
 * the generator's system prompt that tells the model which external services
 * are available, when to use each, and how to call their tools.
 *
 * Errored and pending servers are omitted so the model only sees services
 * it can actually reach in this turn.
 */
import type { MCPCatalog, MCPCatalogServer } from "./types";

const OTHER_CATEGORY = "Other";

function titleCase(value: string): string {
  if (value.length === 0) return value;
  const normalized = value.replace(/-/g, " ");
  return normalized[0].toUpperCase() + normalized.slice(1);
}

function hasRichMetadata(server: MCPCatalogServer): boolean {
  return Boolean(
    server.metadata.description ||
      server.metadata.whenToUse ||
      (server.metadata.examples?.length ?? 0) > 0,
  );
}

/**
 * Render the generic guidance block when no connected server has rich metadata.
 * Caller guarantees `servers` is non-empty (empty catalogs return early).
 */
function formatDegraded(servers: MCPCatalogServer[]): string {
  const names = servers.map((s) => s.name).join(", ");
  const first = servers[0].name;
  return [
    "## MCP Tools",
    `You have access to tools from these MCP servers: ${names}.`,
    `Tool names are prefixed with the server name (e.g. mcp__${first}__tool_name).`,
  ].join("\n");
}

function formatServer(server: MCPCatalogServer): string {
  const lines: string[] = [`#### ${server.name}`];
  const hasAny =
    Boolean(server.metadata.description) ||
    Boolean(server.metadata.whenToUse) ||
    (server.metadata.examples?.length ?? 0) > 0;

  if (!hasAny) {
    lines.push(
      `Tools are prefixed with \`mcp__${server.name}__\`. Consult their descriptions to decide when to call.`,
    );
    return lines.join("\n");
  }

  if (server.metadata.description) lines.push(server.metadata.description);
  if (server.metadata.whenToUse) lines.push(`Use when: ${server.metadata.whenToUse}`);
  if (server.metadata.examples && server.metadata.examples.length > 0) {
    lines.push("Examples:");
    for (const example of server.metadata.examples) {
      lines.push(`  - ${example}`);
    }
  }
  return lines.join("\n");
}

/**
 * Format an MCP catalog into a markdown system-prompt block. Only connected
 * servers are included. Returns an empty string if no servers are connected.
 */
export function defaultMcpGuidanceFormatter(catalog: MCPCatalog): string {
  const connected = catalog.servers.filter((s) => s.status === "connected");
  if (connected.length === 0) return "";

  const anyRich = connected.some(hasRichMetadata);
  if (!anyRich) return formatDegraded(connected);

  const groups = new Map<string, MCPCatalogServer[]>();
  for (const server of connected) {
    const key = server.metadata.category ?? OTHER_CATEGORY;
    const group = groups.get(key) ?? [];
    group.push(server);
    groups.set(key, group);
  }

  const lines: string[] = [
    "## MCP Tools",
    "",
    "You have access to tools from these external services. Use them when the user's",
    "request matches the service's purpose.",
  ];

  // Stable ordering: defined categories first (insertion order), then "Other" last.
  const orderedKeys = [
    ...Array.from(groups.keys()).filter((k) => k !== OTHER_CATEGORY),
    ...(groups.has(OTHER_CATEGORY) ? [OTHER_CATEGORY] : []),
  ];

  for (const key of orderedKeys) {
    lines.push("");
    lines.push(`### ${titleCase(key)}`);
    for (const server of groups.get(key)!) {
      lines.push("");
      lines.push(formatServer(server));
    }
  }

  return lines.join("\n");
}
