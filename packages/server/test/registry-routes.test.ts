import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  parseFlowRoute
} from "../src";

function makeFlow(kind: string, id = kind): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({
          value: z.string()
        }),
        block: handler<{ value: string }, { ok: boolean; value: string }>({
          name: `${kind}-run`,
          execute: (input) => ({
            ok: true,
            value: input.value
          })
        })
      }
    }
  })({
    id
  });
}

function makeClientDataFlow(kind: string, id = kind): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({
          value: z.string()
        }),
        block: handler<{ value: string }, { ok: boolean }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    },
    session: {
      clientData: {
        sessionInfo: () => ({ ready: true })
      }
    },
    user: {
      clientData: {
        userInfo: () => ({ active: true })
      }
    },
    project: {
      clientData: {
        projectInfo: () => ({ configured: true })
      }
    }
  })({
    id
  });
}

function makeSlowFlow(kind: string, id = kind): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({
          value: z.string()
        }),
        block: handler<{ value: string }, { ok: boolean }>({
          name: `${kind}-run-slow`,
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { ok: true };
          }
        })
      }
    }
  })({
    id
  });
}

describe("flow registry", () => {
  it("registers, resolves, and lists flows", () => {
    const registry = createFlowRegistry();
    const primary = makeFlow("chat", "default");
    const secondary = makeFlow("chat", "alt");

    registry.register(primary);
    registry.register(secondary);

    expect(registry.get("chat", "default")?.id).toBe("default");
    expect(registry.get("chat", "alt")?.id).toBe("alt");
    expect(registry.get("chat")?.id).toBe("default");
    expect(registry.list().map((flow) => flow.id)).toEqual([
      "alt",
      "default"
    ]);
  });

  it("rejects duplicate (kind,id) registrations", () => {
    const registry = createFlowRegistry();
    const flow = makeFlow("dup", "dup");

    registry.register(flow);
    expect(() => registry.register(flow)).toThrow("already registered");
  });
});

describe("parseFlowRoute", () => {
  it("maps canonical route shapes", () => {
    expect(parseFlowRoute("GET", [])).toEqual({
      kind: "list_flows"
    });
    expect(parseFlowRoute("GET", ["capabilities"])).toEqual({
      kind: "capabilities"
    });
    expect(parseFlowRoute("POST", ["demo", "actions", "run"])).toEqual({
      kind: "execute_action",
      flowKind: "demo",
      actionName: "run"
    });
    expect(parseFlowRoute("POST", ["demo", "sess_1", "actions", "run"])).toEqual(
      {
        kind: "execute_action",
        flowKind: "demo",
        sessionId: "sess_1",
        actionName: "run"
      }
    );
    expect(parseFlowRoute("GET", ["demo", "requests", "req_1", "stream"])).toEqual(
      {
        kind: "request_stream",
        flowKind: "demo",
        requestId: "req_1"
      }
    );
    expect(parseFlowRoute("GET", ["sessions", "sess_1", "state"])).toEqual({
      kind: "get_session_state",
      sessionId: "sess_1"
    });
    expect(parseFlowRoute("DELETE", ["sessions", "sess_1"])).toEqual({
      kind: "delete_session",
      sessionId: "sess_1"
    });
    expect(parseFlowRoute("PATCH", ["x"])).toEqual({
      kind: "not_found"
    });
  });
});

