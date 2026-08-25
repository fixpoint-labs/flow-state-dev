/**
 * The management surface of `/api/flows` is governed by the same
 * authentication contract as action execution.
 *
 * Only `handleExecuteAction` used to call `resolvePrincipal`. Everything else —
 * session CRUD, session state, resource content, request control, debug — was
 * addressed purely by a `sessionId` or `requestId` and reached the stores with
 * no caller identity involved. So a flow could configure a real JWT resolver,
 * pass the loopback-bind rail, bind `0.0.0.0`, and still serve every session in
 * the store to anyone who could reach the port. The rail's promise ("configure a
 * resolver before exposing this") only covered one route of the surface.
 *
 * Two properties these tests exist to hold:
 *
 *   1. **Configuring authentication protects the whole surface.** Not the action
 *      route plus an open management API beside it.
 *   2. **Not configuring it changes nothing.** An app on the framework default
 *      resolver already trusts `body.userId` on the action path; demanding a
 *      principal from its GETs would break every such app (there is no body to
 *      read a userId from) while protecting nothing that wasn't already open.
 *      Those apps are covered by the bind rail instead.
 *
 * Authentication alone is not the fix — it only changes *who* can read every
 * user's data. The ownership assertions are the ones that close the reported
 * exposure.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "../src";
import type { SessionRecord, RequestRecord, StoreRegistry } from "../src";

/**
 * A flow whose identity comes from a verified header — standing in for any real
 * resolver (JWT, bearer token, session cookie). Returning `null` without the
 * header is what makes an anonymous caller a 401.
 */
function secureFlow(kind = "secure") {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: `${kind}-run`,
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          execute: () => ({})
        })
      }
    },
    authentication: {
      resolvePrincipal: (context) => {
        const user = context.request?.headers.get("x-verified-user");
        if (user === null || user === undefined) return null;
        const org = context.request?.headers.get("x-verified-org") ?? undefined;
        return org === undefined ? { userId: user } : { userId: user, orgId: org };
      }
    }
  });
}

/** A flow with no `authentication` — falls through to the framework default resolver. */
function openFlow(kind = "open") {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: `${kind}-run`,
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          execute: () => ({})
        })
      }
    }
  });
}

function buildRouter(flows: ReturnType<typeof secureFlow>[]) {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow);
  const stores = createInMemoryStores();
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

/**
 * Same verified-header identity as `secureFlow`, but installed as the
 * host-level fallback. Cross-flow routes have no `:flowKind` to borrow a
 * resolver from, so they need this one to identify a caller at all.
 */
function buildRouterWithHostResolver(flows: ReturnType<typeof secureFlow>[]) {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({
    registry,
    stores,
    resolvePrincipal: (context) => {
      const user = context.request?.headers.get("x-verified-user");
      return user === null || user === undefined ? null : { userId: user };
    }
  });
  return { router, stores };
}

async function seedSession(
  stores: StoreRegistry,
  init: { id: string; flowKind: string; userId: string }
): Promise<void> {
  const now = Date.now();
  const record: SessionRecord = {
    id: init.id,
    flowKind: init.flowKind,
    userId: init.userId,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: []
  };
  await stores.session.set(record.id, record, "any");
}

async function seedRequest(
  stores: StoreRegistry,
  init: {
    id: string;
    flowKind: string;
    userId: string;
    status?: RequestRecord["status"];
  }
): Promise<void> {
  const now = Date.now();
  const record: RequestRecord = {
    id: init.id,
    flowKind: init.flowKind,
    actionName: "run",
    userId: init.userId,
    source: "http",
    status: init.status ?? "in_progress",
    startedAtMs: now,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now
  };
  await stores.request.set(record.id, record, "any");
}

type Router = ReturnType<typeof createFlowApiRouter>;

function call(
  router: Router,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string[],
  opts: { headers?: Record<string, string>; body?: unknown; query?: string } = {}
): Promise<Response> {
  const query = opts.query === undefined ? "" : `?${opts.query}`;
  const request = new Request(
    `http://localhost/api/flows/${path.join("/")}${query}`,
    {
      method,
      headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }
  );
  return router[method](request, { params: { path } });
}

