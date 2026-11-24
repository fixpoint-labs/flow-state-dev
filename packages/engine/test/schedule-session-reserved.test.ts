// FIX-2886 D1.
/**
 * A schedule's session is the scheduled dispatch's alone to create and run in.
 *
 * Its id is derived from public values (the user, the org, the flow and the
 * schedule id), so anyone who knows them can compute it. If another user could
 * create it first, the engine would refuse every fire of the schedule as a
 * user mismatch and the poll would stop. So the create route, the action route
 * and every transport dispatch refuse it, unless the dispatch is the scheduled
 * transport's own; public re-entry refuses a request in it, since a re-run
 * would skip the overlap check. Unlike a write session, its owner still lists
 * and reads it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, type StoreRegistry } from "../src";
import { createInboundTransportHost, createInMemoryStores } from "../src/host";
import { asServerResourceSend } from "../src/resources/default-write-flow";
import { scheduleSessionId } from "../src/transports/scheduled/schedule-session-id";
import { recentTimes } from "./transports/scheduled/recent-times";

const ORG = "org-a";
const SECRET = "scheduler-secret";
const HOURLY = "0 * * * *";
const { latest: LATEST, previous: PREVIOUS } = recentTimes(HOURLY);

/** Whether the next fire fails; cleared by the fire that reads it. */
let failNext = false;

const poll = handler({
  name: "poll",
  inputSchema: z.object({}).passthrough(),
  execute: () => {
    if (failNext) {
      failNext = false;
      throw new Error("provider unavailable");
    }
    return { ok: true };
  }
});
const noop = handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({}) });

/** The scheduler signs in with the bearer secret; a person with `x-user`. */
const signIn = (context: { request?: Request }) => {
  if (context.request?.headers.get("authorization") === `Bearer ${SECRET}`) return { userId: "system", orgId: ORG };
  const user = context.request?.headers.get("x-user");
  return user == null ? null : { userId: user, orgId: ORG };
};

function build() {
  const flow = defineFlow({
    kind: "threads",
    actions: { noop: { block: noop } },
    authentication: { resolvePrincipal: signIn },
    schedules: {
      // `<user>/poll`: a poll per user, run as that user in one session.
      resolve: (id: string) => {
        const match = /^([a-z]+)\/poll$/.exec(id);
        return match === null
          ? null
          : { cron: HOURLY, block: poll, session: "per-schedule" as const, onOverlap: "allow" as const, principal: { userId: match[1]!, orgId: ORG } };
      }
    }
  } as never)();
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores, registry, flow };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  failNext = false;
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

type Router = ReturnType<typeof createFlowApiRouter>;

