/**
 * User and org resources with no session (FIX-2624): read by scope and key,
 * written only through the flow `runBy` names, and the identity read.
 *
 * The checks are on the stores, not on what a route answers about itself: a
 * read leaves the session and request stores as they were; a write records a
 * request naming its writer and runs in that writer's own session; and every
 * route takes the caller from the declaring flow's sign-in, so a second user,
 * a second org, or a userId forged in the body or the query reaches nothing
 * that isn't theirs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "../src";
import { createInboundTransportHost, createInMemoryStores } from "../src/host";
import { defaultBodyUserIdPrincipalResolver } from "../src/transports/auth/defaultBodyUserIdPrincipalResolver";
import { asServerResourceSend, DEFAULT_WRITE_FLOW, writeSessionId } from "../src/resources/default-write-flow";
import type { StoreRegistry } from "../src";

const ORG_A = "org-a";
const ORG_B = "org-b";

const pins = defineResource({
  ref: "pins",
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).max(50).default([]) }),
  client: { expose: ["pinned"] },
  runBy: "default",
  canWrite: ({ next }) => new Set(next.pinned).size === next.pinned.length
});

const project = defineResource({
  ref: "project",
  scope: "org",
  stateSchema: z.object({ name: z.string().default(""), lead: z.string().default(""), budget: z.number().default(0) }),
  // The budget is the org's business, not the screen's: kept as stored on a client write.
  client: { exclude: ["budget"] },
  runBy: "default",
  canWrite: ({ next }) => next.name.length <= 40
});

const notes = defineResource({
  ref: "notes",
  scope: "user",
  stateSchema: z.object({ text: z.string().default("") }),
  client: { expose: ["text"] }
});

/** Signs callers in from two headers, as a real app's session cookie would. */
const signIn = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  const org = context.request?.headers.get("x-org") ?? ORG_A;
  return user == null ? null : { userId: user, orgId: org };
};

const noop = handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({}) });

function threadsFlow(options: { authenticated: boolean; kind?: string; resolver?: typeof signIn }) {
  return defineFlow({
    kind: options.kind ?? "threads",
    resources: { pins, project, notes },
    actions: { noop: { block: noop } },
    ...(options.authenticated ? { authentication: { resolvePrincipal: options.resolver ?? signIn } } : {})
  } as never)();
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function build(flows: ReturnType<typeof threadsFlow>[]) {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow as never);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores };
}

type Router = ReturnType<typeof createFlowApiRouter>;
type Caller = { user?: string; org?: string };

function headers(caller: Caller): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(caller.user === undefined ? {} : { "x-user": caller.user }),
    ...(caller.org === undefined ? {} : { "x-org": caller.org })
  };
}

function get(router: Router, path: string[], caller: Caller, query = ""): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.join("/")}${query}`, { headers: headers(caller) });
  return router.GET(request, { params: { path } });
}

function post(router: Router, path: string[], caller: Caller, body: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.join("/")}`, {
    method: "POST",
    headers: headers(caller),
    body: JSON.stringify(body)
  });
  return router.POST(request, { params: { path } });
}

async function read(router: Router, scope: string, key: string, caller: Caller, query = "") {
  const res = await get(router, ["resources", scope, key], caller, query);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { value: Record<string, unknown>; version: number };
}

async function settle(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

async function write(router: Router, stores: StoreRegistry, scope: string, key: string, caller: Caller, body: unknown) {
  const res = await post(router, ["resources", scope, key, "actions", "set"], caller, body);
  expect(res.status, await res.clone().text()).toBe(202);
  const { request } = (await res.json()) as { request: { id: string } };
  return settle(stores, request.id);
}

/** Everything a read could leave behind in the session and request stores. */
async function sessionAndRequests(stores: StoreRegistry) {
  return JSON.stringify({
    sessions: (await stores.session.list({})).map((s) => [s.id, s.version]),
    requests: (await stores.request.list({})).map((r) => [r.id, r.status])
  });
}

const alice = { user: "alice", org: ORG_A };
const bob = { user: "bob", org: ORG_A };
const carol = { user: "carol", org: ORG_B };

describe("a direct read by scope and key", () => {
  it("answers the caller's own copy, at its schema default and version 0 before any write, and makes no session or request", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const before = await sessionAndRequests(stores);
    expect(await read(router, "user", "pins", alice)).toEqual({ scope: "user", key: "pins", value: { pinned: [] }, version: 0 });
    expect((await read(router, "org", "project", alice)).value).toEqual({ name: "", lead: "" });
    expect(await sessionAndRequests(stores)).toBe(before);
  });

  it("refuses a caller the declaring flow's resolver doesn't sign in, rather than falling back to the host's", async () => {
    const { router } = build([threadsFlow({ authenticated: true })]);
    const res = await get(router, ["resources", "user", "pins"], {}, "?userId=alice");
    // Answered as an unused key (Cursor 4543357949): an unsigned caller learns nothing about which keys exist.
    expect(res.status).toBe(404);
  });

  it("answers an unknown key, and one no client may read, as unknown", async () => {
    const { router } = build([threadsFlow({ authenticated: true })]);
    expect((await get(router, ["resources", "user", "nope"], alice)).status).toBe(404);
    expect((await get(router, ["resources", "session", "pins"], alice)).status).toBe(400);
  });

  it("refuses a key two flows declare with different resolvers, naming both", async () => {
    const other = (context: { request?: Request }) => ({ userId: context.request?.headers.get("x-other") ?? "x", orgId: ORG_A });
    const { router } = build([
      threadsFlow({ authenticated: true }),
      threadsFlow({ authenticated: true, kind: "digest", resolver: other as typeof signIn })
    ]);
    const res = await get(router, ["resources", "user", "pins"], alice);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('"threads"');
    expect(body.message).toContain('"digest"');
  });
});

