// ---------------------------------------------------------------------------
// Flow-level MCP surface tests. Wires the MCP transport adapter into a real
// `createFlowApiRouter` and dispatches JSON-RPC requests against synthetic
// `Request` objects — the same pattern as `packages/mcp/test/end-to-end.test.ts`.
//
// `src/flow.ts` reads `process.env.KB_MCP_SECRET` at module-evaluation time to
// decide whether to construct the bearer-secret resolver; `test/setup.ts`
// sets a fixed value before any test file's imports evaluate, so the
// statically-imported `knowledgeFlow` below shares one consistent module
// instance of the resolver/error classes with the rest of this file. Only
// the no-secret test needs a fresh, dynamically re-imported module.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
} from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import knowledgeFlow from "../src/flow";

const AUTH = { Authorization: "Bearer test-secret" };

function buildRouter() {
  const registry = createFlowRegistry();
  registry.register(knowledgeFlow);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, adapters: [createMcpTransportAdapter()] });
  return { router, stores, registry };
}

function postMcp(
  router: ReturnType<typeof createFlowApiRouter>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new Request("http://localhost/api/flows/knowledge/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return router.POST(request, { params: { path: ["knowledge", "mcp"] } });
}

describe("knowledge flow — MCP surface", () => {
  it("importing the flow with no KB_MCP_SECRET does not throw", async () => {
    const original = process.env.KB_MCP_SECRET;
    delete process.env.KB_MCP_SECRET;
    vi.resetModules();
    try {
      await expect(import("../src/flow")).resolves.toBeDefined();
    } finally {
      process.env.KB_MCP_SECRET = original;
      vi.resetModules();
    }
  });

  it("tools/list exposes exactly the 8 CRUD/search tools — no import/export", async () => {
    const { router } = buildRouter();
    try {
      const res = await postMcp(router, { jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTH);
      const json = (await res.json()) as { result: { tools: Array<{ name: string; description: string }> } };
      const names = json.result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "create_concept",
        "delete_concept",
        "grep_concepts",
        "list_concepts",
        "read_concept",
        "relate_concepts",
        "search_concepts",
        "update_concept",
      ]);
      expect(json.result.tools.every((t) => t.description.length > 0)).toBe(true);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("rejects tools/call with no Authorization header (401)", async () => {
    const { router } = buildRouter();
    try {
      const res = await postMcp(router, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_concepts", arguments: {} },
      });
      expect(res.status).toBe(401);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("rejects tools/call with the wrong bearer secret (401)", async () => {
    const { router } = buildRouter();
    try {
      const res = await postMcp(
        router,
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_concepts", arguments: {} } },
        { Authorization: "Bearer wrong-secret" },
      );
      expect(res.status).toBe(401);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("create_concept -> read_concept round-trips through the router; search/grep see the write", async () => {
    const { router } = buildRouter();
    try {
      const create = await postMcp(
        router,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "create_concept",
            arguments: { id: "widgets/gizmo", type: "concept", title: "Gizmo", body: "A small gizmo." },
          },
        },
        AUTH,
      );
      expect(create.status).toBe(200);
      const createJson = (await create.json()) as { error?: unknown };
      expect(createJson.error).toBeUndefined();

      const read = await postMcp(
        router,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_concept", arguments: { id: "widgets/gizmo" } } },
        AUTH,
      );
      const readJson = (await read.json()) as { result: { content: Array<{ text: string }> } };
      expect(readJson.result.content[0]?.text).toContain("A small gizmo.");

      const search = await postMcp(
        router,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_concepts", arguments: { query: "gizmo" } } },
        AUTH,
      );
      const searchJson = (await search.json()) as { result: { content: Array<{ text: string }> } };
      expect(searchJson.result.content[0]?.text).toContain("widgets/gizmo");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("a search-result uri normalizes when pasted into update_concept / delete_concept", async () => {
    const { router } = buildRouter();
    try {
      await postMcp(
        router,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "create_concept", arguments: { id: "widgets/gizmo", type: "concept", body: "gizmo v1" } },
        },
        AUTH,
      );
      const search = await postMcp(
        router,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_concepts", arguments: { query: "gizmo" } } },
        AUTH,
      );
      const searchJson = (await search.json()) as { result: { content: Array<{ text: string }> } };
      const uriMatch = searchJson.result.content[0]?.text.match(/user\/concepts\/widgets\/gizmo/);
      expect(uriMatch).not.toBeNull();
      const uri = uriMatch![0];

      const update = await postMcp(
        router,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "update_concept", arguments: { id: uri, body: "gizmo v2" } } },
        AUTH,
      );
      expect(update.status).toBe(200);

      const read = await postMcp(
        router,
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_concept", arguments: { id: "widgets/gizmo" } } },
        AUTH,
      );
      const readJson = (await read.json()) as { result: { content: Array<{ text: string }> } };
      expect(readJson.result.content[0]?.text).toContain("gizmo v2");

      const del = await postMcp(
        router,
        { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "delete_concept", arguments: { id: uri } } },
        AUTH,
      );
      expect(del.status).toBe(200);
      const readAfterDelete = await postMcp(
        router,
        { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "read_concept", arguments: { id: "widgets/gizmo" } } },
        AUTH,
      );
      const readAfterDeleteJson = (await readAfterDelete.json()) as { result: { content: Array<{ text: string }> } };
      expect(readAfterDeleteJson.result.content[0]?.text).toContain("false");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("relate_concepts rejects a relation to a non-existent target over MCP", async () => {
    const { router } = buildRouter();
    try {
      await postMcp(
        router,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "create_concept", arguments: { id: "widgets/a", type: "concept", body: "a" } },
        },
        AUTH,
      );
      const relate = await postMcp(
        router,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "relate_concepts", arguments: { from: "widgets/a", to: "nope" } },
        },
        AUTH,
      );
      const relateJson = (await relate.json()) as { result?: { isError?: boolean } };
      expect(relateJson.result?.isError).toBe(true);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });
});
