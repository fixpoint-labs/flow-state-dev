/**
 * End-to-end proof that the session-control flow works as an MCP server —
 * the crux of the whole design (see docs/session-telemetry-mcp.md). Mirrors
 * packages/mcp/test/end-to-end.test.ts: mounts the real MCP transport
 * adapter via createFlowApiRouter and drives it with synthetic JSON-RPC
 * requests, no HTTP server stood up.
 */
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
} from "@flow-state-dev/server";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import { buildSessionControlFlow } from "../../src/session-control/flow";
import { noModelResolver } from "../../src/no-model-resolver";

function fakeLinear() {
  let state: string | null = null;
  const setCalls: string[] = [];
  const transport: LinearTransport = {
    async getIssueState() {
      return state;
    },
    async setIssueState(_issueId, stateName) {
      setCalls.push(stateName);
      state = stateName;
    },
    async comment() {},
  };
  return { client: new LinearStatusClient(transport), setCalls };
}

function buildRouter() {
  const { client: board, setCalls } = fakeLinear();
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(buildSessionControlFlow({ board }));
  const router = createFlowApiRouter({
    registry,
    stores,
    adapters: [createMcpTransportAdapter()],
    // session-control declares no generators — see ../../src/no-model-resolver.ts.
    runtimeConfig: { modelResolver: noModelResolver },
  });
  return { router, setCalls };
}

async function postMcp(router: ReturnType<typeof createFlowApiRouter>, body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/flows/session-control/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return router.POST(request, { params: { path: ["session-control", "mcp"] } });
}

describe("session-control flow — MCP transport", () => {
  it("tools/list surfaces both actions with descriptions", async () => {
    const { router } = buildRouter();
    try {
      const response = await postMcp(router, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const json = (await response.json()) as {
        result: { tools: Array<{ name: string; description?: string }> };
      };
      const names = json.result.tools.map((t) => t.name).sort();
      expect(names).toEqual(["register_session", "report_status"]);
      expect(
        json.result.tools.every((t) => typeof t.description === "string" && t.description.length > 0),
      ).toBe(true);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("tools/call round-trip: register_session then report_status moves the board", async () => {
    const { router, setCalls } = buildRouter();
    try {
      const registerResponse = await postMcp(router, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "register_session",
          arguments: { sessionId: "cloud-1", issue: "FIX-1", stage: "spec" },
        },
      });
      expect(registerResponse.status).toBe(200);
      const registerJson = (await registerResponse.json()) as {
        result: { content: Array<{ text: string }>; isError?: boolean };
      };
      expect(registerJson.result.isError).toBeFalsy();
      const { capabilityToken } = JSON.parse(registerJson.result.content[0]?.text ?? "{}") as {
        capabilityToken: string;
      };
      expect(capabilityToken.length).toBeGreaterThan(0);

      const reportResponse = await postMcp(router, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "report_status",
          arguments: { sessionId: "cloud-1", capabilityToken, status: "done" },
        },
      });
      expect(reportResponse.status).toBe(200);
      const reportJson = (await reportResponse.json()) as {
        result: { content: Array<{ text: string }>; isError?: boolean };
      };
      expect(reportJson.result.isError).toBeFalsy();
      expect(setCalls).toEqual(["In Spec Review"]);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("tools/call rejects a forged capability token as an MCP tool error", async () => {
    const { router, setCalls } = buildRouter();
    try {
      await postMcp(router, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "register_session",
          arguments: { sessionId: "cloud-2", issue: "FIX-2", stage: "spec" },
        },
      });

      const response = await postMcp(router, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "report_status",
          arguments: { sessionId: "cloud-2", capabilityToken: "forged", status: "done" },
        },
      });
      const json = (await response.json()) as {
        result: { content: Array<{ text: string }>; isError?: boolean };
      };
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0]?.text).toMatch(/Invalid capability token/);
      expect(setCalls).toHaveLength(0);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });
});