describe("declarations that agree: one on the host fallback, one naming the host's own resolver", () => {
  it("reads 200 and lands a default write, because both resolve to the same resolver", async () => {
    // Codex: flow A falls back to the host resolver R, flow B sets R itself. The route and the
    // default write flow must reach one verdict on whether they agree.
    const registry = createFlowRegistry();
    registry.register(threadsFlow({ authenticated: true }) as never);
    registry.register(threadsFlow({ authenticated: false, kind: "digest" }) as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, resolvePrincipal: signIn } as never);
    routers.push(router);
    expect((await get(router, ["resources", "user", "pins"], alice)).status).toBe(200);
    const done = await write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["x"] }, version: 0 } });
    expect(done.status, JSON.stringify(done.result)).toBe("completed");
    expect((await read(router, "user", "pins", alice)).value).toEqual({ pinned: ["x"] });
  });
});

describe("declarations that disagree on their resolver, one on the host fallback", () => {
  it("refuses the read and the send (409) when one declaring flow has its own resolver and the other falls back to the host's", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true }), threadsFlow({ authenticated: false, kind: "digest" })]);
    const read = await get(router, ["resources", "user", "pins"], alice, "?userId=alice");
    expect(read.status).toBe(409);
    const body = (await read.json()) as { message: string };
    expect(body.message).toContain('"threads"');
    expect(body.message).toContain('"digest"');
    const send = await post(router, ["resources", "user", "pins", "actions", "set"], alice, {
      userId: "alice",
      input: { state: { pinned: ["x"] }, version: 0 }
    });
    expect(send.status).toBe(409);
    expect(await stores.session.list({})).toEqual([]);
    expect(await stores.resourceState.get("user", `alice:~org:${ORG_A}`, "pins")).toBeUndefined();
  });

  it("refuses inside the default write flow too, with the same verdict the route reaches", async () => {
    // Dispatched straight to the flow as the server's own send, so only its own agreement check
    // (the route's, given the same host resolver) stands between a disagreement and a write.
    const registry = createFlowRegistry();
    registry.register(threadsFlow({ authenticated: true }) as never);
    registry.register(threadsFlow({ authenticated: false, kind: "digest" }) as never);
    const stores = createInMemoryStores();
    const host = createInboundTransportHost({ registry, stores, resolvePrincipal: defaultBodyUserIdPrincipalResolver, runtimeConfig: {} });
    const sessionId = writeSessionId({ scope: "user", key: "pins", writer: DEFAULT_WRITE_FLOW }, { userId: "alice", orgId: ORG_A });
    const handle = host.dispatch(
      asServerResourceSend({
        source: "http",
        flowKind: DEFAULT_WRITE_FLOW,
        action: "set",
        input: { state: { pinned: ["x"] }, version: 0 },
        sessionId,
        requestId: "req_disagree",
        orgId: ORG_A,
        principal: { userId: "alice", orgId: ORG_A }
      }) as never
    );
    await handle.accepted;
    const settled = await settle(stores, "req_disagree");
    expect(settled.status).toBe("failed");
    expect(settled.result?.error?.code).toBe("not_writable");
    expect(settled.result?.error?.message).toMatch(/"threads".*"digest"|"digest".*"threads"/);
    expect(await stores.resourceState.get("user", `alice:~org:${ORG_A}`, "pins")).toBeUndefined();
  });
});

