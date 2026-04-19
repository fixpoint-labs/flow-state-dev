/**
 * Type-level tests for MCP capability composition.
 *
 * Confirms the `requestStateSchema` contributed by `createMcpCapability`
 * merges into a flow's request state, giving `ctx.request.state.mcp.*` a
 * typed surface at consumption sites without casts.
 */
import { createMcpCapability } from "../../src/mcp";
import type { MCPServerConfig } from "../../src/mcp";

const linear: MCPServerConfig = {
  name: "linear",
  transport: { type: "sse", url: "https://mcp.linear.app/sse" },
};

const cap = createMcpCapability({ servers: [linear] });

// The capability exposes a requestStateSchema at runtime.
const _schema: NonNullable<typeof cap.requestStateSchema> = cap.requestStateSchema!;

// The schema parses the expected shape.
const _parsed = _schema.parse({ mcp: { disabledTools: ["x"], disabledServers: ["y"] } });
const _disabledTools: string[] | undefined = _parsed?.mcp?.disabledTools;
const _disabledServers: string[] | undefined = _parsed?.mcp?.disabledServers;

void _disabledTools;
void _disabledServers;
