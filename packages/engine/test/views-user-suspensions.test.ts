// FIX-2770.
/**
 * A user view on `sessions.userSuspensions`, through the view route and the
 * change bus.
 *
 * Why it matters: this is the Inbox's read. It must hear only a suspension
 * written or deleted, so a worker streaming a reply or a turn starting
 * elsewhere never re-runs it (D1); a suspension answered must leave on the notice
 * the answer publishes, with no refresh; and a suspension on a flow instance whose
 * own sign-in refuses this caller must not be listed, whether or not it waits
 * in a session (the store matched its ids, but only the instance can say it
 * would accept this caller).
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineView, handler, sequencer } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createInMemoryStores } from "../src/host";
import { withChangeBus } from "../src/bus/publish-writes";
import type { ChangeNotice } from "../src/bus/types";
import { hearsNotice, type ViewHearing } from "@flow-state-dev/contracts/types/view-hearing";
import type { WireNotice } from "@flow-state-dev/contracts/types/push-delivery";
import type { RequestRecord, SessionRecord } from "../src/stores/types";
import { oneOffSessionId } from "@flow-state-dev/core/helpers";

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  }
};
/** The agent flow's own sign-in: the same headers, and one it alone checks. */
const agentOnly = {
  resolvePrincipal: (context: { request?: Request }) => {
    if (context.request?.headers.get("x-agent-ok") !== "yes") return null;
    return verified.resolvePrincipal(context);
  }
};

function flows(): { inbox: FlowInstance; worker: FlowInstance; agent: FlowInstance } {
  const respond = () => ({ respond: { block: handler({ name: "respond", inputSchema: z.object({}), execute: () => ({ ok: true }) }) } });
  const worker = defineFlow({ kind: "worker", authentication: verified, actions: respond() })() as unknown as FlowInstance;
  const agent = defineFlow({ kind: "agent", authentication: agentOnly, actions: respond() })() as unknown as FlowInstance;
  const inbox = defineFlow({
    kind: "inbox",
    authentication: verified,
    actions: {},
    views: {
      pending: defineView({
        scope: "user",
        block: handler({
          name: "pending",
          inputSchema: z.object({}),
          outputSchema: z.object({ ids: z.array(z.string()) }),
          execute: async (_input, ctx) => {
            const page = await requestHostOf(ctx)!.sessions!.userSuspensions({ flowKinds: ["worker", "agent"] });
            return { ids: page.suspensions.map((entry) => entry.suspensionId) };
          }
        })
      })
    }
  })() as unknown as FlowInstance;
  return { inbox, worker, agent };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function request(id: string, flowKind: string, sessionId?: string): RequestRecord {
  return {
    id,
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    flowKind,
    flowId: flowKind,
    actionName: "respond",
    userId: "alice",
    orgId: "acme",
    ...(sessionId !== undefined ? { sessionId } : {}),
    source: "http",
    status: "suspended",
    startedAtMs: 1
  };
}

function pendingRecord(requestId: string, flowKind: string, over: Partial<SuspensionRecord> = {}): SuspensionRecord {
  return {
    suspensionId: `s_${requestId}`,
    requestId,
    flowKind,
    flowId: flowKind,
    actionName: "respond",
    userId: "alice",
    reason: "user_approval",
    message: "ok?",
    status: "pending",
    blockInstanceId: "b1",
    stepIndex: 0,
    createdAt: Date.now() - 1_000,
    ...over
  };
}

async function boot() {
  const { inbox, worker, agent } = flows();
  const registry = createFlowRegistry();
  for (const flow of [inbox, worker, agent]) registry.register(flow);
  const stores = withChangeBus(createInMemoryStores());
  const session = (id: string, flowKind: string) =>
    stores.session.set(
      id,
      { id, orgId: "acme", flowKind, flowId: flowKind, userId: "alice", state: {}, version: 0, createdAt: 1, updatedAt: 1, journal: [], lineageId: `lin_${id}` } as SessionRecord,
      "any"
    );
  const seed = async (id: string, flowKind: string, sessionId?: string) => {
    if (sessionId !== undefined) await session(sessionId, flowKind);
    await stores.request.set(id, request(id, flowKind, sessionId), "absent");
    await stores.suspensions.set(pendingRecord(id, flowKind, sessionId !== undefined ? { sessionId } : {}));
  };
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  const heard: ChangeNotice[] = [];
  stores.bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (notice) => heard.push(notice));
  return { router, stores, seed, heard };
}