describe("a write through runBy", () => {
  it("runs the default write flow in the writer's own session, records a request naming them, and lands in their cell only", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const done = await write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["t1"] }, version: 0 } });
    expect(done.status, JSON.stringify(done.result)).toBe("completed");
    expect(done.userId).toBe("alice");
    expect(done.orgId).toBe(ORG_A);
    expect(await read(router, "user", "pins", alice)).toMatchObject({ value: { pinned: ["t1"] }, version: 1 });
    // Bob, in the same org, and Carol, in another, still read their own empty copies.
    expect((await read(router, "user", "pins", bob)).value).toEqual({ pinned: [] });
    expect((await read(router, "user", "pins", carol)).value).toEqual({ pinned: [] });
    const sessions = await stores.session.list({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.userId).toBe("alice");
    expect(sessions[0]!.id).toBe(done.sessionId);
  });

  it("ignores a userId forged in the body or the query when the flow signs its callers in", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const done = await write(router, stores, "user", "pins", alice, {
      userId: "bob",
      input: { state: { pinned: ["forged"] }, version: 0 }
    });
    expect(done.userId).toBe("alice");
    expect((await read(router, "user", "pins", bob)).value).toEqual({ pinned: [] });
    expect((await read(router, "user", "pins", bob, "?userId=alice")).value).toEqual({ pinned: [] });
    expect((await read(router, "user", "pins", alice)).value).toEqual({ pinned: ["forged"] });
  });

  it("keeps an org resource per org: Carol in org B never sees or writes org A's", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    await write(router, stores, "org", "project", alice, { input: { state: { name: "Atlas", lead: "alice" }, version: 0 } });
    expect((await read(router, "org", "project", bob)).value).toEqual({ name: "Atlas", lead: "alice" });
    expect((await read(router, "org", "project", carol)).value).toEqual({ name: "", lead: "" });
    // Carol's write at org A's version lands in org B's cell, which is at 0: refused as stale, org A untouched.
    const carols = await write(router, stores, "org", "project", carol, { input: { state: { name: "Mine" }, version: 1 } });
    expect(carols.status).toBe("failed");
    expect((await read(router, "org", "project", alice)).value).toEqual({ name: "Atlas", lead: "alice" });
  });

  it("refuses a write at a stale version, and two concurrent edits both land once each re-reads", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    await write(router, stores, "org", "project", alice, { input: { state: { name: "Atlas" }, version: 0 } });
    // Alice and Bob both read version 1 and change different fields at once.
    const [a, b] = await Promise.all([
      write(router, stores, "org", "project", alice, { input: { state: { name: "Atlas 2", lead: "" }, version: 1 } }),
      write(router, stores, "org", "project", bob, { input: { state: { name: "Atlas", lead: "bob" }, version: 1 } })
    ]);
    const outcomes = [a, b].map((record) => record.status).sort();
    expect(outcomes).toEqual(["completed", "failed"]);
    const loser = [a, b].find((record) => record.status === "failed")!;
    expect(loser.result?.error?.code).toBe("stale_version");
    // The loser reads again and re-applies its own change: both land.
    const now = await read(router, "org", "project", alice);
    const redo = loser === a ? { ...now.value, name: "Atlas 2" } : { ...now.value, lead: "bob" };
    const again = await write(router, stores, "org", "project", loser === a ? alice : bob, { input: { state: redo, version: now.version } });
    expect(again.status).toBe("completed");
    expect((await read(router, "org", "project", alice)).value).toEqual({ name: "Atlas 2", lead: "bob" });
  });

  it("makes one session per writer when two first writes race", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    await Promise.all([
      write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["a"] }, version: 0 } }),
      write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["b"] }, version: 0 } })
    ]);
    const sessions = await stores.session.list({});
    expect(sessions.map((s) => s.userId)).toEqual(["alice"]);
  });

  it("keeps fields the client can't read as stored", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const cell = "org-a";
    await stores.resourceState.set("org", cell, "project", { name: "Atlas", lead: "", budget: 100 }, 0);
    const done = await write(router, stores, "org", "project", alice, { input: { state: { name: "Atlas", lead: "alice", budget: 0 }, version: 1 } });
    expect(done.status, JSON.stringify(done.result)).toBe("completed");
    expect((await stores.resourceState.get("org", cell, "project"))?.state).toEqual({ name: "Atlas", lead: "alice", budget: 100 });
  });

  it("refuses what canWrite refuses, and what the schema refuses", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const dup = await write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["t", "t"] }, version: 0 } });
    expect(dup.result?.error?.code).toBe("write_refused");
    const bad = await write(router, stores, "user", "pins", alice, { input: { state: { pinned: "t" }, version: 0 } });
    expect(bad.status).toBe("failed");
    expect((await read(router, "user", "pins", alice)).version).toBe(0);
  });

  it("refuses a client write of a resource with no runBy, naming why", async () => {
    const { router } = build([threadsFlow({ authenticated: true })]);
    const res = await post(router, ["resources", "user", "notes", "actions", "set"], alice, { input: { state: { text: "x" }, version: 0 } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toMatch(/no runBy/);
  });

  it("can't be reached around: no direct send to the default write flow, no client-named write session", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const done = await write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["t1"] }, version: 0 } });
    const direct = await post(router, ["fsd-default-write", "actions", "set"], alice, { input: { state: { pinned: [] }, version: 1 } });
    expect(direct.status).toBe(404);
    const named = await post(router, ["fsd-default-write", done.sessionId!, "actions", "set"], alice, { input: { state: { pinned: [] }, version: 1 } });
    expect(named.status).toBe(404);
    // Named as a session on the path: answered as a session nobody holds.
    const squat = await post(router, ["threads", done.sessionId!, "actions", "noop"], bob, { input: {} });
    expect(squat.status).toBe(404);
    expect((await read(router, "user", "pins", alice)).value).toEqual({ pinned: ["t1"] });
  });

  it("answers a write session's records to the declaring flow's sign-in: its writer reads them, nobody else", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const done = await write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["secret"] }, version: 0 } });
    const status = ["fsd-default-write", "requests", done.id, "status"];
    expect((await get(router, status, alice)).status).toBe(200);
    expect((await get(router, status, bob)).status).toBe(404);
    expect((await get(router, status, {})).status).toBe(401);
    // No session route serves a write session, its writer included: they hear their write on its request.
    const requests = ["sessions", done.sessionId!, "requests"];
    for (const caller of [alice, bob, {}]) expect((await get(router, requests, caller)).status).toBe(404);
  });

  it("answers a write's records to the declaring flow on a fresh router, where no write has run in this process", async () => {
    // Codex P1: a restarted host, or another worker, has run no write yet.
    const first = build([threadsFlow({ authenticated: true })]);
    const done = await write(first.router, first.stores, "user", "pins", alice, { input: { state: { pinned: ["secret"] }, version: 0 } });
    const registry = createFlowRegistry();
    registry.register(threadsFlow({ authenticated: true }) as never);
    const fresh = createFlowApiRouter({ registry, stores: first.stores, staleSweepIntervalMs: 0 });
    routers.push(fresh);
    for (const caller of [{}, bob, { user: "mallory", org: ORG_B }]) {
      const requests = await get(fresh, ["sessions", done.sessionId!, "requests"], caller);
      expect(requests.status).not.toBe(200);
      const status = await get(fresh, ["fsd-default-write", "requests", done.id, "status"], caller);
      expect([401, 404]).toContain(status.status);
      expect(await status.text()).not.toContain("secret");
    }
    expect((await get(fresh, ["fsd-default-write", "requests", done.id, "status"], alice)).status).toBe(200);
  });

  it("never lists a write's in-flight request, even to a caller the declaring flow rejects", async () => {
    // Codex P2: the active-requests listing.
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    const done = await write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["t"] }, version: 0 } });
    await stores.activeRequests.register({
      requestId: "req_write_inflight",
      flowKind: "fsd-default-write",
      flowId: "fsd-default-write",
      actionName: "set",
      sessionId: done.sessionId!,
      userId: "alice",
      orgId: ORG_A,
      source: "http",
      startedAt: Date.now()
    } as never);
    for (const caller of [{}, alice, bob]) {
      const res = await get(router, ["active-requests"], caller);
      expect(await res.text()).not.toContain("req_write_inflight");
    }
    // A host-level credential for Alice that the declaring flow's own resolver rejects.
    const registry = createFlowRegistry();
    registry.register(threadsFlow({ authenticated: true }) as never);
    const hostSigned = createFlowApiRouter({
      registry,
      stores,
      staleSweepIntervalMs: 0,
      resolvePrincipal: (context: { request?: Request }) => {
        const user = context.request?.headers.get("x-host-user");
        return user == null ? null : { userId: user, orgId: ORG_A };
      }
    } as never);
    routers.push(hostSigned);
    const listing = await hostSigned.GET(
      new Request("http://localhost/api/flows/active-requests", { headers: { "x-host-user": "alice" } }),
      { params: { path: ["active-requests"] } }
    );
    expect(listing.status).toBe(200);
    expect(await listing.text()).not.toContain("req_write_inflight");
  });

  it("leaves write sessions out of the session listing", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: true })]);
    await write(router, stores, "user", "pins", alice, { input: { state: { pinned: ["t1"] }, version: 0 } });
    const res = await get(router, ["sessions"], alice);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sessions: unknown[] }).sessions).toEqual([]);
  });
});

