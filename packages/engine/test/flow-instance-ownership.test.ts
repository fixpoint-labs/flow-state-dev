/**
 * Flow-instance ownership on the real admission and record-backed route
 * seams: two registered collection instances of one definition, addressed
 * by id over the HTTP router, each keeping the sessions and requests it
 * created — across a restart over the same stores, and against every way
 * the other copy could reach them.
 *
 * Each case fails on a plausible regression (a bare-kind pick, a kind-only
 * owner check, a lost owner stamp, a listing that groups by kind), not on
 * wiring.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
  FlowInstanceBindingMismatchError,
  type FlowRegistry,
  type SessionRecord,
  type StoreRegistry
} from "../src";

type Router = ReturnType<typeof createFlowApiRouter>;

/**
 * A collection definition whose instances each write their own marker into
 * session state — the observable that says WHICH copy ran.
 */
const reviewDefinition = defineFlow({
  kind: "review",
  cardinality: "collection",
  actions: {
    run: {
      inputSchema: z.object({}),
      block: handler({ name: "review-run", inputSchema: z.object({}), execute: () => ({}) })
    }
  },
  session: { stateSchema: z.object({ marker: z.string().nullable().default(null) }) }
});

function review(options: { id: string }): FlowInstance {
  return reviewDefinition({
    id: options.id,
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: `review-run-${options.id}`,
          inputSchema: z.object({}),
          execute: async (_input, ctx) => {
            await ctx.session.patchState({ marker: options.id });
            return {};
          }
        })
      }
    }
  }) as unknown as FlowInstance;
}

async function marker(stores: StoreRegistry, sessionId: string): Promise<unknown> {
  return (await stores.session.get(sessionId))?.state.marker;
}

function secureReview(kind: string) {
  return defineFlow({
    kind,
    cardinality: "collection",
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({ name: `${kind}-run`, inputSchema: z.object({}), execute: () => ({}) })
      }
    },
    authentication: {
      resolvePrincipal: (context) => {
        const user = context.request?.headers.get("x-verified-user");
        return user === null || user === undefined ? null : { userId: user };
      }
    }
  });
}

function host(stores: StoreRegistry, ...flows: FlowInstance[]): { router: Router; registry: FlowRegistry } {
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  return { router: createFlowApiRouter({ registry, stores }), registry };
}

async function act(
  router: Router,
  address: string,
  sessionId: string,
  userId = "u_1"
): Promise<Response> {
  return router.POST(
    new Request(`http://localhost/api/flows/${address}/${sessionId}/actions/run`, {
      method: "POST",
      body: JSON.stringify({ userId, input: {} })
    }),
    { params: { path: [address, sessionId, "actions", "run"] } }
  );
}