describe("createFlowApiRouter", () => {
  it("serves canonical list/capability/session/action/stream endpoints", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const flow = makeFlow("demo");
    registry.register(flow);
    const router = createFlowApiRouter({
      registry,
      stores
    });

    const listResponse = await router.GET(
      new Request("http://localhost/api/flows"),
      { params: { path: [] } }
    );
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()) as { flows: Array<{ kind: string }> }).toEqual({
      flows: [
        {
          id: "demo",
          kind: "demo",
          requireUser: true,
          actions: ["run"],
          actionSchemas: {
            run: {
              type: "object",
              fields: {
                value: { type: "string", required: true }
              }
            }
          }
        }
      ]
    });

    const capabilitiesResponse = await router.GET(
      new Request("http://localhost/api/flows/capabilities"),
      { params: { path: ["capabilities"] } }
    );
    expect(capabilitiesResponse.status).toBe(200);
    expect((await capabilitiesResponse.json()) as { userStream: boolean }).toEqual({
      userStream: false
    });

    const missingUserResponse = await router.POST(
      new Request("http://localhost/api/flows/demo/actions/run", {
        method: "POST",
        body: JSON.stringify({
          input: { value: "x" }
        })
      }),
      { params: { path: ["demo", "actions", "run"] } }
    );
    expect(missingUserResponse.status).toBe(400);

    const executeResponse = await router.POST(
      new Request("http://localhost/api/flows/demo/sess_1/actions/run", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_1",
          input: { value: "ok" }
        })
      }),
      { params: { path: ["demo", "sess_1", "actions", "run"] } }
    );

    expect(executeResponse.status).toBe(202);
    const executionPayload = (await executeResponse.json()) as {
      request: { id: string; status: string };
      session?: { id: string };
      status: string;
    };
    // 202 returns in_progress immediately — execution runs async
    expect(executionPayload.status).toBe("in_progress");
    expect(executionPayload.request.status).toBe("in_progress");
    expect(executionPayload.session?.id).toBe("sess_1");

    // Allow async execution to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const streamResponse = await router.GET(
      new Request(
        `http://localhost/api/flows/demo/requests/${executionPayload.request.id}/stream?starting_after=0`
      ),
      {
        params: {
          path: ["demo", "requests", executionPayload.request.id, "stream"]
        }
      }
    );
    expect(streamResponse.status).toBe(200);
    const streamBody = await streamResponse.text();
    expect(streamBody).toContain("event: request.created");
    expect(streamBody).toContain("event: request.completed");

    const sessionStateResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_1/state"),
      {
        params: {
          path: ["sessions", "sess_1", "state"]
        }
      }
    );
    expect(sessionStateResponse.status).toBe(200);
    expect(
      (await sessionStateResponse.json()) as { flowKind: string; sessionId: string }
    ).toMatchObject({
      flowKind: "demo",
      sessionId: "sess_1"
    });

    const sessionRequestsResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_1/requests"),
      {
        params: {
          path: ["sessions", "sess_1", "requests"]
        }
      }
    );
    expect(sessionRequestsResponse.status).toBe(200);
    expect(
      ((await sessionRequestsResponse.json()) as { requests: Array<{ id: string }> })
        .requests.length
    ).toBe(1);

    const createSessionResponse = await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_2"
        })
      }),
      {
        params: {
          path: ["demo", "sessions"]
        }
      }
    );
    expect(createSessionResponse.status).toBe(201);

    const userStreamResponse = await router.GET(
      new Request("http://localhost/api/flows/users/user_1/stream"),
      {
        params: {
          path: ["users", "user_1", "stream"]
        }
      }
    );
    expect(userStreamResponse.status).toBe(501);

    const deleteSessionResponse = await router.DELETE(
      new Request("http://localhost/api/flows/sessions/sess_1", {
        method: "DELETE"
      }),
      {
        params: {
          path: ["sessions", "sess_1"]
        }
      }
    );
    expect(deleteSessionResponse.status).toBe(204);

    const deletedSessionResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_1"),
      {
        params: {
          path: ["sessions", "sess_1"]
        }
      }
    );
    expect(deletedSessionResponse.status).toBe(404);
  });

  it("calls onError when handler execution throws", async () => {
    const onError = vi.fn();
    const registry = createFlowRegistry();
    registry.register(makeFlow("error-flow"));

    const router = createFlowApiRouter({
      registry,
      stores: createInMemoryStores(),
      onError
    });

    const response = await router.POST(
      new Request("http://localhost/api/flows/error-flow/actions/run", {
        method: "POST",
        body: "{invalid-json"
      }),
      {
        params: {
          path: ["error-flow", "actions", "run"]
        }
      }
    );

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("returns scope-grouped clientData and supports clientData filters", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const flow = makeClientDataFlow("projected");
    registry.register(flow);
    const router = createFlowApiRouter({
      registry,
      stores
    });

    const executeResponse = await router.POST(
      new Request("http://localhost/api/flows/projected/sess_proj/actions/run", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_proj",
          projectId: "proj_1",
          input: { value: "ok" }
        })
      }),
      { params: { path: ["projected", "sess_proj", "actions", "run"] } }
    );
    expect(executeResponse.status).toBe(202);

    // Allow async execution to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stateResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_proj/state"),
      {
        params: {
          path: ["sessions", "sess_proj", "state"]
        }
      }
    );
    expect(stateResponse.status).toBe(200);
    expect((await stateResponse.json()) as { clientData: Record<string, unknown> }).toMatchObject({
      clientData: {
        session: {
          sessionInfo: {
            ready: true
          }
        },
        user: {
          userInfo: {
            active: true
          }
        },
        project: {
          projectInfo: {
            configured: true
          }
        }
      }
    });

    const filteredResponse = await router.GET(
      new Request(
        "http://localhost/api/flows/sessions/sess_proj/state?clientData=session.sessionInfo,user.userInfo"
      ),
      {
        params: {
          path: ["sessions", "sess_proj", "state"]
        }
      }
    );
    expect(filteredResponse.status).toBe(200);
    expect((await filteredResponse.json()) as { clientData: Record<string, unknown> }).toMatchObject({
      clientData: {
        session: {
          sessionInfo: {
            ready: true
          }
        },
        user: {
          userInfo: {
            active: true
          }
        }
      }
    });
  });

  it("paginates session items with metadata", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(makeFlow("pagination"));
    const router = createFlowApiRouter({
      registry,
      stores
    });

    await router.POST(
      new Request("http://localhost/api/flows/pagination/sess_page/actions/run", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_page",
          input: { value: "ok" }
        })
      }),
      { params: { path: ["pagination", "sess_page", "actions", "run"] } }
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stateResponse = await router.GET(
      new Request(
        "http://localhost/api/flows/sessions/sess_page/state?include_items=true&offset=0&limit=1"
      ),
      {
        params: {
          path: ["sessions", "sess_page", "state"]
        }
      }
    );

    expect(stateResponse.status).toBe(200);
    const payload = (await stateResponse.json()) as {
      items?: unknown[];
      pagination?: {
        offset: number;
        limit: number;
        total: number;
        hasMore: boolean;
        nextOffset: number;
      };
    };
    expect(payload.items?.length).toBe(1);
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 1,
      total: 1,
      hasMore: false,
      nextOffset: 1
    });
  });

  it("returns 503 when active stream capacity is reached", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(makeSlowFlow("capacity"));
    const router = createFlowApiRouter({
      registry,
      stores,
      maxConcurrentStreams: 1
    });

    const first = await router.POST(
      new Request("http://localhost/api/flows/capacity/sess_cap_1/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: "user_cap", input: { value: "ok1" } })
      }),
      { params: { path: ["capacity", "sess_cap_1", "actions", "run"] } }
    );
    expect(first.status).toBe(202);

    const second = await router.POST(
      new Request("http://localhost/api/flows/capacity/sess_cap_2/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: "user_cap", input: { value: "ok2" } })
      }),
      { params: { path: ["capacity", "sess_cap_2", "actions", "run"] } }
    );

    expect(second.status).toBe(503);
  });
});