async function view(router: ReturnType<typeof createFlowApiRouter>, headers: Record<string, string> = {}) {
  const path = ["inbox", "views", "pending"];
  const response = await router.POST(
    new Request(`http://test/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-verified-user": "alice", "x-verified-org": "acme", ...headers },
      body: JSON.stringify({ input: {} })
    }),
    { params: { path } }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { output: { ids: string[] }; hears: unknown[] };
}

/** Let the bus's end-of-turn batch go out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("a user view on sessions.userSuspensions", () => {
  it("hears its user topic's suspension notice alone", async () => {
    const { router, seed } = await boot();
    await seed("r1", "worker", "sess_1");
    const { output, hears } = await view(router);
    expect(output.ids).toEqual(["s_r1"]);
    expect(hears).toEqual([{ topic: { scope: "user" }, kinds: ["suspension"] }]);
  });

  it("does not list a suspension on an instance whose own sign-in refuses the caller, sessionless or in a session", async () => {
    const { router, seed } = await boot();
    await seed("worker-stop", "worker", "sess_w");
    await seed("agent-sessionless", "agent");
    await seed("agent-sessioned", "agent", "sess_a");
    expect((await view(router)).output.ids).toEqual(["s_worker-stop"]);
    // The same caller, signed in as the agent flow wants: both are theirs.
    expect((await view(router, { "x-agent-ok": "yes" })).output.ids.sort()).toEqual(["s_agent-sessioned", "s_agent-sessionless", "s_worker-stop"]);
  });
});

describe("a sessionless pending suspension on a flow the host signs in", () => {
  // The inbox flow resolves its callers itself; the worker flow is on the
  // host's resolver. A caller the inbox accepts as alice, whom the host
  // refuses, must read none of the worker's suspensions, as the HTTP session
  // list's host rule refuses its sessions; nor one whose owner can't be resolved.
  async function bootHostRule() {
    const respond = { respond: { block: handler({ name: "respond", inputSchema: z.object({}), execute: () => ({ ok: true }) }) } };
    const worker = defineFlow({ kind: "worker", actions: respond })() as unknown as FlowInstance;
    const inbox = defineFlow({
      kind: "inbox",
      authentication: verified,
      actions: {},
      views: {
        pending: defineView({
          scope: "user",
          block: handler({
            name: "pending",
            inputSchema: z.object({}),
            outputSchema: z.object({ ids: z.array(z.string()) }),
            execute: async (_input, ctx) => ({
              ids: (await requestHostOf(ctx)!.sessions!.userSuspensions({ flowKinds: ["worker"] })).suspensions.map((entry) => entry.suspensionId)
            })
          })
        })
      }
    })() as unknown as FlowInstance;
    const registry = createFlowRegistry();
    registry.register(inbox);
    registry.register(worker);
    const stores = withChangeBus(createInMemoryStores());
    const seed = async (id: string, flowId: string) => {
      await stores.request.set(id, { ...request(id, "worker"), flowId }, "absent");
      await stores.suspensions.set(pendingRecord(id, "worker", { flowId }));
    };
    // The host's resolver: only a caller carrying the host's own header.
    const router = createFlowApiRouter({
      registry,
      stores,
      staleSweepIntervalMs: 0,
      resolvePrincipal: (context: { request?: Request }) =>
        context.request?.headers.get("x-host-ok") === "yes" ? { userId: "alice", orgId: "acme" } : null
    });
    routers.push(router);
    return { router, seed };
  }

  const inboxView = async (router: ReturnType<typeof createFlowApiRouter>, headers: Record<string, string> = {}) => {
    const path = ["inbox", "views", "pending"];
    const response = await router.POST(
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-verified-user": "alice", "x-verified-org": "acme", ...headers },
        body: JSON.stringify({ input: {} })
      }),
      { params: { path } }
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { output: { ids: string[] } }).output.ids;
  };

  it("is not listed to a caller the host's resolver refuses, and is listed once it accepts them", async () => {
    const { router, seed } = await bootHostRule();
    await seed("r_host", "worker");
    expect(await inboxView(router)).toEqual([]);
    expect(await inboxView(router, { "x-host-ok": "yes" })).toEqual(["s_r_host"]);
  });

  it("is not listed when its owner can't be resolved", async () => {
    const { router, seed } = await bootHostRule();
    await seed("r_ghost", "ghost-instance");
    expect(await inboxView(router, { "x-host-ok": "yes" })).toEqual([]);
  });
});

describe("the suspension notice", () => {
  it("is published on the owner's user topic when a suspension is written or its request's are deleted, and not on a prune", async () => {
    const { stores, seed, heard } = await boot();
    await seed("r1", "worker", "sess_1");
    await settle();
    expect(heard.filter((notice) => notice.kind === "suspension")).toHaveLength(1);
    heard.splice(0);
    await stores.suspensions.pruneTerminalBefore(Date.now() + 1, 100);
    await settle();
    expect(heard.filter((notice) => notice.kind === "suspension")).toHaveLength(0);
    await stores.suspensions.deleteForRequest("r1");
    await settle();
    expect(heard.filter((notice) => notice.kind === "suspension")).toEqual([{ topic: { scope: "user", id: "alice", tenantId: "" }, kind: "suspension" }]);
  });

  it("is not published by a streamed chunk, a turn starting or a turn finishing", async () => {
    const { stores, seed, heard } = await boot();
    await seed("r1", "worker", "sess_1");
    await settle();
    heard.splice(0);
    // A turn starts in another worker session, streams a reply, and finishes.
    await stores.request.set("r2", { ...request("r2", "worker", "sess_1"), status: "in_progress" }, "absent");
    for (let chunk = 0; chunk < 20; chunk += 1) {
      stores.request.persistItems("r2", [{ type: "message", id: `m${chunk}`, role: "assistant", content: [{ type: "text", text: "x" }], status: "completed" } as never]);
    }
    await stores.request.flushItems("r2");
    const current = await stores.request.get("r2");
    await stores.request.set("r2", { ...current!, status: "completed" }, current!.version);
    await settle();
    expect(heard.some((notice) => notice.kind === "run")).toBe(true);
    expect(heard.filter((notice) => notice.kind === "suspension")).toEqual([]);
  });

  it("is not published by a durable turn finishing, whose cleanup deletes only its resolved suspensions", async () => {
    // Every durable request's completion runs `deleteForRequest`: hearing it
    // would wake every Inbox on every turn finish, which D1 rules out.
    const stores = withChangeBus(createInMemoryStores());
    const heard: ChangeNotice[] = [];
    stores.bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (notice) => heard.push(notice));
    const flow = defineFlow({
      kind: "worker",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true }).step(handler({ name: "noop", inputSchema: z.any(), execute: async () => ({ ok: true }) })),
          inputSchema: z.any(),
          durable: true
        }
      }
    })();
    const result = await runAction({
      sessionId: oneOffSessionId(),
      orgId: "acme",
      flow,
      actionName: "run",
      input: {},
      userId: "alice",
      stores,
      runtimeConfig: { durabilityProvider: createCheckpointDurabilityProvider(stores) }
    });
    expect((await stores.request.get(result.requestId!))?.status).toBe("completed");
    await settle();
    expect(heard.some((notice) => notice.kind === "run")).toBe(true);
    expect(heard.filter((notice) => notice.kind === "suspension")).toEqual([]);
  });

  it("is not published for a wait gate or an outside event: set, resolved or deleted, they wake no Inbox", async () => {
    // The read never lists a stop that waits on no person, so a notice for one
    // would re-run every Inbox on every internal gate transition (D1).
    const stores = withChangeBus(createInMemoryStores());
    const heard: ChangeNotice[] = [];
    stores.bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (notice) => heard.push(notice));
    const gated = (reason: string) =>
      defineFlow({
        kind: "worker",
        actions: {
          run: {
            block: sequencer({ name: "seq", durable: true }).step(
              handler({ name: "gate", inputSchema: z.any(), execute: async (_input, ctx) => (await ctx.suspend!({ reason, message: "waiting" }), { ok: true }) })
            ),
            inputSchema: z.any(),
            durable: true
          }
        }
      })();
    for (const reason of ["wait", "external_event"]) {
      const result = await runAction({
        sessionId: oneOffSessionId(),
        orgId: "acme",
        flow: gated(reason),
        actionName: "run",
        input: {},
        userId: "alice",
        stores,
        runtimeConfig: { durabilityProvider: createCheckpointDurabilityProvider(stores) }
      });
      expect((await stores.request.get(result.requestId!))?.status).toBe("suspended");
      const [parked] = await stores.suspensions.list({ userId: "alice", status: "pending" });
      expect(parked?.reason).toBe(reason);
      await stores.suspensions.set({ ...parked!, status: "approved", resolvedAt: Date.now() });
      await stores.suspensions.deleteForRequest(result.requestId!);
    }
    await settle();
    expect(heard.some((notice) => notice.kind === "run")).toBe(true);
    expect(heard.filter((notice) => notice.kind === "suspension")).toEqual([]);
  });

  it("wakes the view when a session holding a pending suspension is deleted, which drops it from the read", async () => {
    // The read admits a sessioned row only while its session exists, but a
    // session delete leaves its requests and suspensions in the store: the
    // view must hear the delete, or a watcher with polling off keeps the card.
    const { router, seed, heard } = await boot();
    await seed("r1", "worker", "sess_1");
    const before = await view(router);
    expect(before.output.ids).toEqual(["s_r1"]);
    await settle();
    heard.splice(0);
    const deleted = await router.DELETE(
      new Request("http://test/api/flows/sessions/sess_1", { method: "DELETE", headers: { "x-verified-user": "alice", "x-verified-org": "acme" } }),
      { params: { path: ["sessions", "sess_1"] } }
    );
    expect(deleted.status).toBe(204);
    await settle();
    expect((await view(router)).output.ids).toEqual([]);
    const wakes = heard.filter((notice) =>
      hearsNotice(before.hears as ViewHearing[], { topic: { scope: notice.topic.scope as "user" }, kind: notice.kind } as WireNotice)
    );
    expect(wakes.map((notice) => notice.kind)).toEqual(["suspension"]);
  });

  it("is published when a suspended request's suspensions are deleted", async () => {
    const { stores, seed, heard } = await boot();
    await seed("r1", "worker", "sess_1");
    await settle();
    heard.splice(0);
    await stores.suspensions.deleteForRequest("r1");
    await settle();
    expect(heard.map((notice) => notice.kind)).toEqual(["suspension"]);
  });

  it("takes an answered suspension off the view's next read, with no other refresh", async () => {
    const { router, stores, seed, heard } = await boot();
    await seed("r1", "worker", "sess_1");
    expect((await view(router)).output.ids).toEqual(["s_r1"]);
    await settle();
    heard.splice(0);
    const pending = await stores.suspensions.get("r1", "s_r1");
    await stores.suspensions.set({ ...pending!, status: "approved", resolvedAt: Date.now() });
    await settle();
    expect(heard.map((notice) => notice.kind)).toEqual(["suspension"]);
    expect((await view(router)).output.ids).toEqual([]);
  });
});
