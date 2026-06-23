import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createMockTransportHost,
  createInboundTransportConformanceTests
} from "@flow-state-dev/testing/conformance";
import {
  PrincipalResolutionError,
  type ActiveRequestRegistry
} from "@flow-state-dev/server";
import {
  createScheduledTransportAdapter,
  SCHEDULED_TRANSPORT_SOURCE
} from "../src";

const noopBlock = handler({
  name: "noop",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => ({ ok: true })
});

function buildFlow(overrides: Parameters<typeof defineFlow>[0] | undefined = undefined) {
  return defineFlow(
    overrides ?? {
      kind: "billing",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string().optional() }),
          block: noopBlock,
          description: "Run the billing action"
        }
      },
      schedules: {
        static: {
          "monthly-invoices": {
            cron: "0 0 1 * *",
            block: noopBlock
          }
        }
      }
    }
  );
}

/** Read the namespaced `metadata.schedule` slot off a recorded envelope. */
function schedMeta(
  envelope: { metadata?: unknown } | undefined
): Record<string, unknown> {
  return (envelope?.metadata as { schedule?: Record<string, unknown> })?.schedule ?? {};
}

function postRequest(
  kind: string,
  scheduleId: string,
  body?: unknown,
  headers?: Record<string, string>
): { request: Request; ctx: { params: Record<string, string> } } {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = new Request(
    `http://localhost/api/flows/${kind}/schedules/${scheduleId}/dispatch`,
    init
  );
  return { request, ctx: { params: { flowKind: kind, scheduleId } } };
}

function listRequest(kind: string): { request: Request; ctx: { params: Record<string, string> } } {
  return {
    request: new Request(`http://localhost/api/flows/${kind}/schedules`, { method: "GET" }),
    ctx: { params: { flowKind: kind } }
  };
}

function withFlow(
  host: ReturnType<typeof createMockTransportHost>,
  flow: ReturnType<typeof defineFlow>
) {
  (host as unknown as { registry: { get: (k: string) => unknown } }).registry = {
    get: (kind: string) => (kind === flow.kind ? flow() : undefined),
    list: () => [flow()],
    register: () => undefined,
    unregister: () => undefined,
    has: (kind: string) => kind === flow.kind
  } as unknown as typeof host.registry;
  return host;
}

function withActiveRegistry(
  host: ReturnType<typeof createMockTransportHost>,
  registry: ActiveRequestRegistry
) {
  (host as unknown as { stores: { activeRequests: ActiveRequestRegistry } }).stores = {
    ...(host.stores ?? {}),
    activeRequests: registry
  } as unknown as typeof host.stores;
  return host;
}

function makeStubActiveRegistry(entries: unknown[] = []): ActiveRequestRegistry {
  return {
    register: async () => undefined,
    heartbeat: async () => undefined,
    deregister: async () => undefined,
    listStale: async () => [],
    listAll: async () => entries as never,
    get: async () => undefined
  } as ActiveRequestRegistry;
}

