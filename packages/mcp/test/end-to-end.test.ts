/**
 * End-to-end MCP roundtrip — wires the adapter into the real
 * `createFlowApiRouter`, dispatches a `tools/call` against a flow with
 * `mcp.enabled: true`, and asserts the action ran with `source: 'mcp'`
 * stamped onto the resulting `RequestRecord`.
 *
 * No HTTP server stood up — synthetic `Request` objects are dispatched
 * through the router's POST handler, mirroring the pattern in
 * `packages/engine/test/transports/host.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter
} from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "../src";

function buildRouter(adapter = createMcpTransportAdapter(), mcp?: { resolveSessionId?: (ctx: { input: Record<string, unknown> }) => string | undefined }) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(
    defineFlow({
      kind: "billing",
      requireUser: false,
      authentication: {
        requireUser: false,
        resolvePrincipal: () => ({ userId: "mcp-test" })
      },
      mcp: { enabled: true, ...mcp },
      actions: {
        recordPayment: {
          inputSchema: z.object({ amount: z.number(), sessionKey: z.string().optional() }),
          block: handler<{ amount: number }, { ok: true; amount: number }>({
            name: "record-payment",
            execute: (input) => ({ ok: true, amount: input.amount })
          }),
          description: "Record a payment for an invoice."
        }
      }
    })()
  );

  const router = createFlowApiRouter({
    registry,
    stores,
    adapters: [adapter]
  });

  return { router, stores, registry };
}

async function postMcp(
  router: ReturnType<typeof createFlowApiRouter>,
  kind: string,
  body: unknown
): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${kind}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return router.POST(request, { params: { path: [kind, "mcp"] } });
}

describe("MCP transport adapter — end-to-end", () => {
  it("tools/list reaches the MCP route through createFlowApiRouter", async () => {
    const { router } = buildRouter();
    try {
      const response = await postMcp(router, "billing", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      });
      const json = (await response.json()) as { result: { tools: Array<{ name: string }> } };
      expect(json.result.tools.map((t) => t.name)).toEqual(["record_payment"]);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("tools/call runs the action and stamps RequestRecord.source='mcp'", async () => {
    const { router, stores } = buildRouter();
    try {
      const response = await postMcp(router, "billing", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "record_payment", arguments: { amount: 4200 } }
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { result: { content: Array<{ text: string }> } };
      const text = json.result.content[0]?.text ?? "";
      expect(text).toContain("4200");

      // RequestRecord should carry source='mcp'.
      const records = await stores.request.list({ limit: 10 });
      expect(records.length).toBe(1);
      expect(records[0]?.source).toBe("mcp");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("resolveSessionId groups consecutive tools/call under one sessionId", async () => {
    const sessionKey = "sess_group_1";
    const { router, stores } = buildRouter(createMcpTransportAdapter(), {
      resolveSessionId: ({ input }) =>
        typeof input.sessionKey === "string" ? input.sessionKey : undefined
    });
    try {
      for (const id of [10, 11]) {
        const response = await postMcp(router, "billing", {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "record_payment",
            arguments: { amount: id, sessionKey }
          }
        });
        expect(response.status).toBe(200);
      }

      const records = await stores.request.list({ limit: 10 });
      expect(records.length).toBe(2);
      expect(records[0]?.sessionId).toBe(sessionKey);
      expect(records[1]?.sessionId).toBe(sessionKey);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("MCP route shadows the HTTP catch-all at /api/flows/:kind/mcp", async () => {
    const { router } = buildRouter();
    try {
      // POSTing to the MCP path should be handled by the MCP adapter
      // (returning a JSON-RPC response), not the HTTP action route.
      const response = await postMcp(router, "billing", {
        jsonrpc: "2.0",
        id: 3,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" }
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { jsonrpc: string; result: { serverInfo: { name: string } } };
      expect(json.jsonrpc).toBe("2.0");
      expect(json.result.serverInfo.name).toBe("billing");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("GET /api/flows/:kind/mcp returns 405", async () => {
    const { router } = buildRouter();
    try {
      const request = new Request("http://localhost/api/flows/billing/mcp", { method: "GET" });
      const response = await router.GET(request, { params: { path: ["billing", "mcp"] } });
      expect(response.status).toBe(405);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("POST /mcp/:kind reaches MCP when the adapter uses a dedicated base path", async () => {
    const { router } = buildRouter(
      createMcpTransportAdapter({ dedicatedBasePath: true })
    );
    try {
      const request = new Request("http://localhost/mcp/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" }
        })
      });
      const response = await router.POST(request, {
        params: { path: ["mcp", "billing"] }
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        result: { serverInfo: { name: string } };
      };
      expect(json.result.serverInfo.name).toBe("billing");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it.each(["GET", "DELETE"] as const)(
    "%s /mcp/:kind returns 405 when the adapter uses a dedicated base path",
    async (method) => {
      const { router } = buildRouter(
        createMcpTransportAdapter({ dedicatedBasePath: true })
      );
      try {
        const request = new Request("http://localhost/mcp/billing", { method });
        const context = { params: { path: ["mcp", "billing"] } };
        const response =
          method === "GET"
            ? await router.GET(request, context)
            : await router.DELETE(request, context);

        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
      } finally {
        await disposeFlowApiRouter(router);
      }
    }
  );
});