describe("management routes under a configured resolver", () => {
  it("rejects an anonymous read of a session belonging to an authenticated flow", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });

    const res = await call(router, "GET", ["sessions", "s1"]);

    expect(res.status).toBe(401);
  });

  it("rejects an anonymous read of session state", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });

    // Session state and the journal are where conversation history and PII live.
    const res = await call(router, "GET", ["sessions", "s1", "state"]);

    expect(res.status).toBe(401);
  });

  it("rejects an anonymous delete of another user's session", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });

    const res = await call(router, "DELETE", ["sessions", "s1"]);

    expect(res.status).toBe(401);
    // The destructive half matters more than the status code: the record survives.
    expect(await stores.session.get("s1")).toBeDefined();
  });

  it("lets the owner read their own session", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });

    const res = await call(router, "GET", ["sessions", "s1"], {
      headers: { "x-verified-user": "alice" }
    });

    expect(res.status).toBe(200);
  });

  it("denies an authenticated user another user's session", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });

    // Authentication alone would let this through — bob holds a valid
    // credential. Ownership is what stops him reading alice's data.
    const res = await call(router, "GET", ["sessions", "s1"], {
      headers: { "x-verified-user": "bob" }
    });

    expect(res.status).toBe(403);
  });

  it("denies an authenticated user's write to another user's resource content", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });

    const res = await call(
      router,
      "PATCH",
      ["sessions", "s1", "resources", "doc", "topic", "content"],
      { headers: { "x-verified-user": "bob" }, body: { content: "overwritten" } }
    );

    expect(res.status).toBe(403);
  });

  it("still 404s an unknown session rather than masking it as an auth error", async () => {
    const { router } = buildRouter([secureFlow()]);

    // The guard must not change not-found semantics into 401/403 — a client
    // cleaning up after a deleted session needs the 404 it has always gotten.
    const res = await call(router, "GET", ["sessions", "ghost"], {
      headers: { "x-verified-user": "alice" }
    });

    expect(res.status).toBe(404);
  });
});