describe("open mode (no resolver)", () => {
  it("takes the request's user and the default org, as every route does there", async () => {
    const { router, stores } = build([threadsFlow({ authenticated: false })]);
    const done = await write(router, stores, "user", "pins", {}, { userId: "dev", input: { state: { pinned: ["x"] }, version: 0 } });
    expect(done.status).toBe("completed");
    expect((await read(router, "user", "pins", {}, "?userId=dev")).value).toEqual({ pinned: ["x"] });
    expect((await read(router, "user", "pins", {}, "?userId=other")).value).toEqual({ pinned: [] });
  });
});

describe("the identity read", () => {
  it("answers the user and org the flow's sign-in resolves, never a forged one", async () => {
    const { router } = build([threadsFlow({ authenticated: true })]);
    const res = await get(router, ["threads", "identity"], carol, "?userId=alice");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "carol", orgId: ORG_B });
    expect((await get(router, ["threads", "identity"], {})).status).toBe(401);
    expect((await get(router, ["nope", "identity"], alice)).status).toBe(404);
  });
});

describe("a send through a flow of the app's own (runBy: { flow })", () => {
  const plan = defineResource({
    ref: "plan",
    scope: "org",
    stateSchema: z.object({ steps: z.array(z.string()).default([]) }),
    client: { expose: ["steps"] },
    runBy: { flow: "planner" }
  });
  const replan = handler({
    name: "replan",
    inputSchema: z.object({ steps: z.array(z.string()) }),
    execute: (input, ctx) => ({ ranIn: ctx.session.identity.id, steps: input.steps })
  });
  const planner = (kind: string, declares: boolean) =>
    defineFlow({
      kind,
      resources: declares ? { plan } : {},
      actions: { replan: { block: replan } },
      authentication: { resolvePrincipal: signIn }
    } as never)();
  const board = defineFlow({
    kind: "board",
    resources: { plan },
    actions: { noop: { block: noop } },
    authentication: { resolvePrincipal: signIn }
  } as never)();

  it("runs the named flow's action in the writer's own write session on that flow, never the default write flow", async () => {
    const { router, stores } = build([board as never, planner("planner", true) as never]);
    const res = await post(router, ["resources", "org", "plan", "actions", "replan"], alice, { input: { steps: ["a"] } });
    expect(res.status, await res.clone().text()).toBe(202);
    const { request } = (await res.json()) as { request: { id: string } };
    const done = await settle(stores, request.id);
    expect(done.status, JSON.stringify(done.result)).toBe("completed");
    const expected = writeSessionId({ scope: "org", key: "plan", writer: "planner" }, { userId: "alice", orgId: ORG_A });
    expect(done.flowKind).toBe("planner");
    expect(done.sessionId).toBe(expected);
    expect((await stores.session.get(expected))?.flowKind).toBe("planner");
    expect(await stores.session.get(writeSessionId({ scope: "org", key: "plan", writer: DEFAULT_WRITE_FLOW }, { userId: "alice", orgId: ORG_A }))).toBeUndefined();
  });

  it("refuses a send when the flow runBy names doesn't declare the resource, and writes nothing", async () => {
    const { router, stores } = build([board as never, planner("planner", false) as never]);
    const res = await post(router, ["resources", "org", "plan", "actions", "replan"], alice, { input: { steps: ["a"] } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("runby_flow_missing");
    expect(await stores.request.list({})).toEqual([]);
  });
});

// Cursor review 5865490275.
describe("the principal comes from the flow that runs, and nothing tells a real key from an unused one", () => {
  const invoice = defineResource({
    ref: "invoice",
    scope: "org",
    stateSchema: z.object({ refunded: z.boolean().default(false) }),
    client: { expose: ["refunded"] },
    runBy: { flow: "billing" }
  });
  const refunds: string[] = [];
  const refund = handler({
    name: "refund",
    inputSchema: z.object({}).passthrough(),
    execute: (_input, ctx) => {
      refunds.push(ctx.session.identity.userId ?? "?");
      return { by: ctx.session.identity.userId };
    }
  });
  // `app` sorts before `billing`; neither has a resolver of its own, so both run the host's.
  // `guest`: app lets signed-out callers in as "visitor", which billing does not.
  const appFlow = (guest: boolean) =>
    defineFlow({
      kind: "app",
      resources: { invoice },
      actions: { noop: { block: noop } },
      ...(guest ? { authentication: { requireUser: false, defaultUserId: "visitor" } } : {})
    } as never)();
  const billing = defineFlow({ kind: "billing", resources: { invoice }, actions: { refund: { block: refund } } } as never)();
  /** Signs a user in from a header, or answers the org alone. */
  const orgOnly = (context: { request?: Request; envelope?: { flowKind?: string } }) => {
    const user = context.request?.headers.get("x-user");
    return user == null ? { orgId: ORG_A } : { userId: user, orgId: ORG_A };
  };
  /** A misconfigured resolver: the same request is a different user at each flow. */
  const perFlow = (context: { request?: Request; envelope?: { flowKind?: string } }) => {
    const user = context.request?.headers.get("x-user");
    return user == null ? { orgId: ORG_A } : { userId: `${user}@${context.envelope?.flowKind}`, orgId: ORG_A };
  };
  const host = (resolvePrincipal: typeof orgOnly = orgOnly, guest = false) => {
    refunds.length = 0;
    const registry = createFlowRegistry();
    registry.register(appFlow(guest) as never);
    registry.register(billing as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, resolvePrincipal } as never);
    routers.push(router);
    return { router, stores };
  };

  it("an anonymous send through the resource is refused as a direct POST to the writer's action is, and runs nothing", async () => {
    const { router, stores } = host(orgOnly, true);
    const direct = await post(router, ["billing", "actions", "refund"], {}, { input: {} });
    expect(direct.status).not.toBe(202);
    const viaResource = await post(router, ["resources", "org", "invoice", "actions", "refund"], {}, { input: {} });
    expect(viaResource.status).not.toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(refunds).toEqual([]);
    expect(await stores.request.list({})).toEqual([]);
  });

  it("a signed-in send runs the writer's action as the one caller every declaring flow resolves, and reads back its write", async () => {
    const { router, stores } = host();
    const res = await post(router, ["resources", "org", "invoice", "actions", "refund"], alice, { input: {} });
    expect(res.status, await res.clone().text()).toBe(202);
    const { request } = (await res.json()) as { request: { id: string } };
    const done = await settle(stores, request.id);
    expect(done.status, JSON.stringify(done.result)).toBe("completed");
    expect(done.userId).toBe("alice");
    expect(refunds).toEqual(["alice"]);
    expect((await get(router, ["resources", "org", "invoice"], alice)).status).toBe(200);
  });

  it("refuses a request its declaring flows resolve to different users, read and send alike, and runs nothing", async () => {
    // Codex review 4544082020: a send stored under alice@billing and a read admitted through `app`
    // read alice@app, so the resource could not read back its own write.
    const { router, stores } = host(perFlow);
    const send = await post(router, ["resources", "org", "invoice", "actions", "refund"], alice, { input: {} });
    expect(send.status).toBe(500);
    expect(((await send.json()) as { error: string }).error).toBe("resolver_disagreement");
    const read = await get(router, ["resources", "org", "invoice"], alice);
    expect(read.status).toBe(500);
    expect(await stores.request.list({})).toEqual([]);
    expect(refunds).toEqual([]);
    // An unsigned caller still learns nothing: the unused key's answer.
    const unused = await get(router, ["resources", "org", "nope"], {});
    const anonymous = await get(router, ["resources", "org", "invoice"], {});
    expect(anonymous.status).toBe(unused.status);
  });

  it("serves a named writer's request to its writer through the writer flow's sign-in: status and stream", async () => {
    // Codex 4543542971: the record's governor picked the first declarer (`app`), not the writer.
    const { router, stores } = host();
    const res = await post(router, ["resources", "org", "invoice", "actions", "refund"], alice, { input: {} });
    const { request } = (await res.json()) as { request: { id: string } };
    const done = await settle(stores, request.id);
    expect(done.userId).toBe("alice");
    const status = await get(router, ["billing", "requests", request.id, "status"], alice);
    expect(status.status, await status.clone().text()).toBe(200);
    const stream = await get(router, ["billing", "requests", request.id, "stream"], alice);
    expect(stream.status).toBe(200);
    // Another signed-in user still gets the unused id's answer.
    const unused = await get(router, ["billing", "requests", "req_unused", "status"], bob);
    const other = await get(router, ["billing", "requests", request.id, "status"], bob);
    expect(other.status).toBe(unused.status);
  });

  /** Status and body, with the probed key in the body replaced, so two probes compare. */
  async function probe(res: Response, key: string) {
    return { status: res.status, body: (await res.text()).split(key).join("<key>") };
  }

  it("an anonymous probe of a real key answers exactly as an unused key, on the read and the send", async () => {
    const { router } = build([threadsFlow({ authenticated: true })]);
    const unusedRead = await probe(await get(router, ["resources", "user", "nope"], {}), "nope");
    const unusedSend = await probe(await post(router, ["resources", "user", "nope", "actions", "set"], {}, { input: {} }), "nope");
    for (const key of ["pins", "notes"]) {
      expect(await probe(await get(router, ["resources", "user", key], {}), key)).toEqual(unusedRead);
      expect(await probe(await post(router, ["resources", "user", key, "actions", "set"], {}, { input: {} }), key)).toEqual(unusedSend);
    }
  });

  it("an anonymous probe of a key two flows declare in disagreement, or only isolated, names no flow", async () => {
    const other = (context: { request?: Request }) => ({ userId: context.request?.headers.get("x-other") ?? "x", orgId: ORG_A });
    const disagree = build([threadsFlow({ authenticated: true }), threadsFlow({ authenticated: true, kind: "digest", resolver: other as typeof signIn })]);
    const unused = await probe(await get(disagree.router, ["resources", "user", "nope"], {}), "nope");
    expect(await probe(await get(disagree.router, ["resources", "user", "pins"], {}), "pins")).toEqual(unused);
    const isoPins = defineResource({ ref: "iso", scope: "user", stateSchema: z.object({}), client: {}, flowIsolation: true });
    const iso = build([defineFlow({ kind: "iso-flow", resources: { isoPins }, actions: { noop: { block: noop } }, authentication: { resolvePrincipal: signIn } } as never)() as never]);
    const unusedIso = await probe(await get(iso.router, ["resources", "user", "nope"], {}), "nope");
    expect(await probe(await get(iso.router, ["resources", "user", "iso"], {}), "iso")).toEqual(unusedIso);
  });

  it("a write request whose session no longer resolves gets the route's ordinary unused-id answer", async () => {
    const first = build([threadsFlow({ authenticated: true })]);
    const done = await write(first.router, first.stores, "user", "pins", alice, { input: { state: { pinned: ["x"] }, version: 0 } });
    // A mixed host (one flow signs callers in, the host resolver is the development default)
    // where nothing declares `pins` any more.
    const registry = createFlowRegistry();
    registry.register(defineFlow({ kind: "other", actions: { noop: { block: noop } }, authentication: { resolvePrincipal: signIn } } as never)() as never);
    const fresh = createFlowApiRouter({ registry, stores: first.stores, staleSweepIntervalMs: 0 });
    routers.push(fresh);
    for (const caller of [{}, bob]) {
      const unused = await probe(await get(fresh, ["fsd-default-write", "requests", "req_unused", "status"], caller), "req_unused");
      expect(await probe(await get(fresh, ["fsd-default-write", "requests", done.id, "status"], caller), done.id)).toEqual(unused);
    }
  });

  it("the identity read never hands a configured resolver the query's userId", async () => {
    // A resolver that trusts its cookie, else falls back to the body's userId.
    const lenient = (context: { request?: Request; envelope?: { metadata?: { body?: { userId?: string } } } }) => {
      const user = context.request?.headers.get("x-user") ?? context.envelope?.metadata?.body?.userId;
      return user == null ? null : { userId: user, orgId: ORG_A };
    };
    const { router } = build([threadsFlow({ authenticated: true, resolver: lenient as typeof signIn })]);
    const res = await get(router, ["threads", "identity"], {}, "?userId=admin");
    expect(res.status).toBe(401);
  });
});

// Codex review 4543388753.
describe("instances pinned to different users declaring one shared resource", () => {
  it("lets each user read and write through the instance pinned to them, whatever the registry's order", async () => {
    const kind = defineFlow({
      kind: "threads",
      cardinality: "collection",
      resources: { pins, project, notes },
      actions: { noop: { block: noop } },
      authentication: { resolvePrincipal: signIn }
    } as never);
    const registry = createFlowRegistry();
    registry.register(kind({ id: "threads.alice" } as never) as never, { pin: { orgId: ORG_A, userId: "alice" } } as never);
    registry.register(kind({ id: "threads.bob" } as never) as never, { pin: { orgId: ORG_A, userId: "bob" } } as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    routers.push(router);
    for (const caller of [alice, bob]) {
      const done = await write(router, stores, "user", "pins", caller, { input: { state: { pinned: [caller.user!] }, version: 0 } });
      expect(done.status, JSON.stringify(done.result)).toBe("completed");
      expect((await read(router, "user", "pins", caller)).value).toEqual({ pinned: [caller.user] });
      // Each writer hears their own write settle, through the instance pinned to them.
      expect((await get(router, ["fsd-default-write", "requests", done.id, "status"], caller)).status).toBe(200);
    }
    // Carol is in neither pin: the key answers as an unused one.
    const unused = await get(router, ["resources", "user", "nope"], carol);
    const pinned = await get(router, ["resources", "user", "pins"], carol);
    expect(pinned.status).toBe(unused.status);
    expect((await pinned.text()).split("pins").join("<k>")).toBe((await unused.text()).split("nope").join("<k>"));
  });
});

describe("what a direct read projects: the session snapshot's own builder", () => {
  // Codex review 4543628804.
  it("gives a content-only resource no state, exactly as the session's snapshot does", async () => {
    const doc = defineResource({
      ref: "doc",
      scope: "org",
      stateSchema: z.object({ apiKey: z.string().default(""), title: z.string().default("") }),
      client: { content: { read: true } }
    });
    const flow = defineFlow({
      kind: "docs",
      resources: { doc },
      actions: { noop: { block: noop } },
      authentication: { resolvePrincipal: signIn }
    } as never)();
    const { router, stores } = build([flow as never]);
    const { resolveResourceScopeId } = await import("../src/stores/scope-keys");
    const cell = resolveResourceScopeId({ userId: "alice", orgId: ORG_A }, { id: "docs" }, "org", false);
    await stores.resourceState.set("org", cell, "doc", { apiKey: "sk-secret", title: "Plan" }, "any");

    const created = await post(router, ["docs", "sessions"], alice, {});
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const snapshot = (await (await get(router, ["sessions", sessionId, "state"], alice)).json()) as {
      resources?: { org?: Record<string, { clientData?: unknown }> };
    };
    const direct = await get(router, ["resources", "org", "doc"], alice);
    const text = await direct.text();
    expect(text).not.toContain("sk-secret");
    // The snapshot carries no state for it, so a direct read has nothing to serve: it answers as
    // an unused key (Gitar 4543814746), never a read with no value.
    expect(snapshot.resources?.org?.doc?.clientData).toBeUndefined();
    const unused = await get(router, ["resources", "org", "nope"], alice);
    expect(direct.status).toBe(unused.status);
    expect(text.split("doc").join("<k>")).toBe((await unused.text()).split("nope").join("<k>"));
  });
});

describe("a default write's records answer to the instance that admitted it", () => {
  // Codex review 4543985105.
  it("refuses a write its declaring instances resolve to different users, rather than let them govern it apart", async () => {
    const kind = defineFlow({
      kind: "board",
      cardinality: "collection",
      resources: { pins },
      actions: { noop: { block: noop } }
    } as never);
    // One resolver for both instances: at `board.a` it answers user a, at `board.b` user b.
    const perFlow = (context: { request?: Request; envelope?: { flowKind?: string } }) =>
      context.request?.headers.get("x-user") == null
        ? null
        : { userId: context.envelope?.flowKind === "board.a" ? "a" : "b", orgId: ORG_A };
    const registry = createFlowRegistry();
    registry.register(kind({ id: "board.a" } as never) as never, { pin: { orgId: ORG_A, userId: "b" } } as never);
    registry.register(kind({ id: "board.b" } as never) as never, { pin: { orgId: ORG_A, userId: "b" } } as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, resolvePrincipal: perFlow } as never);
    routers.push(router);
    const caller = { user: "b", org: ORG_A };
    // Before one caller per address, the write landed as b through board.b and its status read was
    // governed through board.a (as a) and refused. Now the request has no one caller, so nothing runs.
    const res = await post(router, ["resources", "user", "pins", "actions", "set"], caller, {
      input: { state: { pinned: ["x"] }, version: 0 }
    });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("resolver_disagreement");
    expect(await stores.request.list({})).toEqual([]);
  });
});

describe("a send whose writer's pin refuses a caller another declarer admits", () => {
  // Cursor review 4543992827.
  it("answers exactly as an unused key, naming no writer", async () => {
    const ledger = defineResource({
      ref: "ledger",
      scope: "org",
      stateSchema: z.object({ total: z.number().default(0) }),
      client: { expose: ["total"] },
      runBy: { flow: "billing.bob" }
    });
    const kind = defineFlow({
      kind: "billing",
      cardinality: "collection",
      resources: { ledger },
      actions: { noop: { block: noop } },
      authentication: { resolvePrincipal: signIn }
    } as never);
    const registry = createFlowRegistry();
    registry.register(kind({ id: "billing.open" } as never) as never);
    registry.register(kind({ id: "billing.bob" } as never) as never, { pin: { orgId: ORG_A, userId: "bob" } } as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    routers.push(router);
    const unused = await post(router, ["resources", "org", "nope", "actions", "noop"], alice, { input: {} });
    const refused = await post(router, ["resources", "org", "ledger", "actions", "noop"], alice, { input: {} });
    expect(refused.status).toBe(unused.status);
    expect((await refused.text()).split("ledger").join("<k>")).toBe((await unused.text()).split("nope").join("<k>"));
    expect(await stores.request.list({})).toEqual([]);
  });
});

describe("two declarers that let signed-out callers in as different default users", () => {
  // Gitar review 4544162626.
  const guestFlow = (kind: string, defaultUserId: string) =>
    defineFlow({
      kind,
      resources: { project },
      actions: { noop: { block: noop } },
      authentication: { requireUser: false, defaultUserId }
    } as never)();
  /** The host's resolver: a user from a header, else no user at all. */
  const headerOnly = (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    return user == null ? { orgId: ORG_A } : { userId: user, orgId: ORG_A };
  };
  const host = () => {
    const registry = createFlowRegistry();
    registry.register(guestFlow("lobby", "visitor") as never);
    registry.register(guestFlow("porch", "guest") as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, resolvePrincipal: headerOnly } as never);
    routers.push(router);
    return { router, stores };
  };

  it("answers a signed-out caller exactly as an unused key", async () => {
    const { router } = host();
    const unused = await get(router, ["resources", "org", "nope"], {});
    const real = await get(router, ["resources", "org", "project"], {});
    expect(real.status).toBe(unused.status);
    expect((await real.text()).split("project").join("<k>")).toBe((await unused.text()).split("nope").join("<k>"));
  });

  it("refuses a signed-in caller as declarations that disagree, naming both flows", async () => {
    const { router } = host();
    const res = await get(router, ["resources", "org", "project"], alice);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("declarations_disagree");
    expect(body.message).toContain('"lobby"');
    expect(body.message).toContain('"porch"');
  });
});

describe("a default write aborted while its canWrite is pending", () => {
  // Codex review 4544189602.
  it("writes nothing once the abort lands, though canWrite then admits it", async () => {
    let release: ((ok: boolean) => void) | undefined;
    let asked = false;
    const gated = defineResource({
      ref: "gated",
      scope: "org",
      stateSchema: z.object({ n: z.number().default(0) }),
      client: { expose: ["n"] },
      runBy: "default",
      canWrite: () => {
        asked = true;
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      }
    });
    const flow = defineFlow({
      kind: "gate",
      resources: { gated },
      actions: { noop: { block: noop } },
      authentication: { resolvePrincipal: signIn }
    } as never)();
    const { router, stores } = build([flow as never]);
    const res = await post(router, ["resources", "org", "gated", "actions", "set"], alice, { input: { state: { n: 1 }, version: 0 } });
    expect(res.status).toBe(202);
    const { request } = (await res.json()) as { request: { id: string } };
    for (let i = 0; i < 200 && !asked; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(asked).toBe(true);
    const aborted = await post(router, ["fsd-default-write", "requests", request.id, "abort"], alice, {});
    expect([200, 202, 204]).toContain(aborted.status);
    release!(true);
    const done = await settle(stores, request.id);
    expect(done.status).toBe("aborted");
    expect(await read(router, "org", "gated", alice)).toEqual({ scope: "org", key: "gated", value: { n: 0 }, version: 0 });
  });
});
