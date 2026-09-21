/**
 * C4 — the organization boundary on the management surface (FIX-1442).
 *
 * `management-route-auth.test.ts` proved the USER half of this: a caller may
 * only reach records they own. That check passes for the case this file exists
 * for — one person who belongs to two organizations, holding a session id from
 * one of them and asking for it while acting as the other. Same `userId` on
 * both sides, so ownership matches and the record is served across a boundary
 * the app believes it has.
 *
 * So these are refusals, and the point of each is the refusal. Where a test
 * asserts a 200, it is there to show the refusal is not simply "deny
 * everything" — the same caller, in the right organization, still gets served.
 *
 * BR-8 (addressed records), BR-9 (listings), BR-10 (no-auth routes), BR-13
 * (one user, two organizations).
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src";

/** Identity comes from two verified headers; absent user means anonymous. */
function twoAxisFlow(kind = "secure") {
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
        return {
          userId: user,
          orgId: context.request?.headers.get("x-verified-org") ?? undefined
        };
      }
    }
  });
}

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

function buildRouter(flows: ReturnType<typeof twoAxisFlow>[]) {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow);
  const stores = createInMemoryStores();
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

/**
 * The same verified-header identity installed host-level. A cross-flow listing
 * has no `:flowKind` to borrow a resolver from, so it needs this one to
 * identify a caller — and therefore an organization — at all.
 */
function buildRouterWithHostResolver(flows: ReturnType<typeof twoAxisFlow>[]) {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({
    registry,
    stores,
    resolvePrincipal: (context) => {
      const user = context.request?.headers.get("x-verified-user");
      if (user === null || user === undefined) return null;
      return {
        userId: user,
        orgId: context.request?.headers.get("x-verified-org") ?? undefined
      };
    }
  });
  return { router, stores };
}

async function seedSession(
  stores: StoreRegistry,
  init: { id: string; flowKind: string; flowId?: string; userId: string; orgId?: string }
): Promise<void> {
  const now = Date.now();
  const record: SessionRecord = {
    id: init.id,
    flowKind: init.flowKind,
    flowId: init.flowId ?? init.flowKind,
    userId: init.userId,
    ...(init.orgId === undefined ? {} : { orgId: init.orgId }),
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
    flowId?: string;
    userId: string;
    orgId?: string;
    sessionId?: string;
    status?: RequestRecord["status"];
  }
): Promise<void> {
  const now = Date.now();
  const record: RequestRecord = {
    id: init.id,
    flowKind: init.flowKind,
    flowId: init.flowId ?? init.flowKind,
    actionName: "run",
    userId: init.userId,
    ...(init.orgId === undefined ? {} : { orgId: init.orgId }),
    ...(init.sessionId === undefined ? {} : { sessionId: init.sessionId }),
    input: {},
    status: init.status ?? "completed",
    startedAtMs: now,
    createdAt: now,
    updatedAt: now
  } as RequestRecord;
  await stores.request.set(record.id, record, "any");
}

type Router = ReturnType<typeof createFlowApiRouter>;

