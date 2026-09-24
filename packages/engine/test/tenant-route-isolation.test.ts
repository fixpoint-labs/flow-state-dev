/**
 * FIX-682 HTTP-route isolation. The session/state/resource routes namespace by
 * the `x-tenant-id` header, surface bare session ids, and 404 on a tenant
 * mismatch (including the crafted `${tenant}:${id}` key-collision probe). A
 * tenant id containing `:` is rejected with 400. The user-addressed
 * `check-interrupted` sweep reads and writes only the calling tenant's entries.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "../src";

function makeFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: boolean }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  })({ id: kind });
}

function createRouter() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(makeFlow("demo"));
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

function createSession(
  router: ReturnType<typeof createRouter>["router"],
  sessionId: string,
  tenantId?: string
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  return router.POST(
    new Request("http://localhost/api/flows/demo/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ userId: "u", sessionId })
    }),
    { params: { path: ["demo", "sessions"] } }
  );
}

function getSession(
  router: ReturnType<typeof createRouter>["router"],
  sessionId: string,
  tenantId?: string
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  return router.GET(
    new Request(`http://localhost/api/flows/sessions/${sessionId}`, { headers }),
    { params: { path: ["sessions", sessionId] } }
  );
}

describe("tenant route isolation (FIX-682)", () => {
  it("resolves the same session id to distinct records per tenant, with bare ids", async () => {
    const { router } = createRouter();
    expect((await createSession(router, "s", "acme")).status).toBe(201);
    expect((await createSession(router, "s", "globex")).status).toBe(201);

    const acmeRes = await getSession(router, "s", "acme");
    const globexRes = await getSession(router, "s", "globex");
    expect(acmeRes.status).toBe(200);
    expect(globexRes.status).toBe(200);

    const acme = (await acmeRes.json()) as { session: { id: string; tenantId?: string } };
    const globex = (await globexRes.json()) as { session: { id: string; tenantId?: string } };
    // Bare id surfaced, distinct underlying records.
    expect(acme.session.id).toBe("s");
    expect(acme.session.tenantId).toBe("acme");
    expect(globex.session.tenantId).toBe("globex");
  });

  it("404s a GET with the wrong or absent tenant header", async () => {
    const { router } = createRouter();
    await createSession(router, "s", "acme");

    // Different tenant — distinct namespace, no record.
    expect((await getSession(router, "s", "globex")).status).toBe(404);
    // No tenant header at all.
    expect((await getSession(router, "s")).status).toBe(404);
  });

  it("404s the crafted key-collision probe (no header, tenant-prefixed session id)", async () => {
    const { router } = createRouter();
    await createSession(router, "s", "acme"); // stored under key "acme:s"

    // A no-tenant caller crafts sessionId "acme:s" to collide on the key —
    // the binding check rejects it as 404, never returning acme's session.
    const res = await getSession(router, "acme:s");
    expect(res.status).toBe(404);
  });

  it("lists only the calling tenant's sessions, with bare ids", async () => {
    const { router } = createRouter();
    await createSession(router, "s", "acme");
    await createSession(router, "s", "globex");

    const res = await router.GET(
      new Request("http://localhost/api/flows/sessions", {
        headers: { "x-tenant-id": "acme" }
      }),
      { params: { path: ["sessions"] } }
    );
    const body = (await res.json()) as { sessions: Array<{ id: string; tenantId?: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.id).toBe("s");
    expect(body.sessions[0]?.tenantId).toBe("acme");
  });

  it("does not delete another tenant's session on a mismatched DELETE", async () => {
    const { router, stores } = createRouter();
    await createSession(router, "s", "acme");

    const del = await router.DELETE(
      new Request("http://localhost/api/flows/sessions/s", {
        method: "DELETE"
      }), // no tenant header
      { params: { path: ["sessions", "s"] } }
    );
    expect(del.status).toBe(404);
    // Acme's record survives.
    expect(await stores.session.get("acme:s")).not.toBeUndefined();
  });

  it("rejects a tenant id containing ':' with 400", async () => {
    const { router } = createRouter();
    const res = await createSession(router, "s", "ac:me");
    expect(res.status).toBe(400);
  });

  // The retry/continue routes only ever compared the bare sessionId; a caller
  // in one tenant who learns another tenant's requestId (logs, UI) could
  // re-dispatch or re-enter that tenant's request under a colliding bare
  // session id. These pin the fix: both routes must 404 on a tenant mismatch,
  // exactly like the webhook-sourced-record checks beside them.
  describe("retry/continue routes reject a cross-tenant requestId", () => {
    async function seedInterruptedRequest(
      stores: ReturnType<typeof createRouter>["stores"],
      tenantId: string
    ) {
      const now = Date.now();
      await stores.request.set(
        "req_1",
        {
    orgId: DEFAULT_ORG_ID,
          id: "req_1",
          flowKind: "demo",
          actionName: "run",
          sessionId: "s",
          tenantId,
          userId: "u",
          source: "http",
          status: "interrupted",
          startedAtMs: now,
          state: {},
          version: 0,
          createdAt: now,
          updatedAt: now
        },
        "any"
      );
    }

    it("404s a retry of another tenant's request under a colliding bare session id", async () => {
      const { router, stores } = createRouter();
      await seedInterruptedRequest(stores, "acme");

      const res = await router.POST(
        new Request("http://localhost/api/flows/demo/sessions/s/requests/req_1/retry", {
          method: "POST",
          headers: { "x-tenant-id": "globex" },
          body: "{}"
        }),
        { params: { path: ["demo", "sessions", "s", "requests", "req_1", "retry"] } }
      );
      expect(res.status).toBe(404);
    });

    it("404s a retry of another tenant's request with no tenant header", async () => {
      const { router, stores } = createRouter();
      await seedInterruptedRequest(stores, "acme");

      const res = await router.POST(
        new Request("http://localhost/api/flows/demo/sessions/s/requests/req_1/retry", {
          method: "POST",
          body: "{}"
        }),
        { params: { path: ["demo", "sessions", "s", "requests", "req_1", "retry"] } }
      );
      expect(res.status).toBe(404);
    });

    it("404s a continue of another tenant's request under a colliding bare session id", async () => {
      const { router, stores } = createRouter();
      await seedInterruptedRequest(stores, "acme");

      const res = await router.POST(
        new Request("http://localhost/api/flows/demo/sessions/s/requests/req_1/continue", {
          method: "POST",
          headers: { "x-tenant-id": "globex" },
          body: "{}"
        }),
        { params: { path: ["demo", "sessions", "s", "requests", "req_1", "continue"] } }
      );
      expect(res.status).toBe(404);
    });

    it("404s a continue of another tenant's request with no tenant header", async () => {
      const { router, stores } = createRouter();
      await seedInterruptedRequest(stores, "acme");

      const res = await router.POST(
        new Request("http://localhost/api/flows/demo/sessions/s/requests/req_1/continue", {
          method: "POST",
          body: "{}"
        }),
        { params: { path: ["demo", "sessions", "s", "requests", "req_1", "continue"] } }
      );
      expect(res.status).toBe(404);
    });
  });

  // `check-interrupted` is user-addressed, and the same user id (in the same
  // organization) can hold in-flight requests in more than one tenant. The
  // sweep WRITES: whatever it admits is marked `interrupted` and deregistered.
  // So a caller on one tenant must neither see nor sweep another tenant's
  // stale entries, while their own tenant's stale entries still get swept.
  describe("check-interrupted sweeps only the calling tenant's entries", () => {
    async function seedStaleRun(
      stores: ReturnType<typeof createRouter>["stores"],
      requestId: string,
      tenantId: string | undefined,
      orgId: string = DEFAULT_ORG_ID
    ) {
      const stale = Date.now() - 600_000;
      await stores.request.set(
        requestId,
        {
          orgId,
          id: requestId,
          flowKind: "demo",
          flowId: "demo",
          actionName: "run",
          sessionId: `${requestId}-session`,
          ...(tenantId === undefined ? {} : { tenantId }),
          userId: "u",
          source: "http",
          status: "in_progress",
          startedAtMs: stale,
          state: {},
          version: 0,
          createdAt: stale,
          updatedAt: stale
        },
        "any"
      );
      await stores.activeRequests.register({
        requestId,
        flowKind: "demo",
        flowId: "demo",
        actionName: "run",
        sessionId: `${requestId}-session`,
        userId: "u",
        orgId,
        ...(tenantId === undefined ? {} : { tenantId }),
        source: "http",
        input: {},
        startedAt: stale,
        lastHeartbeatAt: stale
      });
    }

    async function checkInterrupted(
      router: ReturnType<typeof createRouter>["router"],
      headers: Record<string, string>
    ): Promise<string[]> {
      const res = await router.POST(
        new Request("http://localhost/api/flows/users/u/check-interrupted", {
          method: "POST",
          headers
        }),
        { params: { path: ["users", "u", "check-interrupted"] } }
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        interrupted: Array<{ requestId: string; sessionId?: string }>;
      };
      return body.interrupted.map((i) => i.requestId);
    }

    /**
     * Same user and organization on both tenants, resolved host-level. A
     * resolver may not return the framework default org, so this uses a real one.
     */
    function createRouterWithHostResolver() {
      const registry = createFlowRegistry();
      const stores = createInMemoryStores();
      registry.register(makeFlow("demo"));
      const router = createFlowApiRouter({
        registry,
        stores,
        resolvePrincipal: (context) => {
          const user = context.request?.headers.get("x-verified-user");
          if (user === null || user === undefined) return null;
          return { userId: user, orgId: "org_1" };
        }
      });
      return { router, stores };
    }

    async function expectOnlyOwnTenantSwept(
      setup: ReturnType<typeof createRouter>,
      headers: Record<string, string>,
      orgId: string
    ) {
      const { router, stores } = setup;
      await seedStaleRun(stores, "acme_req", "acme", orgId);
      await seedStaleRun(stores, "globex_req", "globex", orgId);

      const swept = await checkInterrupted(router, { ...headers, "x-tenant-id": "acme" });

      // Globex's entry is not disclosed to an acme caller...
      expect(swept).not.toContain("globex_req");
      // ...and nothing of globex's was written: its live request is still
      // running and still registered.
      expect((await stores.request.get("globex_req"))?.status).toBe("in_progress");
      expect(await stores.activeRequests.get("globex_req")).toBeDefined();
      // The caller's own stale entry is still swept.
      expect(swept).toEqual(["acme_req"]);
      expect((await stores.request.get("acme_req"))?.status).toBe("interrupted");
      expect(await stores.activeRequests.get("acme_req")).toBeUndefined();
    }

    it("leaves another tenant's live request untouched (framework default resolver)", async () => {
      await expectOnlyOwnTenantSwept(createRouter(), {}, DEFAULT_ORG_ID);
    });

    it("leaves another tenant's live request untouched (host resolver, same user and org)", async () => {
      await expectOnlyOwnTenantSwept(
        createRouterWithHostResolver(),
        { "x-verified-user": "u" },
        "org_1"
      );
    });

    it("a caller with no tenant header sweeps only rows with no tenant", async () => {
      const { router, stores } = createRouter();
      await seedStaleRun(stores, "untenanted_req", undefined);
      await seedStaleRun(stores, "acme_req", "acme");

      const swept = await checkInterrupted(router, {});

      expect(swept).toEqual(["untenanted_req"]);
      expect((await stores.request.get("untenanted_req"))?.status).toBe("interrupted");
      expect((await stores.request.get("acme_req"))?.status).toBe("in_progress");
      expect(await stores.activeRequests.get("acme_req")).toBeDefined();
    });
  });
});