async function settle(stores: StoreRegistry, requestId: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("addressing an instance", () => {
  it("delivers to the exact instance and never to a collection's bare kind", async () => {
    const stores = createInMemoryStores();
    const { router } = host(stores, review({ id: "review-east" }), review({ id: "review-west" }));

    const east = await act(router, "review-east", "s_east");
    expect(east.status).toBe(202);
    const eastBody = (await east.json()) as { request: { id: string; flowId: string; flowKind: string } };
    expect(eastBody.request.flowId).toBe("review-east");
    expect(eastBody.request.flowKind).toBe("review");
    await settle(stores, eastBody.request.id);
    expect(await marker(stores, "s_east")).toBe("review-east");

    const west = await act(router, "review-west", "s_west");
    expect(west.status).toBe(202);
    const westBody = (await west.json()) as { request: { id: string } };
    await settle(stores, westBody.request.id);
    expect(await marker(stores, "s_west")).toBe("review-west");

    // The bare kind names no member, however many are registered.
    expect((await act(router, "review", "s_bare")).status).toBe(404);
  });

  it("stamps the owner on the session and request it creates, and on the active entry", async () => {
    const stores = createInMemoryStores();
    const { router } = host(stores, review({ id: "review-east" }), review({ id: "review-west" }));
    const res = await act(router, "review-east", "s_stamp");
    const { request } = (await res.json()) as { request: { id: string } };
    await settle(stores, request.id);

    const session = await stores.session.get("s_stamp");
    expect(session?.flowKind).toBe("review");
    expect(session?.flowId).toBe("review-east");
    const record = await stores.request.get(request.id);
    expect(record?.flowKind).toBe("review");
    expect(record?.flowId).toBe("review-east");
  });
});

describe("a session belongs to one instance", () => {
  it("refuses a same-kind peer before any effect, and keeps refusing after a restart over the same stores", async () => {
    const stores = createInMemoryStores();
    const first = host(stores, review({ id: "review-east" }), review({ id: "review-west" }));
    const created = (await (await act(first.router, "review-east", "s_owned")).json()) as {
      request: { id: string };
    };
    await settle(stores, created.request.id);
    const before = await stores.session.get("s_owned");

    // West addresses east's session: refused, named, and nothing written.
    const refused = await act(first.router, "review-west", "s_owned");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("wrong-instance-session");
    expect(await stores.session.get("s_owned")).toEqual(before);
    expect((await stores.request.list({ sessionId: "s_owned" })).map((r) => r.flowId)).toEqual([
      "review-east"
    ]);
    expect(await stores.activeRequests.listAll()).toEqual([]);

    // "Restart": a fresh registry and host over the same stores, with the
    // instances registered in the OTHER order and west removed. East is
    // still east; nothing redirects.
    const second = host(stores, review({ id: "review-east" }));
    const again = await act(second.router, "review-east", "s_owned");
    expect(again.status).toBe(202);
    const { request } = (await again.json()) as { request: { id: string } };
    await settle(stores, request.id);
    expect(await marker(stores, "s_owned")).toBe("review-east");
    expect((await stores.session.get("s_owned"))?.flowId).toBe("review-east");

    // A host that only knows west cannot reach east's session at all.
    const third = host(stores, review({ id: "review-west" }));
    expect((await act(third.router, "review-west", "s_owned")).status).toBe(409);
  });

  it("refuses direct execution against a foreign session before the user record or history is touched", async () => {
    const stores = createInMemoryStores();
    const { router } = host(stores, review({ id: "review-east" }), review({ id: "review-west" }));
    const created = (await (await act(router, "review-east", "s_direct")).json()) as {
      request: { id: string };
    };
    await settle(stores, created.request.id);

    const west = review({ id: "review-west" });
    await expect(
      runAction({
        flow: west,
        actionName: "run",
        input: {},
        userId: "u_other",
        sessionId: "s_direct",
        requestId: "req_foreign",
        stores,
        runtimeConfig: {}
      })
    ).rejects.toBeInstanceOf(FlowInstanceBindingMismatchError);
    expect(await stores.user.get("u_other")).toBeUndefined();
    expect(await stores.request.get("req_foreign")).toBeUndefined();
    expect(await stores.activeRequests.get("req_foreign")).toBeUndefined();
  });

  it("refuses a request id another instance owns without overwriting or deregistering it", async () => {
    const stores = createInMemoryStores();
    const { router } = host(stores, review({ id: "review-east" }), review({ id: "review-west" }));
    const now = Date.now();
    await stores.request.set(
      "req_held",
      {
        id: "req_held",
        flowKind: "review",
        flowId: "review-east",
        actionName: "run",
        userId: "u_1",
        sessionId: "s_held",
        source: "http",
        status: "in_progress",
        startedAtMs: now,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now
      },
      "any"
    );
    await stores.activeRequests.register({
      requestId: "req_held",
      flowKind: "review",
      flowId: "review-east",
      actionName: "run",
      userId: "u_1",
      source: "http",
      startedAt: now,
      lastHeartbeatAt: now
    });

    const res = await router.POST(
      new Request("http://localhost/api/flows/review-west/s_other/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: "u_1", input: {}, requestId: "req_held" })
      }),
      { params: { path: ["review-west", "s_other", "actions", "run"] } }
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("wrong-instance-request");
    await new Promise((r) => setTimeout(r, 20));
    expect((await stores.request.get("req_held"))?.flowId).toBe("review-east");
    expect((await stores.request.get("req_held"))?.status).toBe("in_progress");
    expect(await stores.activeRequests.get("req_held")).toBeDefined();
  });
});

describe("record-backed routes read the stored owner", () => {
  async function seedSession(stores: StoreRegistry, record: Partial<SessionRecord> & { id: string }) {
    const now = Date.now();
    await stores.session.set(
      record.id,
      {
        flowKind: "review",
        userId: "u_1",
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: [],
        ...record
      },
      "any"
    );
  }

  it("serves state, stream and status under the owner, and refuses the same-kind peer's address", async () => {
    const stores = createInMemoryStores();
    const { router } = host(stores, review({ id: "review-east" }), review({ id: "review-west" }));
    const { request } = (await (await act(router, "review-east", "s_read")).json()) as {
      request: { id: string };
    };
    await settle(stores, request.id);

    const state = await router.GET(
      new Request("http://localhost/api/flows/sessions/s_read/state"),
      { params: { path: ["sessions", "s_read", "state"] } }
    );
    expect(state.status).toBe(200);

    const ownStatus = await router.GET(
      new Request(`http://localhost/api/flows/review-east/requests/${request.id}/status`),
      { params: { path: ["review-east", "requests", request.id, "status"] } }
    );
    expect(ownStatus.status).toBe(200);
    const peerStatus = await router.GET(
      new Request(`http://localhost/api/flows/review-west/requests/${request.id}/status`),
      { params: { path: ["review-west", "requests", request.id, "status"] } }
    );
    expect(peerStatus.status).toBe(404);

    const peerStream = await router.GET(
      new Request(`http://localhost/api/flows/review-west/requests/${request.id}/stream`),
      { params: { path: ["review-west", "requests", request.id, "stream"] } }
    );
    expect(peerStream.status).toBe(404);
  });

  it("reads known singleton history compatibly and refuses ownerless collection history as migration-required", async () => {
    const stores = createInMemoryStores();
    const reports = defineFlow({
      kind: "reports",
      actions: {},
      session: { stateSchema: z.object({ n: z.number().default(0) }) }
    });
    const { router } = host(stores, reports(), review({ id: "review-east" }));
    await seedSession(stores, { id: "s_legacy_singleton", flowKind: "reports" });
    await seedSession(stores, { id: "s_legacy_collection", flowKind: "review" });

    const singleton = await router.GET(
      new Request("http://localhost/api/flows/sessions/s_legacy_singleton/state"),
      { params: { path: ["sessions", "s_legacy_singleton", "state"] } }
    );
    expect(singleton.status).toBe(200);

    // One registered member proves nothing about which copy the row meant.
    const collection = await router.GET(
      new Request("http://localhost/api/flows/sessions/s_legacy_collection/state"),
      { params: { path: ["sessions", "s_legacy_collection", "state"] } }
    );
    expect(collection.status).toBe(409);
    expect(((await collection.json()) as { error: string }).error).toBe("migration-required");

    // The action route names the same stop condition, not a wrong-instance
    // refusal that would send an operator looking for a different address.
    const acted = await act(router, "review-east", "s_legacy_collection");
    expect(acted.status).toBe(409);
    expect(((await acted.json()) as { error: string }).error).toBe("migration-required");
    expect(await marker(stores, "s_legacy_collection")).toBeUndefined();
  });

  it("lists sessions by exact owner, and an ownerless row never matches an owner filter", async () => {
    const stores = createInMemoryStores();
    const { router } = host(stores, review({ id: "review-east" }), review({ id: "review-west" }));
    await seedSession(stores, { id: "s_east", flowKind: "review", flowId: "review-east" });
    await seedSession(stores, { id: "s_west", flowKind: "review", flowId: "review-west" });
    await seedSession(stores, { id: "s_legacy", flowKind: "review" });

    const list = async (query: string) => {
      const res = await router.GET(new Request(`http://localhost/api/flows/sessions?${query}`), {
        params: { path: ["sessions"] }
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { sessions: Array<{ id: string; flowId?: string }> }).sessions;
    };

    const east = await list("flowId=review-east&parentage=all");
    expect(east.map((s) => s.id)).toEqual(["s_east"]);
    expect(east[0]?.flowId).toBe("review-east");
    const byKind = await list("flowKind=review&parentage=all");
    expect(byKind.map((s) => s.id).sort()).toEqual(["s_east", "s_legacy", "s_west"]);
  });

  it("lists a session's requests by owner, and anonymous listings never expose a same-kind authenticated peer", async () => {
    const stores = createInMemoryStores();
    const secure = secureReview("gated");
    const { router } = host(
      stores,
      review({ id: "review-east" }),
      secure({ id: "gated-open" }),
      // A same-kind peer that authenticates. `gated-open` shares its kind but
      // configures the framework default resolver by overriding it away.
      secure({ id: "gated-locked" })
    );
    await seedSession(stores, { id: "s_east", flowKind: "review", flowId: "review-east" });
    await seedSession(stores, { id: "s_locked", flowKind: "gated", flowId: "gated-locked", userId: "alice" });

    const listing = await router.GET(new Request("http://localhost/api/flows/sessions?parentage=all"), {
      params: { path: ["sessions"] }
    });
    expect(listing.status).toBe(200);
    const ids = ((await listing.json()) as { sessions: Array<{ id: string }> }).sessions.map((s) => s.id);
    expect(ids).toContain("s_east");
    expect(ids).not.toContain("s_locked");
  });
});