/** Issue a management request as `user`, optionally acting for `org`. */
function call(
  router: Router,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string[],
  as: { user?: string; org?: string } = {},
  query?: string
): Promise<Response> {
  const request = new Request(
    `http://localhost/api/flows/${path.join("/")}${query === undefined ? "" : `?${query}`}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        ...(as.user === undefined ? {} : { "x-verified-user": as.user }),
        ...(as.org === undefined ? {} : { "x-verified-org": as.org })
      }
    }
  );
  return router[method](request, { params: { path } });
}

describe("C4 · the organization boundary on the management surface", () => {
  describe("BR-8/BR-13 · one user in two organizations", () => {
    it("refuses a session read from the same user acting as another organization", async () => {
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedSession(stores, {
        id: "s1",
        flowKind: "secure",
        userId: "dana",
        orgId: "acme"
      });

      const response = await call(router, "GET", ["sessions", "s1"], {
        user: "dana",
        org: "globex"
      });

      expect(response.status).toBe(403);
    });

    it("serves the same session to the same user in its own organization", async () => {
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedSession(stores, {
        id: "s1",
        flowKind: "secure",
        userId: "dana",
        orgId: "acme"
      });

      const response = await call(router, "GET", ["sessions", "s1"], {
        user: "dana",
        org: "acme"
      });

      expect(response.status).toBe(200);
    });

    it("refuses deleting another organization's session, and leaves it in the store", async () => {
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedSession(stores, {
        id: "s1",
        flowKind: "secure",
        userId: "dana",
        orgId: "acme"
      });

      const response = await call(router, "DELETE", ["sessions", "s1"], {
        user: "dana",
        org: "globex"
      });

      expect(response.status).toBe(403);
      expect(await stores.session.get("s1")).toBeDefined();
    });

    it("refuses reading another organization's session state before emitting content", async () => {
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedSession(stores, {
        id: "s1",
        flowKind: "secure",
        userId: "dana",
        orgId: "acme"
      });

      const response = await call(router, "GET", ["sessions", "s1", "state"], {
        user: "dana",
        org: "globex"
      });

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("journal");
    });

    it("refuses a request-addressed route across the organization boundary", async () => {
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedRequest(stores, {
        id: "r1",
        flowKind: "secure",
        userId: "dana",
        orgId: "acme",
        sessionId: "s1"
      });

      const response = await call(router, "GET", ["secure", "requests", "r1", "status"], {
        user: "dana",
        org: "globex"
      });

      expect(response.status).toBe(403);
    });
  });

  describe("BR-9 · listings are scoped to the caller's organization", () => {
    it("omits another organization's sessions from the caller's listing", async () => {
      const { router, stores } = buildRouterWithHostResolver([twoAxisFlow()]);
      await seedSession(stores, { id: "mine", flowKind: "secure", userId: "dana", orgId: "acme" });
      await seedSession(stores, {
        id: "theirs",
        flowKind: "secure",
        userId: "dana",
        orgId: "globex"
      });

      const response = await call(router, "GET", ["sessions"], {
        user: "dana",
        org: "acme"
      });
      const body = (await response.json()) as { sessions: { id: string }[] };

      expect(body.sessions.map((s) => s.id)).toEqual(["mine"]);
    });

    it("cannot be widened by an orgId query parameter", async () => {
      const { router, stores } = buildRouterWithHostResolver([twoAxisFlow()]);
      await seedSession(stores, { id: "mine", flowKind: "secure", userId: "dana", orgId: "acme" });
      await seedSession(stores, {
        id: "theirs",
        flowKind: "secure",
        userId: "dana",
        orgId: "globex"
      });

      const response = await call(
        router,
        "GET",
        ["sessions"],
        { user: "dana", org: "acme" },
        "orgId=globex"
      );
      const body = (await response.json()) as { sessions: { id: string }[] };

      expect(body.sessions.map((s) => s.id)).toEqual(["mine"]);
    });
  });

  describe("BR-14 · records stored before organizations were required", () => {
    it("refuses an unattributed session with migration guidance rather than serving it", async () => {
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedSession(stores, { id: "legacy", flowKind: "secure", userId: "dana" });

      const response = await call(router, "GET", ["sessions", "legacy"], {
        user: "dana",
        org: "acme"
      });
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(409);
      expect(body.error).toBe("migration-required");
    });

    it("leaves the unattributed record untouched after refusing it", async () => {
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedSession(stores, { id: "legacy", flowKind: "secure", userId: "dana" });
      const before = await stores.session.get("legacy");

      await call(router, "GET", ["sessions", "legacy"], { user: "dana", org: "acme" });

      expect(await stores.session.get("legacy")).toEqual(before);
    });

    it("withholds unattributed rows from an anonymous listing too, not only an authenticated one", async () => {
      // The listing and the addressed read have to agree. A row the addressed
      // route refuses with `migration-required` must not be handed out by the
      // listing beside it — otherwise the refusal is a formality anyone routes
      // around by listing instead of reading.
      const { router, stores } = buildRouter([twoAxisFlow(), openFlow()]);
      await seedSession(stores, { id: "legacy", flowKind: "open", userId: "u1" });
      await seedSession(stores, {
        id: "ok",
        flowKind: "open",
        userId: "u1",
        orgId: DEFAULT_ORG_ID
      });

      const listing = await call(router, "GET", ["sessions"]);
      const body = (await listing.json()) as { sessions: { id: string }[] };
      const addressed = await call(router, "GET", ["sessions", "legacy"]);

      expect(addressed.status).toBe(409);
      expect(body.sessions.map((s) => s.id)).toEqual(["ok"]);
    });

    it("does not answer an anonymous caller differently for a legacy record than for any other", async () => {
      // The 409 is a refusal that names something about the record, so it is
      // owed only to a caller who has proven who they are. Handed to an
      // anonymous one it is an oracle: probe an id, and 409 tells you a record
      // exists AND that it predates organizations, where an attributed one
      // answers 401. Both must look the same from outside.
      const { router, stores } = buildRouter([twoAxisFlow()]);
      await seedSession(stores, { id: "legacy", flowKind: "secure", userId: "dana" });
      await seedSession(stores, { id: "attributed", flowKind: "secure", userId: "dana", orgId: "acme" });

      const legacy = await call(router, "GET", ["sessions", "legacy"]);
      const attributed = await call(router, "GET", ["sessions", "attributed"]);

      expect(legacy.status).toBe(attributed.status);
      expect(legacy.status).toBe(401);
    });

    it("omits unattributed rows from a listing instead of failing the whole listing", async () => {
      const { router, stores } = buildRouterWithHostResolver([twoAxisFlow()]);
      await seedSession(stores, { id: "legacy", flowKind: "secure", userId: "dana" });
      await seedSession(stores, { id: "ok", flowKind: "secure", userId: "dana", orgId: "acme" });

      const response = await call(router, "GET", ["sessions"], {
        user: "dana",
        org: "acme"
      });
      const body = (await response.json()) as { sessions: { id: string }[] };

      expect(response.status).toBe(200);
      expect(body.sessions.map((s) => s.id)).toEqual(["ok"]);
    });
  });

  describe("BR-8/BR-13 · the sweep that mutates", () => {
    /**
     * `check-interrupted` is the one management route that WRITES: it marks
     * in-flight requests `interrupted`. It is user-addressed, so ownership
     * matches for a person who belongs to two organizations — which is exactly
     * the shape BR-13 names. A read served across that boundary leaks; a sweep
     * served across it destroys the other organization's running work.
     */
    async function seedStaleRun(
      stores: StoreRegistry,
      init: { requestId: string; userId: string; orgId: string }
    ): Promise<void> {
      await seedRequest(stores, {
        id: init.requestId,
        flowKind: "secure",
        userId: init.userId,
        orgId: init.orgId,
        sessionId: `${init.requestId}-session`,
        status: "in_progress"
      });
      await stores.activeRequests.register({
        requestId: init.requestId,
        flowKind: "secure",
        flowId: "secure",
        actionName: "run",
        sessionId: `${init.requestId}-session`,
        userId: init.userId,
        orgId: init.orgId,
        source: "http",
        input: {},
        startedAt: Date.now() - 600_000,
        lastHeartbeatAt: Date.now() - 600_000
      });
    }

    it("leaves another organization's in-flight request running", async () => {
      const { router, stores } = buildRouterWithHostResolver([twoAxisFlow()]);
      await seedStaleRun(stores, { requestId: "theirs", userId: "dana", orgId: "globex" });

      const response = await call(router, "POST", ["users", "dana", "check-interrupted"], {
        user: "dana",
        org: "acme"
      });
      const body = (await response.json()) as { interrupted: { requestId: string }[] };

      expect(body.interrupted.map((i) => i.requestId)).toEqual([]);
      expect((await stores.request.get("theirs"))?.status).toBe("in_progress");
      expect(await stores.activeRequests.get("theirs")).toBeDefined();
    });

    it("still sweeps the caller's own organization", async () => {
      const { router, stores } = buildRouterWithHostResolver([twoAxisFlow()]);
      await seedStaleRun(stores, { requestId: "mine", userId: "dana", orgId: "acme" });

      const response = await call(router, "POST", ["users", "dana", "check-interrupted"], {
        user: "dana",
        org: "acme"
      });
      const body = (await response.json()) as { interrupted: { requestId: string }[] };

      expect(body.interrupted.map((i) => i.requestId)).toEqual(["mine"]);
      expect((await stores.request.get("mine"))?.status).toBe("interrupted");
    });
  });

  describe("BR-10 · an app with no authentication reads only the default organization", () => {
    it("serves a session stored under the framework default", async () => {
      const { router, stores } = buildRouter([openFlow()]);
      await seedSession(stores, {
        id: "s1",
        flowKind: "open",
        userId: "u1",
        orgId: DEFAULT_ORG_ID
      });

      const response = await call(router, "GET", ["sessions", "s1"]);

      expect(response.status).toBe(200);
    });
  });
});