describe("createScheduledTransportAdapter — dispatch", () => {
  it("declares source 'scheduled'", () => {
    const adapter = createScheduledTransportAdapter();
    expect(adapter.source).toBe(SCHEDULED_TRANSPORT_SOURCE);
  });

  it("returns 400 for an invalid schedule id pattern", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "BAD ID");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("invalid_schedule_id");
  });

  it("returns 404 when the flow is not registered", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = createMockTransportHost();
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("missing", "monthly-invoices");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(404);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("flow_not_found");
  });

  it("returns 404 when the schedule id is not declared and there is no resolver", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "ghost");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(404);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("schedule_not_found");
  });

  it("dispatches a static schedule and stamps source/metadata", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "monthly-invoices", {
      nominalFireTime: "2026-06-01T00:00:00Z"
    });
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(202);
    const json = (await response.json()) as { status: string; origin: string };
    expect(json.status).toBe("accepted");
    expect(json.origin).toBe("static");

    const envelope = host.dispatchCalls[0]?.envelope;
    expect(envelope?.source).toBe("scheduled");
    expect(envelope?.action).toBe("noop");
    expect(schedMeta(envelope).scheduleId).toBe("monthly-invoices");
    expect(schedMeta(envelope).origin).toBe("static");
    expect(schedMeta(envelope).nominalFireTime).toBe(
      "2026-06-01T00:00:00Z"
    );
  });

  it("dispatches a dynamic schedule via the resolver and stamps origin='dynamic'", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = buildFlow({
      kind: "reminders",
      actions: {
        sendDigest: {
          inputSchema: z.object({ topic: z.string().optional() }),
          block: noopBlock
        }
      },
      schedules: {
        resolve: async (id) => {
          if (id !== "u_1/weekly") return null;
          return {
            cron: "0 9 * * MON",
            block: noopBlock,
            principal: { userId: "u_1" }
          };
        }
      }
    });
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("reminders", "u_1/weekly");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(202);

    const envelope = host.dispatchCalls[0]?.envelope;
    expect(envelope?.action).toBe("noop");
    expect(envelope?.principal).toEqual({ userId: "u_1" });
    expect(schedMeta(envelope).origin).toBe("dynamic");
  });

  it("returns 404 when the resolver returns null", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = buildFlow({
      kind: "reminders",
      actions: { sendDigest: { inputSchema: z.object({}), block: noopBlock } },
      schedules: { resolve: () => null }
    });
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("reminders", "u_1/missing");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(404);
  });

  it("returns 500 when the resolver throws", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = buildFlow({
      kind: "reminders",
      actions: { sendDigest: { inputSchema: z.object({}), block: noopBlock } },
      schedules: {
        resolve: () => {
          throw new Error("store down");
        }
      }
    });
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("reminders", "u_1/whatever");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("resolver_failed");
  });

  it("returns 400 when the resolver returns a malformed config", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = buildFlow({
      kind: "reminders",
      actions: { sendDigest: { inputSchema: z.object({}), block: noopBlock } },
      schedules: {
        resolve: () => ({ cron: "@nope", block: noopBlock })
      }
    });
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("reminders", "u_1/anything");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("invalid_schedule");
  });

  it("returns 401 when the gateway resolver throws PrincipalResolutionError", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(
        createMockTransportHost({
          resolvePrincipal: () => {
            throw new PrincipalResolutionError("nope", { status: 401 });
          }
        }),
        makeStubActiveRegistry()
      ),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "monthly-invoices");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(401);
  });

  it("dedupe: same idempotency key within window returns 200 duplicate", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;

    const first = await route.handler(
      ...Object.values(
        postRequest("billing", "monthly-invoices", {
          nominalFireTime: "2026-06-01T00:00:00Z"
        })
      ).slice(0, 2) as [Request, { params: Record<string, string> }]
    );
    expect(first.status).toBe(202);

    const second = await route.handler(
      ...Object.values(
        postRequest("billing", "monthly-invoices", {
          nominalFireTime: "2026-06-01T00:00:00Z"
        })
      ).slice(0, 2) as [Request, { params: Record<string, string> }]
    );
    expect(second.status).toBe(200);
    const json = (await second.json()) as { status: string };
    expect(json.status).toBe("duplicate");
  });

  it("onOverlap='skip' (default) short-circuits when an in-flight request matches", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(
        createMockTransportHost(),
        makeStubActiveRegistry([
          {
            requestId: "req-prev",
            flowKind: "billing",
            actionName: "run",
            userId: "u_1",
            source: "scheduled",
            startedAt: 0,
            lastHeartbeatAt: 0,
            metadata: { schedule: { scheduleId: "monthly-invoices" } }
          }
        ])
      ),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "monthly-invoices");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      status: string;
      reason: string;
      requestId: string;
    };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("in_flight");
    expect(json.requestId).toBe("req-prev");
    expect(host.dispatchCalls.length).toBe(0);
  });

  it("onOverlap='allow' bypasses the in-flight check", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = defineFlow({
      kind: "billing",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string().optional() }),
          block: noopBlock
        }
      },
      schedules: {
        static: {
          "monthly-invoices": {
            cron: "0 0 1 * *",
            block: noopBlock,
            onOverlap: "allow"
          }
        }
      }
    });
    const host = withFlow(
      withActiveRegistry(
        createMockTransportHost(),
        makeStubActiveRegistry([
          {
            requestId: "req-prev",
            flowKind: "billing",
            actionName: "run",
            userId: "u_1",
            source: "scheduled",
            startedAt: 0,
            lastHeartbeatAt: 0,
            metadata: { schedule: { scheduleId: "monthly-invoices" } }
          }
        ])
      ),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "monthly-invoices");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(202);
    expect(host.dispatchCalls.length).toBe(1);
  });

  it("schedule.principal overrides the gateway principal", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = defineFlow({
      kind: "reminders",
      actions: {
        sendDigest: { inputSchema: z.object({}), block: noopBlock }
      },
      schedules: {
        static: {
          "for-u-7": {
            cron: "0 9 * * MON",
            block: noopBlock,
            principal: { userId: "u_7" }
          }
        }
      }
    });
    const host = withFlow(
      withActiveRegistry(
        createMockTransportHost({
          resolvePrincipal: () => ({ userId: "system" })
        }),
        makeStubActiveRegistry()
      ),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("reminders", "for-u-7");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(202);
    expect(host.dispatchCalls[0]?.envelope.principal).toEqual({ userId: "u_7" });
  });

  it("static schedule with no principal falls back to the gateway principal", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(
        createMockTransportHost({ resolvePrincipal: () => ({ userId: "system" }) }),
        makeStubActiveRegistry()
      ),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "monthly-invoices");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(202);
    expect(host.dispatchCalls[0]?.envelope.principal).toEqual({ userId: "system" });
  });

  it("disabled static schedule responds 404", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = defineFlow({
      kind: "billing",
      actions: {
        run: { inputSchema: z.object({ value: z.string().optional() }), block: noopBlock }
      },
      schedules: {
        static: {
          "monthly-invoices": {
            cron: "0 0 1 * *",
            block: noopBlock,
            enabled: false
          }
        }
      }
    });
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "monthly-invoices");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(404);
  });
});

