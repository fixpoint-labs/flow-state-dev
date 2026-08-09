/**
 * FIX-1046 — the session-requests listing must not serve a request belonging
 * to a different flow than the session it sits in.
 *
 * The leak was three shipped behaviours composing. Nothing binds a request's
 * flow kind to its session's: the adopt-an-existing-session branch of
 * `createExecutionContext` validates user, org and tenant, and the engine
 * defines no flow-kind binding error. The action route takes `sessionId` from
 * the path or the body, so a caller authorized for a protected flow can run it
 * inside a session created under a permissive one. And route authorization for
 * a session-addressed route picks its resolver from the **session's** flow
 * kind — which, for a permissive flow, is the framework default, returning
 * ALLOWED with no principal and no ownership check.
 *
 * So listing that session's requests handed back the protected flow's request,
 * items included, to a caller who was never authorized for it.
 *
 * These tests deliberately do NOT pin the current authorization outcome as
 * correct — that behaviour is the defect. What they pin is that the listing
 * itself no longer returns a foreign-flow request.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "../src";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src";

function flow(kind: string, authenticated: boolean) {
  const base = {
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
  };
  if (!authenticated) return defineFlow(base);
  return defineFlow({
    ...base,
    authentication: {
      resolvePrincipal: (context) => {
        const user = context.request?.headers.get("x-verified-user");
        return user === null || user === undefined ? null : { userId: user };
      }
    }
  });
}

function build(): { router: ReturnType<typeof createFlowApiRouter>; stores: StoreRegistry } {
  const registry = createFlowRegistry();
  registry.register(flow("open", false));
  registry.register(flow("protected", true));
  const stores = createInMemoryStores();
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

async function seedSession(
  stores: StoreRegistry,
  id: string,
  flowKind: string
): Promise<void> {
  const record: SessionRecord = {
    id,
    flowKind,
    userId: "alice",
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    journal: []
  };
  await stores.session.set(id, record, "any");
}

async function seedRequest(
  stores: StoreRegistry,
  id: string,
  sessionId: string,
  flowKind: string
): Promise<void> {
  const record: RequestRecord = {
    id,
    flowKind,
    actionName: "run",
    userId: "alice",
    sessionId,
    source: "http",
    status: "completed",
    startedAtMs: 1,
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 1
  };
  await stores.request.set(id, record, "any");
}

function listRequests(
  router: ReturnType<typeof createFlowApiRouter>,
  sessionId: string,
  query = ""
): Promise<Response> {
  const path = ["sessions", sessionId, "requests"];
  return router.GET(
    new Request(`http://localhost/api/flows/${path.join("/")}${query}`),
    { params: { path } }
  );
}

describe("session-requests listing conjoins the session's flow kind", () => {
  it("withholds a protected flow's request from a permissive flow's session", async () => {
    const { router, stores } = build();
    await seedSession(stores, "sess", "open");
    await seedRequest(stores, "req_ours", "sess", "open");
    // The record the leak turned on: dispatched under the protected flow, but
    // recorded inside a session stored under the open one. Reachable by an
    // ordinary caller, because dispatch enforces no flow binding.
    await seedRequest(stores, "req_theirs", "sess", "protected");

    const res = await listRequests(router, "sess", "?include_items=true");
    expect(res.status).toBe(200);
    const { requests } = (await res.json()) as { requests: RequestRecord[] };
    expect(requests.map((r) => r.id)).toEqual(["req_ours"]);
  });

  it("still returns every request whose flow kind matches its session's", async () => {
    const { router, stores } = build();
    await seedSession(stores, "sess", "open");
    await seedRequest(stores, "req_1", "sess", "open");
    await seedRequest(stores, "req_2", "sess", "open");

    const { requests } = (await (await listRequests(router, "sess")).json()) as {
      requests: RequestRecord[];
    };
    expect(requests.map((r) => r.id).sort()).toEqual(["req_1", "req_2"]);
  });

  it("scopes a protected session's listing to its own flow too", async () => {
    const { router, stores } = build();
    await seedSession(stores, "sess", "protected");
    await seedRequest(stores, "req_ours", "sess", "protected");
    await seedRequest(stores, "req_foreign", "sess", "open");

    const res = await listRequests(router, "sess");
    // The reverse direction was never the leak — this session's resolver
    // authenticates — but the filter is a property of the query, not of who
    // happens to be asking.
    expect(res.status).toBe(401);

    const authorized = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess/requests", {
        headers: { "x-verified-user": "alice" }
      }),
      { params: { path: ["sessions", "sess", "requests"] } }
    );
    const { requests } = (await authorized.json()) as { requests: RequestRecord[] };
    expect(requests.map((r) => r.id)).toEqual(["req_ours"]);
  });
});
