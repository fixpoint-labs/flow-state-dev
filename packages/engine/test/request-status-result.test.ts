/**
 * `GET /requests/:requestId/status?include_result_output=true` reads one
 * request's stored action result by its id (FIX-2455 D1).
 *
 * The status route already loads the one record and checks the caller
 * reaches it, so a caller holding a request id reads what the action
 * answered without listing the session's requests and searching for its own.
 * The result is the session list's projection: `hasOutput` always, the output
 * when asked. Without the flag the snapshot carries no result, so a status
 * poll stays small.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowState, createInProcessFetch, inMemoryStores } from "../src";
import { createInMemoryStores } from "../src/host";
import { createFlowRegistry } from "../src/registry/flow-registry";
import { handleGetRequestStatus } from "../src/routes/request-status-routes";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

const computeFlow = defineFlow({
  kind: "compute",
  actions: {
    square: {
      inputSchema: z.object({ n: z.number() }),
      block: handler({
        name: "compute-square",
        inputSchema: z.object({ n: z.number() }),
        execute: (input: { n: number }) => ({ squared: input.n * input.n })
      })
    }
  }
})();

describe("status route: the stored result, by request id", () => {
  it("returns what a real action computed when asked, and no result when not", async () => {
    const state = createFlowState({
      flows: { compute: computeFlow },
      stores: { default: { primary: inMemoryStores() } }
    });
    const fetcher = createInProcessFetch(state);
    try {
      const sent = await fetcher("http://x.invalid/api/flows/compute/actions/square", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1", input: { n: 7 } })
      });
      expect(sent.status).toBeLessThan(300);
      const body = (await sent.json()) as { request?: { id: string }; requestId?: string };
      const requestId = body.request?.id ?? body.requestId;

      const read = async (query: string) => {
        const response = await fetcher(`http://x.invalid/api/flows/compute/requests/${requestId}/status${query}`);
        expect(response.status).toBe(200);
        return (await response.json()) as Record<string, unknown>;
      };
      let settled = await read("?include_result_output=true");
      for (let i = 0; i < 100 && settled.status !== "completed"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        settled = await read("?include_result_output=true");
      }

      expect(settled.status).toBe("completed");
      expect(settled.result).toEqual({ output: { squared: 49 }, hasOutput: true });
      // The plain snapshot is unchanged: no result, so a status poll stays small.
      expect(await read("")).not.toHaveProperty("result");
    } finally {
      await state.dispose();
    }
  });
});

describe("status route: every ending, as the record stored it", () => {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "chat", actions: {} })());
  const failure = { code: "execution_error", message: "the action threw" };

  function record(id: string, status: RequestRecord["status"], result?: RequestRecord["result"]): RequestRecord {
    return {
      id,
      orgId: DEFAULT_ORG_ID,
      flowKind: "chat",
      actionName: "run",
      userId: "u",
      source: "http",
      status,
      startedAtMs: 1,
      state: {},
      version: 0,
      createdAt: 1,
      updatedAt: 1,
      ...(result !== undefined ? { result } : {})
    };
  }

  async function seeded(): Promise<StoreRegistry> {
    const stores = createInMemoryStores();
    await stores.request.set("req_failed", record("req_failed", "failed", { error: failure }), "absent");
    await stores.request.set("req_lossy", record("req_lossy", "completed", { outputNotRecorded: true }), "absent");
    await stores.request.set("req_nothing", record("req_nothing", "completed", {}), "absent");
    await stores.request.set("req_suspended", record("req_suspended", "suspended"), "absent");
    return stores;
  }

  async function read(stores: StoreRegistry, requestId: string, query = "?include_result_output=true") {
    const response = await handleGetRequestStatus(
      new Request(`http://test/api/flows/chat/requests/${requestId}/status${query}`),
      { kind: "request_status", flowKind: "chat", requestId },
      { registry, stores }
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  it("carries a failure's error", async () => {
    const stores = await seeded();
    expect((await read(stores, "req_failed")).result).toEqual({ error: failure, hasOutput: false });
  });

  it("keeps an output it could not record distinct from an action that returned nothing", async () => {
    const stores = await seeded();
    expect((await read(stores, "req_lossy")).result).toEqual({ outputNotRecorded: true, hasOutput: false });
    expect((await read(stores, "req_nothing")).result).toEqual({ hasOutput: false });
  });

  it("carries no result for a request that stopped without one", async () => {
    const stores = await seeded();
    const snapshot = await read(stores, "req_suspended");
    expect(snapshot.status).toBe("suspended");
    expect(snapshot).not.toHaveProperty("result");
  });
});
