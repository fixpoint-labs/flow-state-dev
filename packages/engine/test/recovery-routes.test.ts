import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
import { parseFlowRoute } from "../src/routes/parseFlowRoute";
import type { StoreRegistry } from "../src/stores/types";

describe("parseFlowRoute — recovery routes", () => {
  it("parses retry_request route", () => {
    // POST /api/flows/:flowKind/sessions/:sessionId/requests/:requestId/retry
    const route = parseFlowRoute("POST", [
      "chat", "sessions", "sess_1", "requests", "req_1", "retry"
    ]);

    expect(route).toEqual({
      kind: "retry_request",
      flowKind: "chat",
      sessionId: "sess_1",
      requestId: "req_1"
    });
  });

  it("parses continue_request route", () => {
    // POST /api/flows/:flowKind/sessions/:sessionId/requests/:requestId/continue
    const route = parseFlowRoute("POST", [
      "chat", "sessions", "sess_1", "requests", "req_1", "continue"
    ]);

    expect(route).toEqual({
      kind: "continue_request",
      flowKind: "chat",
      sessionId: "sess_1",
      requestId: "req_1"
    });
  });

  it("does not match continue with wrong method", () => {
    const route = parseFlowRoute("GET", [
      "chat", "sessions", "sess_1", "requests", "req_1", "continue"
    ]);
    expect(route.kind).toBe("not_found");
  });

  it("parses active_requests route", () => {
    // GET /api/flows/active-requests
    const route = parseFlowRoute("GET", ["active-requests"]);
    expect(route).toEqual({ kind: "active_requests" });
  });

  it("does not match retry with wrong method", () => {
    const route = parseFlowRoute("GET", [
      "chat", "sessions", "sess_1", "requests", "req_1", "retry"
    ]);
    expect(route.kind).toBe("not_found");
  });

  it("does not match active_requests with POST", () => {
    const route = parseFlowRoute("POST", ["active-requests"]);
    expect(route.kind).toBe("not_found");
  });

  it("parses check_interrupted_requests route", () => {
    // POST /api/flows/users/:userId/check-interrupted
    const route = parseFlowRoute("POST", ["users", "alice", "check-interrupted"]);
    expect(route).toEqual({
      kind: "check_interrupted_requests",
      userId: "alice"
    });
  });

  it("does not match check_interrupted_requests with GET", () => {
    const route = parseFlowRoute("GET", ["users", "alice", "check-interrupted"]);
    expect(route.kind).toBe("not_found");
  });
});

/**
 * `check-interrupted` WRITES: whatever it counts as stale is marked
 * `interrupted` and deregistered. On an open flow any caller who names a
 * userId reaches it, so the caller's `staleThresholdMs` must not be able to
 * call a run dead that the server still considers alive. The caller's value may
 * only widen the heartbeat window past the host's threshold, never tighten it.
 *
 * Every case runs in an all-open app with an anonymous caller: the posture
 * where no identity check stands between a stranger and another user's runs.
 */
