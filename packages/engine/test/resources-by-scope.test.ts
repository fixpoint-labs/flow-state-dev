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
import { createInMemoryStores } from "../src/host";
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
  client: {}
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
    expect(res.status).toBe(401);
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
