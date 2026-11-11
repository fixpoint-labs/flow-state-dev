/**
 * Write sessions and the default write flow are the server's (FIX-2624).
 *
 * A write session's id is computed from public values, so anyone who knows a
 * user and their org can compute it. If a client could name one, an org-mate
 * could create it first under their own sign-in and lock its writer out of
 * writing that resource for good. So no client-facing route, and no transport
 * dispatch, takes a write session id or the default write flow's address
 * unless it is the server's own resource send. The route matrix below walks
 * every route the router knows, so a new route that takes a session id or a
 * flow address is covered without anyone listing it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "../src";
import { createInboundTransportHost, createInMemoryStores } from "../src/host";
import { defaultBodyUserIdPrincipalResolver } from "../src/transports/auth/defaultBodyUserIdPrincipalResolver";
import { listFlowRoutes } from "../src/routes/router";
import { DEFAULT_WRITE_FLOW, writeSessionId } from "../src/resources/default-write-flow";
import type { StoreRegistry } from "../src";

const ORG = "org-a";

const pins = defineResource({
  ref: "pins",
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).default([]) }),
  client: {},
  runBy: "default"
});

const signIn = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return user == null ? null : { userId: user, orgId: ORG };
};

const noop = handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({}) });

function build() {
  const flow = defineFlow({
    kind: "threads",
    resources: { pins },
    actions: { noop: { block: noop } },
    authentication: { resolvePrincipal: signIn }
  } as never)();
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores, registry };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

type Router = ReturnType<typeof createFlowApiRouter>;

function call(router: Router, method: string, path: string[], user: string, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
    method,
    headers: { "content-type": "application/json", "x-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const handlerFor = (router as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[method];
  return handlerFor!(request, { params: { path } });
}

async function settle(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

/** Alice's write session for her pins: computable by anyone who knows her id and org. */
const alicesWriteSession = writeSessionId(
  { scope: "user", key: "pins", writer: DEFAULT_WRITE_FLOW },
  { userId: "alice", orgId: ORG }
);

describe("a write session can't be claimed by a client", () => {
  it("refuses an org-mate who creates the victim's write session first, so the victim still writes", async () => {
    const { router, stores } = build();
    const claim = await call(router, "POST", ["threads", "sessions"], "bob", { sessionId: alicesWriteSession });
    expect(claim.status).toBe(400);
    const claimOnWriter = await call(router, "POST", [DEFAULT_WRITE_FLOW, "sessions"], "bob", { sessionId: alicesWriteSession });
    expect(claimOnWriter.status).toBe(404);
    expect(await stores.session.list({})).toEqual([]);

    const res = await call(router, "POST", ["resources", "user", "pins", "actions", "set"], "alice", {
      input: { state: { pinned: ["t1"] }, version: 0 }
    });
    expect(res.status, await res.clone().text()).toBe(202);
    const { request } = (await res.json()) as { request: { id: string } };
    expect((await settle(stores, request.id)).status).toBe("completed");
  });

  it("answers the default write flow's address as any unknown flow's, on every route but its own requests", async () => {
    const { router } = build();
    const unknown = await call(router, "POST", ["nope", "sessions"], "alice", {});
    const writer = await call(router, "POST", [DEFAULT_WRITE_FLOW, "sessions"], "alice", {});
    expect(writer.status).toBe(unknown.status);
    expect(await writer.json()).toEqual({ error: `Unknown flow "${DEFAULT_WRITE_FLOW}"` });
  });

  it("route matrix: every route that takes a session id or a flow address refuses a write session and the default write flow", async () => {
    const { router, stores } = build();
    // The writer's own request routes are how a client hears its write settle; each is
    // checked against the declaring flow's sign-in (`resources-by-scope.test.ts`).
    const requestAddressed = new Set(["request_stream", "request_status", "abort_request"]);
    const covered: string[] = [];
    for (const route of listFlowRoutes()) {
      const takesSession = route.pattern.includes(":sessionId");
      const takesFlow = route.pattern.includes(":flowKind");
      if (!takesSession && !takesFlow) continue;
      if (route.kind === "send_resource") continue;
      if (takesFlow && !takesSession && requestAddressed.has(route.kind)) continue;
      const path = route.pattern
        .split("/")
        .filter((part) => part.length > 0)
        .map((part) =>
          part === ":sessionId" ? alicesWriteSession : part === ":flowKind" ? (takesSession ? "threads" : DEFAULT_WRITE_FLOW) : part.startsWith(":") || part.startsWith("*") ? "x" : part
        );
      const before = JSON.stringify(await stores.session.list({}));
      const body = route.method === "GET" || route.method === "DELETE" ? undefined : { input: {} };
      const res = await call(router, route.method, path, "alice", body);
      expect([400, 404], `${route.kind} ${route.method} ${route.pattern} answered ${res.status}`).toContain(res.status);
      expect(JSON.stringify(await stores.session.list({}))).toBe(before);
      covered.push(route.kind);
    }
    expect(covered).toEqual(expect.arrayContaining(["create_session", "execute_action", "get_session", "session_stream", "run_read"]));
  });

  it("refuses a body-named write session on the action route", async () => {
    const { router } = build();
    const res = await call(router, "POST", ["threads", "actions", "noop"], "bob", { sessionId: alicesWriteSession, input: {} });
    expect(res.status).toBe(400);
  });
});

describe("a transport dispatch can't reach them either", () => {
  it("refuses a write session id and the default write flow at the host, whatever the transport", async () => {
    const { registry, stores } = build();
    // Registered as a first resource send would register it.
    const routerRes = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    routers.push(routerRes);
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {}
    });
    const envelope = {
      source: "mcp",
      flowKind: "threads",
      action: "noop",
      input: {},
      sessionId: alicesWriteSession,
      orgId: DEFAULT_ORG_ID,
      principal: { userId: "bob", orgId: DEFAULT_ORG_ID }
    };
    await expect(host.validateDispatch(envelope as never)).rejects.toThrow(/write session/);
    expect(() => host.dispatch(envelope as never)).toThrow(/write session/);
    await expect(
      host.validateDispatch({ ...envelope, flowKind: DEFAULT_WRITE_FLOW, action: "set", sessionId: undefined } as never)
    ).rejects.toThrow(`Unknown flow "${DEFAULT_WRITE_FLOW}"`);
  });
});
