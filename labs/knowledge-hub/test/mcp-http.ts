/** Minimal surface for driving the mounted MCP router in tests and goal scripts. */
export type McpFlowState = {
  getRouter(): Promise<{
    POST(
      req: Request,
      ctx: { params: { path: string[] } }
    ): Promise<Response>;
  }>;
};

const DEFAULT_BEARER = "test-secret";

/**
 * Authenticated `tools/call` over the Knowledge Hub MCP endpoint; returns parsed
 * handler JSON from the tool result text block.
 */
export async function callMcpTool(
  flowState: McpFlowState,
  name: string,
  args: Record<string, unknown>,
  options: { query?: string; bearerToken?: string } = {}
): Promise<Record<string, unknown>> {
  const { query = "", bearerToken = DEFAULT_BEARER } = options;
  const router = await flowState.getRouter();
  const req = new Request(`http://localhost/mcp/knowledge-hub${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const res = await router.POST(req, { params: { path: ["mcp", "knowledge-hub"] } });
  const body = (await res.json()) as { result?: { content?: { text?: string }[] }; error?: unknown };
  if (body.error !== undefined) throw new Error(`MCP error (${name}): ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result!.content![0]!.text!) as Record<string, unknown>;
}