describe("listings scoped to the caller", () => {
  it("returns only the caller's sessions instead of every session in the store", async () => {
    const { router, stores } = buildRouterWithHostResolver([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });
    await seedSession(stores, { id: "s2", flowKind: "secure", userId: "bob" });

    const res = await call(router, "GET", ["sessions"], {
      headers: { "x-verified-user": "alice" }
    });
    const body = (await res.json()) as { sessions: { id: string }[] };

    expect(res.status).toBe(200);
    expect(body.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("ignores a userId query param that asks for someone else's sessions", async () => {
    const { router, stores } = buildRouterWithHostResolver([secureFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "secure", userId: "alice" });
    await seedSession(stores, { id: "s2", flowKind: "secure", userId: "bob" });

    // The filter is a convenience, not an authorization input — it must never
    // widen the result set past the principal.
    const res = await call(router, "GET", ["sessions"], {
      headers: { "x-verified-user": "alice" },
      query: "userId=bob"
    });
    const body = (await res.json()) as { sessions: { id: string }[] };

    expect(body.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("withholds an authenticated flow's rows from an anonymous cross-flow listing", async () => {
    // Mixed app: one flow authenticates, the host-level fallback is still the
    // default, so there is no way to identify the caller. Serving the secure
    // flow's sessions here would hand them out through the back door. Refusing
    // the whole route instead would take the listing away from the open flow
    // too, which is a working feature of that app.
    const { router, stores } = buildRouter([secureFlow(), openFlow()]);
    await seedSession(stores, { id: "s-secure", flowKind: "secure", userId: "alice" });
    await seedSession(stores, { id: "s-open", flowKind: "open", userId: "alice" });

    const res = await call(router, "GET", ["sessions"]);
    const body = (await res.json()) as { sessions: { id: string }[] };

    expect(res.status).toBe(200);
    expect(body.sessions.map((s) => s.id)).toEqual(["s-open"]);
  });

  it("keeps the cross-flow listing working when only a cron transport authenticates", async () => {
    // The shape that broke the kitchen-sink app: a single background flow
    // configures a resolver for its scheduled dispatch while every
    // browser-facing flow stays open. One such flow must not take the session
    // list away from the whole app.
    const { router, stores } = buildRouter([openFlow("chat"), secureFlow("digest")]);
    await seedSession(stores, { id: "s-chat", flowKind: "chat", userId: "alice" });

    const res = await call(router, "GET", ["sessions"]);
    const body = (await res.json()) as { sessions: { id: string }[] };

    expect(res.status).toBe(200);
    expect(body.sessions.map((s) => s.id)).toEqual(["s-chat"]);
  });
});

describe("session creation ownership", () => {
  it("takes the owner from the principal, not body.userId", async () => {
    const { router, stores } = buildRouter([secureFlow()]);

    // BP-031: a verified identity is not displaceable by a request field.
    // Otherwise the session is created as `alice` and every later
    // ownership check on it passes for the attacker's own credential.
    const res = await call(router, "POST", ["secure", "sessions"], {
      headers: { "x-verified-user": "bob" },
      body: { sessionId: "s-new", userId: "alice" }
    });

    expect(res.status).toBe(201);
    expect((await stores.session.get("s-new"))?.userId).toBe("bob");
  });

  it("takes orgId from the principal, not body.orgId", async () => {
    const { router, stores } = buildRouter([secureFlow()]);

    // `validateDispatch` reads the stored session's `orgId` to satisfy a flow's
    // `requiresOrg`, so a caller-set value here becomes an org binding the
    // runtime later trusts.
    const res = await call(router, "POST", ["secure", "sessions"], {
      headers: { "x-verified-user": "bob", "x-verified-org": "org-x" },
      body: { sessionId: "s-org", orgId: "org-y" }
    });

    expect(res.status).toBe(201);
    expect((await stores.session.get("s-org"))?.orgId).toBe("org-x");
  });

  it("rejects anonymous session creation on an authenticated flow", async () => {
    const { router } = buildRouter([secureFlow()]);

    const res = await call(router, "POST", ["secure", "sessions"], {
      body: { sessionId: "s-anon", userId: "alice" }
    });

    expect(res.status).toBe(401);
  });
});

describe("request-addressed routes", () => {
  it("denies aborting another user's in-flight request", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedRequest(stores, { id: "r1", flowKind: "secure", userId: "alice" });

    const res = await call(router, "POST", ["secure", "requests", "r1", "abort"], {
      headers: { "x-verified-user": "bob" }
    });

    expect(res.status).toBe(403);
  });

  it("rejects an anonymous abort", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedRequest(stores, { id: "r1", flowKind: "secure", userId: "alice" });

    const res = await call(router, "POST", ["secure", "requests", "r1", "abort"]);

    expect(res.status).toBe(401);
  });

  it("picks the resolver from the stored record, not the :flowKind in the path", async () => {
    // Both flows are registered; `open` has no resolver. The request belongs to
    // `secure`. If the guard trusted the path segment, naming `open` would skip
    // enforcement entirely and abort a secure flow's request anonymously —
    // caller-controlled input deciding an auth outcome (BP-031).
    const { router, stores } = buildRouter([secureFlow(), openFlow()]);
    await seedRequest(stores, { id: "r1", flowKind: "secure", userId: "alice" });

    const res = await call(router, "POST", ["open", "requests", "r1", "abort"]);

    expect(res.status).toBe(401);
  });

  it("authorizes from the in-flight registry before the request record lands", async () => {
    // `handleRequestStream` waits for a not-yet-persisted record rather than
    // 404ing (the POST and the GET can land on different serverless
    // instances). Without the registry fallback that wait is a window where
    // the guard finds no record and waves the caller through.
    const { router, stores } = buildRouter([secureFlow()]);
    const now = Date.now();
    await stores.activeRequests.register({
      requestId: "r-inflight",
      flowKind: "secure",
      actionName: "run",
      userId: "alice",
      source: "http",
      startedAt: now,
      lastHeartbeatAt: now
    });

    const res = await call(
      router,
      "POST",
      ["secure", "requests", "r-inflight", "abort"],
      { headers: { "x-verified-user": "bob" } }
    );

    expect(res.status).toBe(403);
  });

  it("denies retrying another user's request named under a session the caller owns", async () => {
    // `handleRetryRequest` validates tenant, status, flowKind and source, but
    // never that the request belongs to the path's session. Authorizing retry
    // on that session would let a caller pair a session they own with a
    // requestId they do not, and retry accepts an `inputOverride` — so the
    // subject has to be the request.
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s-bob", flowKind: "secure", userId: "bob" });
    await seedRequest(stores, {
      id: "r-alice",
      flowKind: "secure",
      userId: "alice",
      status: "failed"
    });

    const res = await call(
      router,
      "POST",
      ["secure", "sessions", "s-bob", "requests", "r-alice", "retry"],
      { headers: { "x-verified-user": "bob" }, body: { inputOverride: { evil: true } } }
    );

    expect(res.status).toBe(403);
  });

  it("denies continuing another user's request named under a session the caller owns", async () => {
    const { router, stores } = buildRouter([secureFlow()]);
    await seedSession(stores, { id: "s-bob", flowKind: "secure", userId: "bob" });
    await seedRequest(stores, { id: "r-alice", flowKind: "secure", userId: "alice" });

    const res = await call(
      router,
      "POST",
      ["secure", "sessions", "s-bob", "requests", "r-alice", "continue"],
      { headers: { "x-verified-user": "bob" }, body: {} }
    );

    expect(res.status).toBe(403);
  });

  it("scopes the active-request listing to the caller", async () => {
    const { router, stores } = buildRouterWithHostResolver([secureFlow()]);
    const now = Date.now();
    for (const [requestId, userId] of [
      ["r-alice", "alice"],
      ["r-bob", "bob"]
    ]) {
      await stores.activeRequests.register({
        requestId,
        flowKind: "secure",
        actionName: "run",
        userId,
        source: "http",
        startedAt: now,
        lastHeartbeatAt: now
      });
    }

    const res = await call(router, "GET", ["active-requests"], {
      headers: { "x-verified-user": "alice" }
    });
    const body = (await res.json()) as { entries: { requestId: string }[] };

    // Otherwise this enumerates other users' request and session ids.
    expect(body.entries.map((e) => e.requestId)).toEqual(["r-alice"]);
  });
});

describe("user-addressed routes", () => {
  async function registerActive(
    stores: StoreRegistry,
    init: { requestId: string; flowKind: string; userId: string }
  ): Promise<void> {
    const now = Date.now();
    await stores.activeRequests.register({
      requestId: init.requestId,
      sessionId: `s-${init.requestId}`,
      flowKind: init.flowKind,
      actionName: "run",
      userId: init.userId,
      source: "http",
      startedAt: now,
      lastHeartbeatAt: now
    });
  }

  it("does not sweep an authenticated flow's requests for an anonymous caller", async () => {
    // `check-interrupted` mutates: it flips in-flight requests to `interrupted`
    // and deregisters them. The userId comes from the path, so without scoping,
    // anyone who can reach the port can disrupt an authenticated flow's runs.
    const { router, stores } = buildRouter([secureFlow(), openFlow()]);
    await seedRequest(stores, { id: "r-victim", flowKind: "secure", userId: "victim" });
    await registerActive(stores, {
      requestId: "r-victim",
      flowKind: "secure",
      userId: "victim"
    });

    const res = await call(router, "POST", ["users", "victim", "check-interrupted"], {
      query: "staleThresholdMs=-1"
    });
    const body = (await res.json()) as { interrupted: { requestId: string }[] };

    expect(res.status).toBe(200);
    expect(body.interrupted).toEqual([]);
    // Untouched, not merely omitted from the response.
    expect((await stores.request.get("r-victim"))?.status).toBe("in_progress");
    expect(await stores.activeRequests.get("r-victim")).toBeDefined();
  });

  it("still sweeps an unauthenticated flow's requests in that same mixed app", async () => {
    // The route is scoped, not refused — the open flow it was built for keeps
    // working alongside the authenticated one.
    const { router, stores } = buildRouter([secureFlow(), openFlow()]);
    await seedRequest(stores, { id: "r-open", flowKind: "open", userId: "alice" });
    await registerActive(stores, {
      requestId: "r-open",
      flowKind: "open",
      userId: "alice"
    });

    const res = await call(router, "POST", ["users", "alice", "check-interrupted"], {
      query: "staleThresholdMs=-1"
    });
    const body = (await res.json()) as { interrupted: { requestId: string }[] };

    expect(res.status).toBe(200);
    expect(body.interrupted.map((e) => e.requestId)).toEqual(["r-open"]);
    expect((await stores.request.get("r-open"))?.status).toBe("interrupted");
  });

  it("sweeps normally in an app where nothing authenticates", async () => {
    // Every kind is unauthenticated, so scoping withholds nothing. This is the
    // posture that a blanket 401 on user routes would have broken.
    const { router, stores } = buildRouter([openFlow()]);
    await seedRequest(stores, { id: "r-solo", flowKind: "open", userId: "alice" });
    await registerActive(stores, {
      requestId: "r-solo",
      flowKind: "open",
      userId: "alice"
    });

    const res = await call(router, "POST", ["users", "alice", "check-interrupted"], {
      query: "staleThresholdMs=-1"
    });
    const body = (await res.json()) as { interrupted: { requestId: string }[] };

    expect(res.status).toBe(200);
    expect(body.interrupted.map((e) => e.requestId)).toEqual(["r-solo"]);
  });

  it("scopes the sweep to the caller's own requests once a host resolver is configured", async () => {
    const { router, stores } = buildRouterWithHostResolver([secureFlow()]);
    await seedRequest(stores, { id: "r-victim", flowKind: "secure", userId: "victim" });
    await registerActive(stores, {
      requestId: "r-victim",
      flowKind: "secure",
      userId: "victim"
    });

    const res = await call(router, "POST", ["users", "victim", "check-interrupted"], {
      query: "staleThresholdMs=-1",
      headers: { "x-verified-user": "attacker" }
    });

    expect(res.status).toBe(403);
    expect((await stores.request.get("r-victim"))?.status).toBe("in_progress");
  });
});

describe("apps on the framework default resolver", () => {
  it("serves session reads exactly as before", async () => {
    // These apps trust `body.userId` on the action path already, and their GETs
    // carry no body to authenticate from. Enforcing here would break every one
    // of them — the DevTool, `fsdev dev`, kitchen-sink — while protecting
    // nothing that wasn't already open. The bind rail is their guard.
    const { router, stores } = buildRouter([openFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "open", userId: "alice" });

    const res = await call(router, "GET", ["sessions", "s1"]);

    expect(res.status).toBe(200);
  });

  it("still lists every session, unscoped", async () => {
    const { router, stores } = buildRouter([openFlow()]);
    await seedSession(stores, { id: "s1", flowKind: "open", userId: "alice" });
    await seedSession(stores, { id: "s2", flowKind: "open", userId: "bob" });

    const res = await call(router, "GET", ["sessions"]);
    const body = (await res.json()) as { sessions: { id: string }[] };

    expect(body.sessions).toHaveLength(2);
  });

  it("still takes the session owner from body.userId", async () => {
    const { router, stores } = buildRouter([openFlow()]);

    const res = await call(router, "POST", ["open", "sessions"], {
      body: { sessionId: "s-open", userId: "alice" }
    });

    expect(res.status).toBe(201);
    expect((await stores.session.get("s-open"))?.userId).toBe("alice");
  });

  it("leaves an unauthenticated flow's sessions open in a mixed app", async () => {
    // Only the cross-flow routes fail closed in a mixed app. A route addressed
    // into the `open` flow is governed by that flow's (absent) resolver, so it
    // behaves as its author configured it.
    const { router, stores } = buildRouter([secureFlow(), openFlow()]);
    await seedSession(stores, { id: "s-open", flowKind: "open", userId: "alice" });

    const res = await call(router, "GET", ["sessions", "s-open"]);

    expect(res.status).toBe(200);
  });
});

describe("public metadata routes", () => {
  it("stay reachable without a principal", async () => {
    // The flow list and capabilities carry no user data and are what a client
    // reads before it can authenticate anything.
    const { router } = buildRouter([secureFlow()]);

    expect((await call(router, "GET", [])).status).toBe(200);
    expect((await call(router, "GET", ["capabilities"])).status).toBe(200);
  });
});