describe("createScheduledTransportAdapter — list", () => {
  it("returns static entries plus dynamic.provided=true when a resolver is wired", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = defineFlow({
      kind: "billing",
      actions: {
        run: { inputSchema: z.object({ value: z.string().optional() }), block: noopBlock }
      },
      schedules: {
        static: { "monthly-invoices": { cron: "0 0 1 * *", block: noopBlock, description: "monthly" } },
        resolve: () => null
      }
    });
    const host = withFlow(createMockTransportHost(), flow);
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "GET")!;
    const { request, ctx } = listRequest("billing");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      static: Array<{ id: string }>;
      dynamic: { provided: boolean };
    };
    expect(json.static.map((s) => s.id)).toEqual(["monthly-invoices"]);
    expect(json.dynamic.provided).toBe(true);
  });

  it("dynamic.provided=false when no resolver is set", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "GET")!;
    const { request, ctx } = listRequest("billing");
    const response = await route.handler(request, ctx);
    const json = (await response.json()) as { dynamic: { provided: boolean } };
    expect(json.dynamic.provided).toBe(false);
  });

  it("404 when the flow is not registered", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = createMockTransportHost();
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "GET")!;
    const { request, ctx } = listRequest("missing");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(404);
  });

  it("returns 401 when the principal resolver rejects the listing request", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      createMockTransportHost({
        resolvePrincipal: () => {
          throw new PrincipalResolutionError("nope", { status: 401 });
        }
      }),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "GET")!;
    const { request, ctx } = listRequest("billing");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(401);
  });
});

describe("createScheduledTransportAdapter — edge cases", () => {
  it("static schedule wins when both static and dynamic resolvers match the id", async () => {
    const adapter = createScheduledTransportAdapter();
    const flow = defineFlow({
      kind: "billing",
      actions: {
        run: { inputSchema: z.object({ value: z.string().optional() }), block: noopBlock }
      },
      schedules: {
        static: {
          shared: { cron: "0 0 1 * *", block: noopBlock, description: "static-wins" }
        },
        resolve: () => ({
          cron: "* * * * *",
          block: noopBlock,
          description: "should-not-be-used"
        })
      }
    });
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      flow
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "shared");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(202);
    const json = (await response.json()) as { origin: string };
    expect(json.origin).toBe("static");

    const envelope = host.dispatchCalls[0]?.envelope;
    expect(schedMeta(envelope).cron).toBe("0 0 1 * *");
  });

  it("returns 503 when host.dispatch throws (flow unregistered between resolve and dispatch)", async () => {
    const adapter = createScheduledTransportAdapter();
    const baseHost = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      buildFlow()
    );
    (baseHost as unknown as { dispatch: () => never }).dispatch = () => {
      throw new Error("Unknown flow");
    };
    const route = adapter.createBindings(baseHost).routes!.find((r) => r.method === "POST")!;
    const { request, ctx } = postRequest("billing", "monthly-invoices");
    const response = await route.handler(request, ctx);
    expect(response.status).toBe(503);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("flow_unregistered");
  });

  it("treats an empty body as no nominalFireTime and synthesizes one", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    // Use a fresh request with no body — exercise the empty-body path.
    const request = new Request(
      "http://localhost/api/flows/billing/schedules/monthly-invoices/dispatch",
      { method: "POST" }
    );
    const response = await route.handler(request, {
      params: { flowKind: "billing", scheduleId: "monthly-invoices" }
    });
    expect(response.status).toBe(202);
    const envelope = host.dispatchCalls[0]?.envelope;
    expect(typeof schedMeta(envelope).nominalFireTime).toBe("string");
  });

  it("treats unparseable JSON as an empty body", async () => {
    const adapter = createScheduledTransportAdapter();
    const host = withFlow(
      withActiveRegistry(createMockTransportHost(), makeStubActiveRegistry()),
      buildFlow()
    );
    const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
    const request = new Request(
      "http://localhost/api/flows/billing/schedules/monthly-invoices/dispatch",
      { method: "POST", body: "not json", headers: { "Content-Type": "application/json" } }
    );
    const response = await route.handler(request, {
      params: { flowKind: "billing", scheduleId: "monthly-invoices" }
    });
    expect(response.status).toBe(202);
  });
});

createInboundTransportConformanceTests({
  name: "scheduled",
  factory: () => createScheduledTransportAdapter(),
  helpers: {
    buildEnvelope: async (adapter, host) => {
      const flow = buildFlow();
      withFlow(host, flow);
      withActiveRegistry(host, makeStubActiveRegistry());
      const bindings = adapter.createBindings(host);
      const route = bindings.routes!.find((r) => r.method === "POST")!;
      const { request, ctx } = postRequest("billing", "monthly-invoices");
      await route.handler(request, ctx);
      const envelope = host.dispatchCalls[0]?.envelope;
      if (envelope === undefined) throw new Error("Adapter did not call host.dispatch");
      return envelope;
    }
  }
});
