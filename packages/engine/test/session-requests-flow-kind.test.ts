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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter
} from "../src";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src";
import { SESSION_STREAM_TIMINGS } from "../src/routes/session-stream-routes";

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
        return user === null || user === undefined ? null : { userId: user, orgId: "org_test" };
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

/**
 * The organization a record on `flowKind` would really have been written with.
 * The `open` flow configures no resolver, so the runtime stamps its records
 * with the framework default; `protected` authenticates and names its own.
 */
function orgOf(flowKind: string): string {
  return flowKind === "open" ? DEFAULT_ORG_ID : "org_test";
}

async function seedSession(
  stores: StoreRegistry,
  id: string,
  flowKind: string,
  flowId?: string
): Promise<void> {
  const record: SessionRecord = {
    id,
    flowKind,
    ...(flowId === undefined ? {} : { flowId }),
    userId: "alice",
    orgId: orgOf(flowKind),
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
  flowKind: string,
  extra: { text?: string; flowId?: string; orgId?: string; userId?: string } = {}
): Promise<void> {
  const { text, flowId } = extra;
  const record: RequestRecord = {
    id,
    flowKind,
    ...(flowId === undefined ? {} : { flowId }),
    // One finished message, so a read that serves this request's items shows it.
    ...(text === undefined
      ? {}
      : {
          items: [
            {
              id: `${id}_msg`,
              type: "message",
              role: "assistant",
              status: "completed",
              requestId: id,
              itemIndex: 0,
              ts: 1,
              provenance: { blockName: "b", blockInstanceId: "b", phase: "main" },
              content: [{ type: "output_text", text }]
            } as unknown as OutputItem
          ]
        }),
    actionName: "run",
    userId: extra.userId ?? "alice",
    orgId: extra.orgId ?? orgOf(flowKind),
    sessionId,
    source: "http",
    status: "completed",
    startedAtMs: 1,
    state: {},
    version: 0,
    createdAt: 1,
    // Recent, so the session stream's first read reaches it.
    updatedAt: Date.now()
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
    // recorded inside a session stored under the open one. Admission now
    // refuses that dispatch; a session written before it can still hold one.
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

/**
 * The listing reads a session's requests under the same scope as its snapshot
 * and stream, and as the history a run in it loads: its owner and organization
 * too, not only its flow. A request row under the session's id from another
 * user or organization is one admission refused, or one an earlier session
 * under the same id left behind; it is not this session's to list.
 */
describe("session-requests listing keeps to the session's owner and organization", () => {
  it("withholds another user's and another organization's request under the session's id", async () => {
    const { router, stores } = build();
    await seedSession(stores, "sess", "open");
    await seedRequest(stores, "req_ours", "sess", "open");
    await seedRequest(stores, "req_bob", "sess", "open", { userId: "bob" });
    await seedRequest(stores, "req_other_org", "sess", "open", { orgId: "org_other" });

    const res = await listRequests(router, "sess", "?include_items=true");
    expect(res.status).toBe(200);
    const { requests } = (await res.json()) as { requests: RequestRecord[] };
    expect(requests.map((r) => r.id)).toEqual(["req_ours"]);
  });
});

/**
 * The same rule on the session's other two reads of its requests: the
 * snapshot with items, and the live stream. Admission now refuses a run of
 * another flow into a session, so the mix cannot be written today, but a
 * session written before that check can hold one. These seed exactly that
 * legacy shape (no owning instance on either record) and read it as the
 * caller the session's open flow admits: anyone.
 */
describe("a session's snapshot and stream conjoin its flow as the listing does", () => {
  const shipped = { ...SESSION_STREAM_TIMINGS };

  beforeEach(() => {
    SESSION_STREAM_TIMINGS.intervalMs = 25;
  });

  afterEach(() => {
    Object.assign(SESSION_STREAM_TIMINGS, shipped);
  });

  /**
   * An open session holding its own request and, from before admission
   * checked it, a protected one. Same owner and organization as the session,
   * as a run admitted into it then would have: only the flow tells them apart.
   */
  async function seedMixed(stores: StoreRegistry): Promise<void> {
    await seedSession(stores, "sess", "open");
    await seedRequest(stores, "req_ours", "sess", "open", { text: "our note" });
    await seedRequest(stores, "req_theirs", "sess", "protected", {
      text: "protected secret",
      orgId: orgOf("open")
    });
  }

  function snapshot(router: ReturnType<typeof createFlowApiRouter>): Promise<Response> {
    return router.GET(
      new Request("http://localhost/api/flows/sessions/sess/state?include_items=true"),
      { params: { path: ["sessions", "sess", "state"] } }
    );
  }

  it("keeps a protected flow's items out of an open session's snapshot", async () => {
    const { router, stores } = build();
    await seedMixed(stores);

    const res = await snapshot(router);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("our note");
    expect(body).not.toContain("protected secret");
  });

  it("keeps a protected flow's items out of an open session's stream", async () => {
    const { router, stores } = build();
    await seedMixed(stores);

    const controller = new AbortController();
    const res = await router.GET(
      new Request("http://localhost/api/flows/sessions/sess/stream?since=0", {
        signal: controller.signal
      }),
      { params: { path: ["sessions", "sess", "stream"] } }
    );
    expect(res.status).toBe(200);
    setTimeout(() => controller.abort(), SESSION_STREAM_TIMINGS.intervalMs * 4);
    const body = await res.text();
    expect(body).toContain("our note");
    expect(body).not.toContain("protected secret");
    await disposeFlowApiRouter(router);
  });

  it("still shows a session with an owning instance its own requests", async () => {
    const { router, stores } = build();
    await seedSession(stores, "sess", "open", "open");
    await seedRequest(stores, "req_ours", "sess", "open", { text: "our note", flowId: "open" });

    const res = await snapshot(router);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("our note");
  });
});
