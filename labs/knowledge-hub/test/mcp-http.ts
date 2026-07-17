/**
 * Shared JSON-RPC `tools/call` helper for real MCP HTTP probes in this lab.
 * Used by vitest (`config.spec.ts`) and the FIX-897 goal-check script so the
 * envelope and result parsing stay in one place.
 */
export type McpFlowState = {
  getRouter(): Promise<{
    POST(req: Request, ctx: { params: { path: string[] } }): Promise<Response>;
  }>;
};

/** Drive an authenticated `tools/call` and return the parsed handler output. */
export async function callMcpTool(
  flowState: McpFlowState,
  name: string,
  args: Record<string, unknown>,
  options?: { query?: string; secret?: string }
): Promise<Record<string, unknown>> {
  const secret = options?.secret ?? "test-secret";
  const query = options?.query ?? "";
  const router = await flowState.getRouter();
  const req = new Request(`http://localhost/mcp/knowledge-hub${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const res = await router.POST(req, { params: { path: ["mcp", "knowledge-hub"] } });
  const body = (await res.json()) as { result?: { content?: { text?: string }[] }; error?: unknown };
  if (body.error !== undefined) throw new Error(`MCP error (${name}): ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result!.content![0]!.text!) as Record<string, unknown>;
}
