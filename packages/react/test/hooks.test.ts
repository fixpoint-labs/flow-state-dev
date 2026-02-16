import { defineFlow, handler } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setFlowContext,
  useAction,
  useFlowAgent,
  useRequestStream,
  useSession,
  useTypedFlowClient
} from "../src";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function requestEventFrame(options: {
  id: string;
  event: string;
  data: Record<string, unknown>;
}): string {
  return `id: ${options.id}\nevent: ${options.event}\ndata: ${JSON.stringify(options.data)}\n\n`;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
  setFlowContext({});
});

describe("useAction and useTypedFlowClient", () => {
  it("executes action requests and exposes loading state", async () => {
    setFlowContext({
      flowKind: "demo",
      userId: "devuser"
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        createJsonResponse({
          status: "completed",
          request: {
            id: "req_1",
            flowKind: "demo",
            actionName: "run",
            status: "completed"
          }
        })
      );

    const action = useAction({
      flowKind: "demo",
      action: "run",
      userId: "devuser"
    });

    expect(action.loading).toBe(false);
    const result = await action.execute({ value: "ok" }, "sess_1");

    expect(result.status).toBe("completed");
    expect(action.loading).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("builds typed flow client wrappers", async () => {
    setFlowContext({
      userId: "devuser"
    });

    const flow = defineFlow({
      kind: "demo",
      actions: {
        run: {
          inputSchema: z.object({
            value: z.string()
          }),
          block: handler<{ value: string }, { ok: boolean }>({
            name: "run-handler",
            execute: (input) => ({ ok: input.value.length > 0 })
          })
        }
      }
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).includes("/state")) {
          return createJsonResponse({
            sessionId: "sess_1",
            flowKind: "demo",
            state: {
              session: { count: 1 }
            },
            resources: [],
            projections: {}
          });
        }

        return createJsonResponse({
          status: "completed",
          request: {
            id: "req_1",
            flowKind: "demo",
            actionName: "run",
            status: "completed"
          }
        });
      });

    const client = useTypedFlowClient({
      flow
    });

    await client.actions.run({ value: "ok" });
    const state = await client.state.getSessionState("sess_1");

    expect(state).toEqual({ count: 1 });
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("useFlowAgent and useSession", () => {
  it("lists flows/sessions and creates sessions", async () => {
    setFlowContext({
      flowKind: "demo",
      userId: "devuser"
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createJsonResponse({
          flows: [
            {
              id: "demo",
              kind: "demo",
              requireSession: true,
              requireUser: true,
              actions: ["run"]
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessions: [
            {
              id: "sess_1",
              flowKind: "demo",
              userId: "devuser",
              createdAt: 1,
              updatedAt: 2
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            session: {
              id: "sess_2",
              flowKind: "demo",
              userId: "devuser",
              createdAt: 1,
              updatedAt: 2
            }
          },
          201
        )
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessions: [
            {
              id: "sess_1",
              flowKind: "demo",
              userId: "devuser",
              createdAt: 1,
              updatedAt: 2
            },
            {
              id: "sess_2",
              flowKind: "demo",
              userId: "devuser",
              createdAt: 1,
              updatedAt: 2
            }
          ]
        })
      );

    const flowAgent = useFlowAgent();

    await flowAgent.refreshFlows();
    await flowAgent.refreshSessions();
    await flowAgent.createSession({
      purpose: "test"
    });

    expect(flowAgent.flows).toHaveLength(1);
    expect(flowAgent.sessions).toHaveLength(2);
  });

  it("refreshes session snapshot after completed actions", async () => {
    setFlowContext({
      flowKind: "demo",
      userId: "devuser",
      sessionId: "sess_1"
    });

    vi.spyOn(globalThis, "fetch")
      // refresh: get session
      .mockResolvedValueOnce(
        createJsonResponse({
          session: {
            id: "sess_1",
            flowKind: "demo",
            userId: "devuser",
            createdAt: 1,
            updatedAt: 2
          }
        })
      )
      // refresh: get state
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "sess_1",
          flowKind: "demo",
          state: {
            session: {
              count: 1
            }
          },
          resources: [],
          projections: {}
        })
      )
      // send action
      .mockResolvedValueOnce(
        createJsonResponse({
          status: "completed",
          request: {
            id: "req_1",
            flowKind: "demo",
            actionName: "run",
            status: "completed"
          }
        })
      )
      // refresh after completion: get session
      .mockResolvedValueOnce(
        createJsonResponse({
          session: {
            id: "sess_1",
            flowKind: "demo",
            userId: "devuser",
            createdAt: 1,
            updatedAt: 3
          }
        })
      )
      // refresh after completion: get state
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "sess_1",
          flowKind: "demo",
          state: {
            session: {
              count: 2
            }
          },
          resources: [],
          projections: {}
        })
      );

    const session = useSession({});
    await session.refresh();
    const response = await session.sendAction("run", { value: "ok" });

    expect(response.status).toBe("completed");
    expect(session.snapshot?.state.session).toEqual({ count: 2 });
  });
});

describe("useRequestStream", () => {
  it("collects request items and terminal status from SSE events", async () => {
    setFlowContext({
      flowKind: "demo"
    });

    const statusItem: OutputItem = {
      id: "item_status_1",
      type: "fsd:status",
      message: "working",
      status: "in_progress",
      visibility: "internal",
      requestId: "req_1",
      itemIndex: 0,
      provenance: {
        blockName: "runtime",
        blockInstanceId: "runtime",
        phase: "main"
      },
      ts: 1
    };

    const streamBody = [
      requestEventFrame({
        id: "req_1:1",
        event: "item.added",
        data: {
          stream: "request",
          type: "item.added",
          requestId: "req_1",
          sequence_number: 1,
          ts: 1,
          item: statusItem
        }
      }),
      requestEventFrame({
        id: "req_1:2",
        event: "request.completed",
        data: {
          stream: "request",
          type: "request.completed",
          requestId: "req_1",
          sequence_number: 2,
          status: "completed",
          ts: 2
        }
      })
    ].join("");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(streamBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    );

    const requestStream = useRequestStream({
      flowKind: "demo",
      requestId: "req_1"
    });

    await flush();

    expect(requestStream.status).toBe("completed");
    expect(requestStream.items).toHaveLength(1);
    expect(requestStream.currentStatus?.message).toBe("working");
    expect(requestStream.isStreaming).toBe(false);

    requestStream.close();
  });
});