describe("check-interrupted: a caller's staleThresholdMs cannot tighten the host's window", () => {
  const HOST_THRESHOLD_MS = 60_000;
  const USER_ID = "victim";

  function buildOpenApp() {
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "open",
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({
              name: "open-run",
              execute: (_input: Record<string, never>): { ok: true } => ({ ok: true } as const)
            })
          }
        }
      })({ id: "open" })
    );
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({
      registry,
      stores,
      detectInterruptedOnStartup: false,
      staleSweepIntervalMs: 0,
      staleSweepThresholdMs: HOST_THRESHOLD_MS
    });
    return { router, stores };
  }

  /** An in-flight run whose worker last heartbeat `heartbeatAgoMs` ago. */
  async function seedRun(
    stores: StoreRegistry,
    requestId: string,
    heartbeatAgoMs: number
  ): Promise<void> {
    const at = Date.now() - heartbeatAgoMs;
    await stores.activeRequests.register({
      requestId,
      orgId: DEFAULT_ORG_ID,
      flowKind: "open",
      flowId: "open",
      actionName: "run",
      sessionId: `s-${requestId}`,
      userId: USER_ID,
      source: "http",
      startedAt: at,
      lastHeartbeatAt: at
    });
    await stores.request.set(
      requestId,
      {
        id: requestId,
        orgId: DEFAULT_ORG_ID,
        flowKind: "open",
        flowId: "open",
        actionName: "run",
        sessionId: `s-${requestId}`,
        userId: USER_ID,
        source: "http",
        status: "in_progress",
        startedAtMs: at,
        state: {},
        version: 0,
        createdAt: at,
        updatedAt: at
      },
      "any"
    );
  }

  function poke(
    router: ReturnType<typeof buildOpenApp>["router"],
    query: string
  ): Promise<Response> {
    return router.POST(
      new Request(`http://localhost/api/flows/users/${USER_ID}/check-interrupted${query}`, {
        method: "POST"
      }),
      { params: { path: ["users", USER_ID, "check-interrupted"] } }
    );
  }

  async function sweptIds(res: Response): Promise<string[]> {
    expect(res.status).toBe(200);
    const body = (await res.json()) as { interrupted: Array<{ requestId: string }> };
    return body.interrupted.map((i) => i.requestId);
  }

  it.each([
    // The exploit as reported: every heartbeating run counts as stale.
    { label: "zero", value: "0", heartbeatAgoMs: 0 },
    { label: "negative", value: "-1", heartbeatAgoMs: 0 },
    { label: "a large negative", value: "-600000", heartbeatAgoMs: 1_000 },
    // Positive but tighter than the host: 45s of silence is healthy to the
    // server, so a caller's 1s window must not reap it.
    { label: "below the host threshold", value: "1000", heartbeatAgoMs: 45_000 }
  ])(
    "leaves a live run running when staleThresholdMs is $label",
    async ({ value, heartbeatAgoMs }) => {
      const { router, stores } = buildOpenApp();
      await seedRun(stores, "r-live", heartbeatAgoMs);

      const swept = await sweptIds(await poke(router, `?staleThresholdMs=${value}`));

      // Neither disclosed nor written: the run is still in progress and still
      // registered, so its liveness read keeps answering "alive".
      expect(swept).toEqual([]);
      expect((await stores.request.get("r-live"))?.status).toBe("in_progress");
      expect(await stores.activeRequests.get("r-live")).toBeDefined();
    }
  );

  it.each([
    { label: "zero", query: "?staleThresholdMs=0" },
    { label: "negative", query: "?staleThresholdMs=-1" },
    { label: "absent", query: "" }
  ])(
    "still sweeps a run the host considers dead when staleThresholdMs is $label",
    async ({ query }) => {
      // The other direction (BP-035): holding the floor must not stop the
      // route reaping what the server itself would reap.
      const { router, stores } = buildOpenApp();
      await seedRun(stores, "r-dead", 10 * 60_000);
      await seedRun(stores, "r-live", 1_000);

      const swept = await sweptIds(await poke(router, query));

      expect(swept).toEqual(["r-dead"]);
      expect((await stores.request.get("r-dead"))?.status).toBe("interrupted");
      expect(await stores.activeRequests.get("r-dead")).toBeUndefined();
      expect((await stores.request.get("r-live"))?.status).toBe("in_progress");
    }
  );

  it("honours a value above the host threshold, sparing a run the host would reap", async () => {
    const { router, stores } = buildOpenApp();
    // Past the host's 60s, inside the caller's 5 minutes.
    await seedRun(stores, "r-quiet", 90_000);
    // Past both.
    await seedRun(stores, "r-dead", 10 * 60_000);

    const swept = await sweptIds(await poke(router, "?staleThresholdMs=300000"));

    expect(swept).toEqual(["r-dead"]);
    expect((await stores.request.get("r-quiet"))?.status).toBe("in_progress");
    expect(await stores.activeRequests.get("r-quiet")).toBeDefined();
  });

  it("rejects a value that is not a number with 400 and sweeps nothing", async () => {
    const { router, stores } = buildOpenApp();
    await seedRun(stores, "r-dead", 10 * 60_000);

    const res = await poke(router, "?staleThresholdMs=soon");

    expect(res.status).toBe(400);
    expect((await stores.request.get("r-dead"))?.status).toBe("in_progress");
  });
});

/**
 * `check-interrupted` answers only what that one call swept, so a request the
 * startup sweep or the periodic sweeper marked first never appears in it. A
 * caller recovering after a crash needs the records themselves: the read lists
 * the user's interrupted requests every time it is asked, whoever marked them.
 *
 * The flow is registered under an instance id that differs from its kind, the
 * way a collection flow's instance is, so `flowId` is told apart from
 * `flowKind`.
 */
