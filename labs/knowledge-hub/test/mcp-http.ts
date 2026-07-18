/**
 * Shared JSON-RPC `tools/call` helper for Knowledge Hub MCP integration tests
 * and the FIX-897 goal-check script (real HTTP surface, not `testFlow`).
 */

/** Minimal FlowState surface needed to POST through the mounted MCP adapter. */
export type McpHttpFlowState = {
  getRouter(): Promise<{
    POST(req: Request, ctx: { params: { path: string[] } }): Promise<Response>;
  }>;
};

const DEFAULT_MCP_PATH = ["mcp", "knowledge-hub"] as const;

/** Drive an authenticated `tools/call` and return the parsed handler JSON output. */
export async function callMcpTool(
  flowState: McpHttpFlowState,
  options: {
    name: string;
    args: Record<string, unknown>;
    /** Bearer secret (must match `KH_MCP_SECRET` for the loaded config). */
    secret: string;
    query?: string;
    mcpPath?: readonly string[];
  }
): Promise<Record<string, unknown>> {
  const { name, args, secret, query = "", mcpPath = DEFAULT_MCP_PATH } = options;
  const router = await flowState.getRouter();
  const pathSegments = [...mcpPath];
  const req = new Request(`http://localhost/${pathSegments.join("/")}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const res = await router.POST(req, { params: { path: pathSegments } });
  const body = (await res.json()) as { result?: { content?: { text?: string }[] }; error?: unknown };
  if (body.error !== undefined) throw new Error(`MCP error (${name}): ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result!.content![0]!.text!) as Record<string, unknown>;
}
