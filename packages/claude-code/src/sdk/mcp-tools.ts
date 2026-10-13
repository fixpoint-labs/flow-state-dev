/**
 * Tools the host process serves to a run, presented to Claude Code as MCP
 * servers that live in the host process (`ClaudeCodeAgentOptions.mcpTools`).
 *
 * The Agent SDK takes an in-process MCP server as `{ type: "sdk", name,
 * instance }`: the instance stays here, Claude Code learns only its name, and
 * every message between them crosses the SDK's own control channel. The SDK
 * asks the instance for one thing, `connect(transport)`, the way an MCP
 * `Server` connects. {@link inProcessMcpServer} answers that with the few
 * requests a tool server takes (`initialize`, `ping`, `tools/list`,
 * `tools/call`, and a cancelled call), so a tool's input JSON Schema reaches
 * Claude Code exactly as the host hands it, with no schema library between.
 *
 * Nothing here knows where a tool's work happens or what credential it uses:
 * an entry is a name, a description, a schema and a `call`. There is no field
 * for an address or headers.
 */

/** One tool the host serves to a run. */
export interface ClaudeCodeMcpTool {
  /** The tool's name on its server; the run sees it as `mcp__<server>__<name>`. */
  name: string;
  description?: string;
  /** The tool's input as a JSON Schema object, handed to Claude Code unchanged. */
  inputSchema: Record<string, unknown>;
  /**
   * Run the tool. Resolve to an MCP `CallToolResult` (`{ content, isError? }`)
   * to answer with it as is, or to any other value, which the run reads as
   * JSON text. A throw answers the run with an error result. `signal` aborts
   * when the run cancels the call.
   */
  call(args: Record<string, unknown>, options: { signal?: AbortSignal }): Promise<unknown>;
}

/** One server's worth of tools, and what to call when the run ends. */
export interface ClaudeCodeMcpToolServer {
  tools: ClaudeCodeMcpTool[];
  /** Called once when the run ends, however it ends. */
  close?: () => Promise<void> | void;
}

/** The tools a run is handed, grouped by server name. */
export type ClaudeCodeMcpTools = Record<string, ClaudeCodeMcpToolServer>;

/** The slice of an MCP transport the SDK hands an in-process server. */
interface TransportLike {
  start?: () => Promise<void>;
  send: (message: unknown) => Promise<void>;
  close?: () => Promise<void>;
  onmessage?: (message: unknown) => void;
}

/** A JSON-RPC request or notification, as far as this server reads one. */
type Incoming = { id?: string | number; method?: string; params?: Record<string, unknown> };

/** An MCP server object the Agent SDK can host in-process: it connects, and closes. */
export interface InProcessMcpServer {
  connect(transport: TransportLike): Promise<void>;
  close(): Promise<void>;
}

/** The protocol version answered when the client names none. */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

/** A JSON-RPC error with its code. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * An in-process MCP server for one entry of `mcpTools`, for the SDK's
 * `{ type: "sdk", name, instance }`.
 *
 * @param name The server's name, as the run sees it in `mcp__<name>__…`.
 * @param tools What it lists and calls.
 */
export function inProcessMcpServer(name: string, tools: readonly ClaudeCodeMcpTool[]): InProcessMcpServer {
  let transport: TransportLike | undefined;
  const calls = new Map<string | number, AbortController>();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const answer = async (request: Incoming): Promise<unknown> => {
    switch (request.method) {
      case "initialize": {
        const asked = request.params?.protocolVersion;
        return {
          protocolVersion: typeof asked === "string" ? asked : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name, version: "1.0.0" },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: tools.map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            inputSchema: objectSchema(tool.inputSchema),
          })),
        };
      case "tools/call": {
        const tool = byName.get(String(request.params?.name));
        if (tool === undefined) {
          return errorResult(`Tool ${String(request.params?.name)} is not on MCP server ${name}.`);
        }
        const args = request.params?.arguments;
        const controller = new AbortController();
        if (request.id !== undefined) calls.set(request.id, controller);
        try {
          return toCallToolResult(
            await tool.call(typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {}, {
              signal: controller.signal,
            }),
          );
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        } finally {
          if (request.id !== undefined) calls.delete(request.id);
        }
      }
      default:
        throw new RpcError(-32601, `Method not found: ${String(request.method)}`);
    }
  };

  const receive = async (message: unknown): Promise<void> => {
    const request = message as Incoming;
    if (typeof request?.method !== "string") return; // A response: this server sends no requests.
    if (request.id === undefined) {
      if (request.method === "notifications/cancelled") calls.get(request.params?.requestId as string)?.abort();
      return;
    }
    try {
      const result = await answer(request);
      await transport?.send({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      const code = error instanceof RpcError ? error.code : -32603;
      const text = error instanceof Error ? error.message : String(error);
      // Ignored: this already reports a failure, and a send that fails here means the
      // transport is gone, so there is no one left to tell.
      await transport?.send({ jsonrpc: "2.0", id: request.id, error: { code, message: text } }).catch(() => {});
    }
  };

  return {
    async connect(next) {
      transport = next;
      next.onmessage = (message) => void receive(message);
      await next.start?.();
    },
    async close() {
      for (const call of calls.values()) call.abort();
      await transport?.close?.();
    },
  };
}

/** A tool's schema as MCP requires it: an object schema. */
function objectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return schema.type === "object" ? schema : { ...schema, type: "object" };
}

/** An error answer the run reads as a failed tool call. */
function errorResult(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * What a tool's `call` resolved to, as an MCP `CallToolResult`: one that is
 * already shaped as one (a `content` array) passes through, anything else is
 * answered as text.
 */
export function toCallToolResult(value: unknown): { content: unknown[]; isError?: boolean } {
  if (typeof value === "object" && value !== null && Array.isArray((value as { content?: unknown }).content)) {
    return value as { content: unknown[]; isError?: boolean };
  }
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return { content: [{ type: "text", text }] };
}
