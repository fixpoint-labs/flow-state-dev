import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  createClient,
  createTypedClient,
  type ClientFetch,
  type ExecuteActionResponse,
  type SessionStateSnapshotResponse
} from "../src";

const EXECUTE_RESPONSE: ExecuteActionResponse = {
  status: "completed",
  request: {
    id: "req_1",
    flowKind: "demo",
    actionName: "run",
    status: "completed"
  },
  session: {
    id: "sess_1"
  }
};

const SNAPSHOT_RESPONSE: SessionStateSnapshotResponse = {
  sessionId: "sess_1",
  flowKind: "demo",
  clientData: {}
};

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("createClient", () => {
  it("posts action execution requests with required userId", async () => {
    const fetcher = vi.fn<ClientFetch>(async (_url, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        input: { value: "ok" },
        userId: "devuser"
      });

      return createJsonResponse(EXECUTE_RESPONSE);
    });

    const client = createClient({
      flowKind: "demo",
      userId: "devuser",
      fetcher
    });

    const response = await client.sendAction("run", { value: "ok" });

    expect(response.request.actionName).toBe("run");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/flows/demo/actions/run");
  });

  it("uses session-scoped action route when sessionId is supplied", async () => {
    const fetcher = vi.fn<ClientFetch>(async () => createJsonResponse(EXECUTE_RESPONSE));
    const client = createClient({
      flowKind: "demo",
      userId: "devuser",
      fetcher
    });

    await client.sendAction("run", { value: "ok" }, { sessionId: "sess_1" });

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/flows/demo/sess_1/actions/run");
  });

  it("validates required client identity inputs", () => {
    expect(() =>
      createClient({
        flowKind: "",
        userId: "devuser",
        fetcher: vi.fn()
      })
    ).toThrow("flowKind");

    expect(() =>
      createClient({
        flowKind: "demo",
        userId: "",
        fetcher: vi.fn()
      })
    ).toThrow("userId");
  });
});

describe("createTypedClient", () => {
  it("creates typed action helpers and state snapshot helpers", async () => {
    const flow = defineFlow({
      kind: "demo",
      actions: {
        run: {
          inputSchema: z.object({
            value: z.string()
          }),
          block: handler<{ value: string }, { ok: boolean }>({
            name: "run-handler",
            execute: (input) => ({
              ok: input.value.length > 0
            })
          })
        }
      },
      session: {
        stateSchema: z.object({
          count: z.number()
        })
      },
      user: {
        stateSchema: z.object({
          name: z.string()
        })
      },
      org: {
        stateSchema: z.object({
          mode: z.string()
        })
      }
    });

    const fetcher = vi.fn<ClientFetch>(async (url, init) => {
      const asUrl = String(url);
      if (asUrl.includes("/state")) {
        return createJsonResponse(SNAPSHOT_RESPONSE);
      }

      if (asUrl.includes("/actions/")) {
        expect(init?.method).toBe("POST");
        return createJsonResponse(EXECUTE_RESPONSE);
      }

      return createJsonResponse({});
    });

    const client = createTypedClient({
      flow,
      userId: "devuser",
      fetcher
    });

    const actionResult = await client.actions.run({ value: "ok" }, {
      sessionId: "sess_1"
    });

    expect(actionResult.status).toBe("completed");

    const snapshot = await client.state.getSnapshot("sess_1");
    expect(snapshot.sessionId).toBe("sess_1");
    expect(snapshot.flowKind).toBe("demo");
  });

  it("creates typed action helpers with compile-time flow typing", async () => {
    const flow = defineFlow({
      kind: "demo",
      actions: {
        run: {
          inputSchema: z.object({
            value: z.string()
          }),
          block: handler<{ value: string }, { ok: boolean }>({
            name: "run-handler",
            execute: (input) => ({
              ok: input.value.length > 0
            })
          })
        }
      }
    });

    const fetcher = vi.fn<ClientFetch>(async () =>
      createJsonResponse(EXECUTE_RESPONSE)
    );

    const client = createTypedClient({
      flow,
      userId: "devuser",
      fetcher
    });

    await client.actions.run({ value: "ok" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