function call(router: Router, method: string, path: string[], headers: Record<string, string>, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const handlerFor = (router as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[method];
  return handlerFor!(request, { params: { path } });
}

const as = (user: string, tenant?: string) => ({ "x-user": user, ...(tenant === undefined ? {} : { "x-tenant-id": tenant }) });

async function firePoll(router: Router, user: string, nominalFireTime: string): Promise<string> {
  const res = await call(router, "POST", ["threads", "schedules", `${user}/poll`, "dispatch"], { authorization: `Bearer ${SECRET}` }, { nominalFireTime });
  const body = (await res.json()) as { status: string; requestId: string };
  expect(body.status, JSON.stringify(body)).toBe("accepted");
  return body.requestId;
}

async function settle(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

/** Alice's poll session: computable by anyone who knows her id, the org and the flow. */
const alicesPollSession = scheduleSessionId({ orgId: ORG, userId: "alice", flowId: "threads", scheduleId: "alice/poll" });

describe("another user can't take a schedule's session first", () => {
  it("refuses bob's create at alice's poll session, bare and tenant-namespaced, and leaves no row", async () => {
    const { router, stores } = build();
    for (const [sessionId, headers] of [
      [alicesPollSession, as("bob")],
      [`t1:${alicesPollSession}`, as("bob")],
      [alicesPollSession, as("bob", "t1")]
    ] as const) {
      const res = await call(router, "POST", ["threads", "sessions"], headers, { sessionId });
      expect(res.status, `${sessionId} ${JSON.stringify(headers)}`).toBe(400);
    }
    expect(await stores.session.list({})).toEqual([]);
    // Alice's poll still runs, in its session.
    const fired = await settle(stores, await firePoll(router, "alice", LATEST));
    expect(fired).toMatchObject({ status: "completed", sessionId: alicesPollSession });
  });

  it("refuses an action sent to a schedule's session, by body and by path, bare and namespaced", async () => {
    const { router, stores } = build();
    await settle(stores, await firePoll(router, "alice", LATEST));
    const before = JSON.stringify(await stores.request.list({}));
    for (const user of ["bob", "alice"]) {
      for (const sessionId of [alicesPollSession, `t1:${alicesPollSession}`]) {
        const byBody = await call(router, "POST", ["threads", "actions", "noop"], as(user), { sessionId, input: {} });
        expect(byBody.status, `${user} body ${sessionId}`).toBe(400);
        const byPath = await call(router, "POST", ["threads", sessionId, "actions", "noop"], as(user), { input: {} });
        expect(byPath.status, `${user} path ${sessionId}`).toBe(400);
      }
    }
    expect(JSON.stringify(await stores.request.list({}))).toBe(before);
  });
});

describe("a transport dispatch reaches a schedule's session only from the scheduled transport", () => {
  const envelope = (source: string, sessionId: string) => ({
    source,
    flowKind: "threads",
    action: "noop",
    input: {},
    sessionId,
    principal: { userId: "alice", orgId: ORG }
  });

  function hostOf(registry: ReturnType<typeof build>["registry"], stores: StoreRegistry) {
    return createInboundTransportHost({ registry, stores, resolvePrincipal: signIn as never, runtimeConfig: {} });
  }

  it("refuses any other source, bare and tenant-namespaced", async () => {
    const { registry, stores } = build();
    const host = hostOf(registry, stores);
    for (const sessionId of [alicesPollSession, `t1:${alicesPollSession}`]) {
      for (const source of ["mcp", "http", "webhook", "internal"]) {
        await expect(host.validateDispatch(envelope(source, sessionId) as never)).rejects.toThrow(/schedule session/);
        expect(() => host.dispatch(envelope(source, sessionId) as never)).toThrow(/schedule session/);
      }
    }
    expect(await stores.session.list({})).toEqual([]);
  });

  it("refuses the server's own resource send too", async () => {
    const { registry, stores } = build();
    const host = hostOf(registry, stores);
    expect(() => host.dispatch(asServerResourceSend(envelope("http", alicesPollSession)) as never)).toThrow(/schedule session/);
  });

  it("admits a scheduled-source dispatch", async () => {
    const { registry, stores } = build();
    const host = hostOf(registry, stores);
    await expect(host.validateDispatch(envelope("scheduled", alicesPollSession) as never)).resolves.toBeUndefined();
  });
});

describe("the owner still lists and reads a schedule's session", () => {
  it("lists it, reads it and reads its requests", async () => {
    const { router, stores } = build();
    const requestId = await firePoll(router, "alice", LATEST);
    await settle(stores, requestId);
    const listed = (await (await call(router, "GET", ["sessions"], as("alice"))).json()) as { sessions: { id: string }[] };
    expect(listed.sessions.map((session) => session.id)).toContain(alicesPollSession);
    expect((await call(router, "GET", ["sessions", alicesPollSession], as("alice"))).status).toBe(200);
    const requests = (await (await call(router, "GET", ["sessions", alicesPollSession, "requests"], as("alice"))).json()) as {
      requests: { id: string }[];
    };
    expect(requests.requests.map((request) => request.id)).toEqual([requestId]);
  });
});

describe("public re-entry in a schedule's session", () => {
  it("refuses a retry of a failed fire, and lists it not retryable", async () => {
    const { router, stores } = build();
    failNext = true;
    const failed = await firePoll(router, "alice", PREVIOUS);
    expect((await settle(stores, failed)).status).toBe("failed");
    const retry = await call(router, "POST", ["threads", "sessions", alicesPollSession, "requests", failed, "retry"], as("alice"), {});
    expect(retry.status).toBe(404);
    const resume = await call(router, "POST", ["threads", "requests", failed, "resume"], as("alice"), { suspensionId: "x" });
    expect(resume.status).toBe(404);
    const continued = await call(router, "POST", ["threads", "sessions", alicesPollSession, "requests", failed, "continue"], as("alice"), {});
    expect(continued.status).toBe(404);
    const listed = (await (await call(router, "GET", ["sessions", alicesPollSession, "requests"], as("alice"))).json()) as {
      requests: { id: string; retryable: boolean }[];
    };
    expect(listed.requests).toEqual([expect.objectContaining({ id: failed, retryable: false })]);
    // Nothing re-ran: the session still holds the one failed fire.
    expect((await stores.request.list({ sessionId: alicesPollSession })).map((request) => request.id)).toEqual([failed]);
  });
});
