/**
 * FIX-682 HTTP-route isolation. The session/state/resource routes namespace by
 * the `x-tenant-id` header, surface bare session ids, and 404 on a tenant
 * mismatch (including the crafted `${tenant}:${id}` key-collision probe). A
 * tenant id containing `:` is rejected with 400.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
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
});
