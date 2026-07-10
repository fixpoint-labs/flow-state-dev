// ---------------------------------------------------------------------------
// fsdev.config.ts fail-closed adapter wiring (FIX-882, sequence step 4).
//
// Modeled on examples/knowledge-base/test/config.spec.ts: each case sets env,
// resets the module registry, and dynamically imports the config fresh so the
// adapter decision (`process.env.KH_MCP_SECRET ? [mcp] : []`) is re-evaluated.
// `createFlowState` is lazy, so importing never opens a store. We then build the
// router and probe the MCP endpoint — a custom adapter route gets first crack at
// dispatch, so an unmounted MCP endpoint falls through to the catch-all's 404,
// while a mounted one is handled by the adapter (non-404). No inbox write occurs.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.KH_MCP_SECRET;

function setSecret(value: string | undefined): void {
  if (value === undefined) delete process.env.KH_MCP_SECRET;
  else process.env.KH_MCP_SECRET = value;
}

async function loadConfig() {
  vi.resetModules();
  return (await import("../fsdev.config")).default;
}

/** POST an MCP request and return the HTTP status. 404 ⇒ the MCP route is not
 *  mounted (no adapter); anything else ⇒ the adapter handled it. */
async function mcpStatus(flowState: Awaited<ReturnType<typeof loadConfig>>): Promise<number> {
  const router = await flowState.getRouter();
  const req = new Request("http://localhost/api/flows/knowledge-hub/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const res = await router.POST(req, { params: { path: ["knowledge-hub", "mcp"] } });
  return res.status;
}

describe("fsdev.config fail-closed MCP adapter", () => {
  afterEach(async () => {
    setSecret(original);
    vi.resetModules();
  });

  it("without KH_MCP_SECRET: imports without throwing and mounts no MCP adapter", async () => {
    setSecret(undefined);
    const flowState = await loadConfig();
    expect(flowState).toBeDefined();
    expect(await mcpStatus(flowState)).toBe(404);
    await flowState.dispose();
  });

  it("with KH_MCP_SECRET: the MCP adapter is mounted (endpoint no longer 404s)", async () => {
    setSecret("test-secret");
    const flowState = await loadConfig();
    expect(await mcpStatus(flowState)).not.toBe(404);
    await flowState.dispose();
  });
});