describe("GET /users/:userId/interrupted-requests", () => {
  const USER_ID = "alice";

  it("parses list_interrupted_requests", () => {
    expect(parseFlowRoute("GET", ["users", "alice", "interrupted-requests"])).toEqual({
      kind: "list_interrupted_requests",
      userId: "alice"
    });
  });

  function buildApp() {
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "chat",
        cardinality: "collection",
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({
              name: "chat-run",
              execute: (_input: Record<string, never>): { ok: true } => ({ ok: true } as const)
            })
          }
        }
      })({ id: "chat-a" })
    );
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({
      registry,
      stores,
      detectInterruptedOnStartup: false,
      staleSweepIntervalMs: 0,
      staleSweepThresholdMs: 1_000
    });
    return { router, stores };
  }

  async function seedRecord(
    stores: StoreRegistry,
    id: string,
    overrides: { status?: "interrupted" | "in_progress" | "completed"; userId?: string; flowId?: string | null } = {}
  ): Promise<void> {
    const at = Date.now() - 60_000;
    const flowId = overrides.flowId === undefined ? "chat-a" : overrides.flowId;
    await stores.request.set(
      id,
      {
        id,
        orgId: DEFAULT_ORG_ID,
        flowKind: "chat",
        ...(flowId === null ? {} : { flowId }),
        actionName: "run",
        sessionId: `s-${id}`,
        userId: overrides.userId ?? USER_ID,
        source: "http",
        status: overrides.status ?? "interrupted",
        startedAtMs: at,
        state: {},
        version: 0,
        createdAt: at,
        updatedAt: at
      },
      "any"
    );
  }

  type Entry = {
    requestId: string;
    sessionId?: string;
    flowKind: string;
    flowId: string;
    actionName: string;
    interruptedAt: number;
  };

  async function read(router: ReturnType<typeof buildApp>["router"]): Promise<Entry[]> {
    const res = await router.GET(
      new Request(`http://localhost/api/flows/users/${USER_ID}/interrupted-requests`),
      { params: { path: ["users", USER_ID, "interrupted-requests"] } }
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { interrupted: Entry[] }).interrupted;
  }

  it("lists a request a sweep already marked, on every read", async () => {
    const { router, stores } = buildApp();
    await seedRecord(stores, "r-run", { status: "in_progress" });
    const stale = Date.now() - 60_000;
    await stores.activeRequests.register({
      requestId: "r-run",
      orgId: DEFAULT_ORG_ID,
      flowKind: "chat",
      flowId: "chat-a",
      actionName: "run",
      sessionId: "s-r-run",
      userId: USER_ID,
      source: "http",
      startedAt: stale,
      lastHeartbeatAt: stale
    });

    // The sweep marks it, and answers it once.
    const poke = () =>
      router.POST(
        new Request(`http://localhost/api/flows/users/${USER_ID}/check-interrupted`, { method: "POST" }),
        { params: { path: ["users", USER_ID, "check-interrupted"] } }
      );
    expect(((await (await poke()).json()) as { interrupted: unknown[] }).interrupted).toHaveLength(1);
    expect(((await (await poke()).json()) as { interrupted: unknown[] }).interrupted).toHaveLength(0);

    // The read still lists it, the second time too.
    for (let i = 0; i < 2; i += 1) {
      const entries = await read(router);
      expect(entries).toEqual([
        {
          requestId: "r-run",
          sessionId: "s-r-run",
          flowKind: "chat",
          flowId: "chat-a",
          actionName: "run",
          interruptedAt: expect.any(Number)
        }
      ]);
    }
  });

  it("lists only this user's interrupted requests", async () => {
    const { router, stores } = buildApp();
    await seedRecord(stores, "r-mine");
    await seedRecord(stores, "r-running", { status: "in_progress" });
    await seedRecord(stores, "r-done", { status: "completed" });
    await seedRecord(stores, "r-theirs", { userId: "bob" });

    expect((await read(router)).map((e) => e.requestId)).toEqual(["r-mine"]);
  });

  it("falls back to the flow kind for a record written before the instance id", async () => {
    const { router, stores } = buildApp();
    await seedRecord(stores, "r-legacy", { flowId: null });

    const [entry] = await read(router);
    expect(entry).toMatchObject({ requestId: "r-legacy", flowKind: "chat", flowId: "chat" });
  });

  it("check-interrupted's own list names the instance id too", async () => {
    const { router, stores } = buildApp();
    await seedRecord(stores, "r-run", { status: "in_progress" });
    const stale = Date.now() - 60_000;
    await stores.activeRequests.register({
      requestId: "r-run",
      orgId: DEFAULT_ORG_ID,
      flowKind: "chat",
      flowId: "chat-a",
      actionName: "run",
      sessionId: "s-r-run",
      userId: USER_ID,
      source: "http",
      startedAt: stale,
      lastHeartbeatAt: stale
    });
    const res = await router.POST(
      new Request(`http://localhost/api/flows/users/${USER_ID}/check-interrupted`, { method: "POST" }),
      { params: { path: ["users", USER_ID, "check-interrupted"] } }
    );
    const body = (await res.json()) as { interrupted: Array<{ flowId: string }> };
    expect(body.interrupted).toEqual([expect.objectContaining({ requestId: "r-run", flowId: "chat-a" })]);
  });
});
