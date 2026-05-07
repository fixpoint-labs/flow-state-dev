import { defineFlow, handler, defineResource } from "@flow-state-dev/core";
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
    org: {
      clientData: {
        orgInfo: () => ({ configured: true })
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
          requiresOrg: false,
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
          orgId: "proj_1",
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
        org: {
          orgInfo: {
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

  it("loads isolated user and org scopes in the session state route", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "isolated-state-route",
      isolateUserState: true,
      isolateOrgState: true,
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "isolated-state-route-run",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: async (input, ctx) => {
              await ctx.user.patchState({ nickname: input.value });
              await ctx.org?.patchState({ title: `Project ${input.value}` });
              return { ok: true };
            }
          })
        }
      },
      user: {
        stateSchema: z.object({ nickname: z.string().optional() }),
        clientData: {
          userLabel: (ctx) => ({ nickname: ctx.state.nickname })
        }
      },
      org: {
        stateSchema: z.object({ title: z.string().optional() }),
        clientData: {
          orgLabel: (ctx) => ({ title: ctx.state.title })
        }
      }
    })({ id: "isolated-state-route" });

    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores });

    const executeResponse = await router.POST(
      new Request("http://localhost/api/flows/isolated-state-route/sess_iso_state/actions/run", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_iso_state",
          orgId: "proj_iso_state",
          input: { value: "Ada" }
        })
      }),
      {
        params: {
          path: ["isolated-state-route", "sess_iso_state", "actions", "run"]
        }
      }
    );
    expect(executeResponse.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stateResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_iso_state/state?include=internal_state"),
      { params: { path: ["sessions", "sess_iso_state", "state"] } }
    );

    expect(stateResponse.status).toBe(200);
    const body = (await stateResponse.json()) as {
      state?: unknown;
      internalState?: {
        user?: Record<string, unknown>;
        org?: Record<string, unknown>;
      };
      clientData: Record<string, Record<string, unknown>>;
    };
    expect(body.state).toBeUndefined();
    expect(body.internalState?.user).toMatchObject({ nickname: "Ada" });
    expect(body.internalState?.org).toMatchObject({ title: "Project Ada" });
    expect(body.clientData).toMatchObject({
      user: { userLabel: { nickname: "Ada" } },
      org: { orgLabel: { title: "Project Ada" } }
    });

    const defaultStateResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_iso_state/state"),
      { params: { path: ["sessions", "sess_iso_state", "state"] } }
    );
    const defaultBody = (await defaultStateResponse.json()) as Record<string, unknown>;
    expect(defaultBody.state).toBeUndefined();
    expect(defaultBody.internalState).toBeUndefined();
    expect(await stores.user.get("user_iso_state")).toBeUndefined();
    expect(await stores.org.get("proj_iso_state")).toBeUndefined();

    const request = (await stores.request.list({ sessionId: "sess_iso_state", limit: 1 }))[0];
    expect(request?.orgId).toBe("proj_iso_state");
  });

  it("loads isolated user resources in resource content routes", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const profile = defineResource({
      scope: "user",
      stateSchema: z.object({ label: z.string().default("") }),
      writable: true,
      client: {
        content: { read: true }
      }
    });
    const flow = defineFlow({
      kind: "isolated-resource-route",
      isolateUserState: true,
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "isolated-resource-route-run",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: async (input, ctx) => {
              await ctx.resources.profile.patchState({ label: input.value });
              await ctx.resources.profile.writeContent(`Profile ${input.value}`);
              return { ok: true };
            }
          })
        }
      },
      resources: {
        profile
      }
    })({ id: "isolated-resource-route" });

    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores });

    const executeResponse = await router.POST(
      new Request("http://localhost/api/flows/isolated-resource-route/sess_iso_resource/actions/run", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_iso_resource",
          input: { value: "Ada" }
        })
      }),
      {
        params: {
          path: ["isolated-resource-route", "sess_iso_resource", "actions", "run"]
        }
      }
    );
    expect(executeResponse.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const contentResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_iso_resource/resources/profile/content"),
      {
        params: {
          path: ["sessions", "sess_iso_resource", "resources", "profile", "content"]
        }
      }
    );

    expect(contentResponse.status).toBe(200);
    expect(await contentResponse.json()).toEqual({
      ref: "profile",
      content: "Profile Ada"
    });
    expect(await stores.user.get("user_iso_resource")).toBeUndefined();
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
        // FIX-391: `item_types=block_trace` opts into this trace item type,
        // which the snapshot route otherwise strips by default. The fixture's
        // handler emits only a block_trace, so we include it explicitly here
        // to keep this pagination assertion intact.
        "http://localhost/api/flows/sessions/sess_page/state?include_items=true&offset=0&limit=1&item_types=block_trace"
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

  it("computes clientData from mutated session state", async () => {
    const flow = defineFlow({
      kind: "stateful-cd",
      actions: {
        increment: {
          inputSchema: z.object({ amount: z.number() }),
          block: handler({
            name: "incrementer",
            inputSchema: z.object({ amount: z.number() }),
            outputSchema: z.object({ ok: z.boolean() }),
            sessionStateSchema: z.object({
              count: z.number().default(0)
            }),
            execute: async (input, ctx) => {
              const current = ctx.session.state.count ?? 0;
              await ctx.session.patchState({ count: current + input.amount });
              return { ok: true };
            }
          })
        }
      },
      session: {
        stateSchema: z.object({ count: z.number().default(0) }),
        clientData: {
          summary: (ctx) => ({
            totalCount: (ctx.state as { count?: number }).count ?? 0,
            label: `Count is ${(ctx.state as { count?: number }).count ?? 0}`
          })
        }
      }
    })();

    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores });

    await router.POST(
      new Request("http://localhost/api/flows/stateful-cd/sess_cd/actions/increment", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_cd",
          input: { amount: 5 }
        })
      }),
      { params: { path: ["stateful-cd", "sess_cd", "actions", "increment"] } }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const stateResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_cd/state"),
      { params: { path: ["sessions", "sess_cd", "state"] } }
    );

    expect(stateResponse.status).toBe(200);
    const stateBody = (await stateResponse.json()) as {
      clientData: Record<string, Record<string, unknown>>;
    };

    expect(stateBody.clientData).toBeDefined();
    expect(stateBody.clientData.session).toBeDefined();
    expect(stateBody.clientData.session!.summary).toEqual({
      totalCount: 5,
      label: "Count is 5"
    });
  });

  it("computes client.expose and client.derived from session state", async () => {
    const flow = defineFlow({
      kind: "stateful-client",
      actions: {
        increment: {
          inputSchema: z.object({ amount: z.number() }),
          block: handler({
            name: "stateful-client-incr",
            inputSchema: z.object({ amount: z.number() }),
            outputSchema: z.object({ ok: z.boolean() }),
            sessionStateSchema: z.object({ count: z.number().default(0) }),
            execute: async (input, ctx) => {
              const current = ctx.session.state.count ?? 0;
              await ctx.session.patchState({ count: current + input.amount });
              return { ok: true };
            }
          })
        }
      },
      session: {
        stateSchema: z.object({ count: z.number().default(0) }),
        client: {
          expose: ["count"],
          derived: {
            label: (ctx) => `Count is ${(ctx.state as { count?: number }).count ?? 0}`
          }
        }
      }
    })();

    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores });

    await router.POST(
      new Request("http://localhost/api/flows/stateful-client/sess_sc/actions/increment", {
        method: "POST",
        body: JSON.stringify({ userId: "user_sc", input: { amount: 7 } })
      }),
      { params: { path: ["stateful-client", "sess_sc", "actions", "increment"] } }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stateResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_sc/state"),
      { params: { path: ["sessions", "sess_sc", "state"] } }
    );
    expect(stateResponse.status).toBe(200);
    const body = (await stateResponse.json()) as {
      state?: unknown;
      internalState?: unknown;
      clientData: Record<string, Record<string, unknown>>;
    };
    expect(body.state).toBeUndefined();
    expect(body.internalState).toBeUndefined();
    expect(body.clientData.session).toEqual({
      count: 7,
      label: "Count is 7"
    });
  });

  it("returns resource clientData in session state response", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const counterResource = defineResource({
      scope: "session",
      stateSchema: z.object({ count: z.number().default(0) }),
      client: {
        content: { read: true },
        data: (state) => ({ count: state.count }),
      },
    });

    const flow = defineFlow({
      kind: "res-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "res-run",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.object({ ok: z.boolean() }),
            sessionStateSchema: z.object({}),
            execute: async () => {
              return { ok: true };
            }
          })
        }
      },
      resources: {
        counter: counterResource
      }
    })({ id: "res-flow" });

    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores });

    await router.POST(
      new Request("http://localhost/api/flows/res-flow/sess_res/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: "user_res", input: { value: "ok" } })
      }),
      { params: { path: ["res-flow", "sess_res", "actions", "run"] } }
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stateResponse = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess_res/state"),
      { params: { path: ["sessions", "sess_res", "state"] } }
    );
    expect(stateResponse.status).toBe(200);
    const body = (await stateResponse.json()) as {
      resources?: {
        session?: Record<string, unknown>;
        user?: Record<string, unknown>;
        org?: Record<string, unknown>;
      };
    };
    expect(body.resources).toBeDefined();
    expect(body.resources!.session).toBeDefined();
    expect(body.resources!.session!.counter).toEqual({ clientData: { count: 0 } });
  });

  // FIX-569: the active-streams capacity mechanism is gone — live tail is
  // owned by the store interface and the per-process registry no longer
  // exists. The `maxConcurrentStreams` knob is preserved for source-compat
  // but has no behavioral effect. The 503-at-capacity test was removed
  // along with the registry.
});
