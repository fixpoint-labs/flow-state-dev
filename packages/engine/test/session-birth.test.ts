/**
 * What a session is created with, checked once (`session.createCheck`), and
 * what of it never changes (`.readonly()` state fields), on every path that
 * writes a new session record; `session.serverOwned` beside them.
 *
 * The flow under test binds each session to a "worker" a user holds in a
 * user-scoped collection, which is the shape Workforce builds on it: the
 * binding is a readonly state field, `workerId`, that the create check
 * confirms is the caller's.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineResourceCollection,
  dispatcher,
  handler,
  taskDispatchInputSchema
} from "@flow-state-dev/core";
import type {
  FlowInstance,
  SessionCreateCheckInput,
  SessionCreateCheckResult
} from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  ReadonlySessionStateError,
  resolveUserStorageKey,
  runAction,
  SessionCreateRefusedError,
  type StoreRegistry
} from "../src";
import { createRequestHost } from "../src/context/create-request-host";
import { ensureSessionForWebhook } from "../src/transports/webhook/session-resolver";

const ORG = DEFAULT_ORG_ID;

const workers = defineResourceCollection({
  pattern: "workers/*",
  scope: "user",
  stateSchema: z.object({ flow: z.string() })
});

type Harness = {
  flow: FlowInstance;
  plain: FlowInstance;
  calls: SessionCreateCheckInput[];
};

/**
 * `bound`: every session names a worker the creating user holds on this flow,
 * in its readonly `workerId`. `plain`: declares nothing, and must behave
 * exactly as before.
 */
function flows(): Harness {
  const calls: SessionCreateCheckInput[] = [];
  const createCheck = async (input: SessionCreateCheckInput): Promise<SessionCreateCheckResult> => {
    calls.push(input);
    const workerId = input.state.workerId as string;
    const row = await input.readCollectionItem("workers", workerId);
    // A worker that isn't the caller's reads as one that doesn't exist.
    if (row === undefined) return { ok: false, status: 404, message: `No worker "${workerId}".` };
    if (row.flow !== input.flow.kind) {
      return { ok: false, message: `Worker "${workerId}" runs on "${String(row.flow)}", not "${input.flow.kind}".` };
    }
    return { ok: true };
  };
  const whoAmI = handler({
    name: "whoami",
    inputSchema: z.object({}).passthrough(),
    execute: async (_input, ctx) => ({
      workerId: (ctx.session.state as { workerId?: string }).workerId ?? null,
      lineageId: ctx.session.lineageId ?? null
    })
  });
  const writeDelegates = handler({
    name: "write-delegates",
    inputSchema: z.object({ to: z.array(z.string()) }),
    execute: async (input, ctx) => {
      await ctx.session.patchState({ delegates: input.to });
      return { ok: true };
    }
  });
  const moveWorker = handler({
    name: "move-worker",
    inputSchema: z.object({ to: z.string() }),
    execute: async (input, ctx) => {
      await ctx.session.patchState({ workerId: input.to } as never);
      return { ok: true };
    }
  });
  const flow = defineFlow({
    kind: "bound",
    resources: { workers },
    session: {
      stateSchema: z.object({
        workerId: z.string().readonly(),
        delegates: z.array(z.string()).default([]),
        note: z.string().optional()
      }),
      createCheck,
      serverOwned: ["delegates"]
    },
    actions: {
      whoami: { inputSchema: z.object({}).passthrough(), block: whoAmI },
      delegate: { inputSchema: z.object({ to: z.array(z.string()) }), block: writeDelegates },
      move: { inputSchema: z.object({ to: z.string() }), block: moveWorker }
    },
    internal: { actions: { work: { block: handler({ name: "bound-work", execute: () => ({}) }) } } },
    // `from` with a gate that lets every task through: what is under test is
    // the child's birth, which happens before any gate runs.
    task: {
      actions: {
        work: {
          block: handler({ name: "bound-task-work", execute: () => ({}) }),
          from: { boardId: "board", gate: (entry) => entry }
        }
      }
    }
  })({ id: "bound" }) as unknown as FlowInstance;
  const plain = defineFlow({
    kind: "plain",
    actions: {
      whoami: { inputSchema: z.object({}).passthrough(), block: whoAmI }
    },
    internal: { actions: { work: { block: handler({ name: "plain-work", execute: () => ({}) }) } } }
  })({ id: "plain" }) as unknown as FlowInstance;
  return { flow, plain, calls };
}

function boot() {
  const h = flows();
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(h.flow);
  registry.register(h.plain);
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  return { ...h, stores, router, registry };
}

/** Put a worker on a user's roster the way a hire would: one row in their cell. */
async function hold(stores: StoreRegistry, userId: string, workerId: string, flowKind: string) {
  const cell = resolveUserStorageKey(userId, ORG, { id: "bound", isolateUserState: false });
  await stores.resourceState.set("user", cell, `workers/${workerId}`, { flow: flowKind }, "absent");
}

type Router = ReturnType<typeof boot>["router"];

function create(router: Router, flowKind: string, body: Record<string, unknown>) {
  return router.POST(
    new Request(`http://localhost/api/flows/${flowKind}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { path: [flowKind, "sessions"] } }
  );
}

function act(router: Router, flowKind: string, sessionId: string, action: string, input: unknown) {
  return router.POST(
    new Request(`http://localhost/api/flows/${flowKind}/${sessionId}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, userId: "alice", sessionId })
    }),
    { params: { path: [flowKind, sessionId, "actions", action] } }
  );
}

async function settled(stores: StoreRegistry, sessionId: string) {
  const deadline = Date.now() + 5_000;
  while ((await stores.request.list({ sessionId })).some((r) => r.status === "in_progress")) {
    if (Date.now() > deadline) throw new Error(`a request on ${sessionId} never finished`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return stores.request.list({ sessionId, withItems: true });
}

async function list(router: Router, query: string) {
  const res = await router.GET(new Request(`http://localhost/api/flows/sessions?${query}`), {
    params: { path: ["sessions"] }
  });
  return { status: res.status, body: (await res.json()) as { sessions?: Array<{ id: string }>; error?: string } };
}

describe("the create route", () => {
  it("creates with the state the schema parsed, after the check confirmed it at the caller's scope", async () => {
    const { router, stores, calls } = boot();
    await hold(stores, "alice", "researcher", "bound");

    const res = await create(router, "bound", { userId: "alice", sessionId: "s1", state: { workerId: "researcher" } });
    expect(res.status).toBe(201);
    expect((await stores.session.get("s1"))?.state).toEqual({ workerId: "researcher", delegates: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      principal: { userId: "alice", orgId: ORG },
      sessionId: "s1",
      flow: { kind: "bound", id: "bound" },
      state: { workerId: "researcher", delegates: [] },
      via: "create"
    });
  });

  it("refuses another user's worker with the answer a missing one gets, and writes nothing", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "bound");

    const bobs = await create(router, "bound", { userId: "bob", sessionId: "s2", state: { workerId: "researcher" } });
    const none = await create(router, "bound", { userId: "bob", sessionId: "s3", state: { workerId: "nobody" } });
    expect(bobs.status).toBe(404);
    expect(none.status).toBe(404);
    expect(((await bobs.json()) as { error: string }).error).toBe('No worker "researcher".');
    expect(await stores.session.get("s2")).toBeUndefined();
    expect(await stores.session.get("s3")).toBeUndefined();
  });

  it("refuses a state the schema refuses, naming the field, before the check runs", async () => {
    const { router, stores, calls } = boot();
    const res = await create(router, "bound", { userId: "alice", sessionId: "s4", state: { workerId: 7 } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "workerId" });
    expect(await stores.session.get("s4")).toBeUndefined();

    const missing = await create(router, "bound", { userId: "alice", sessionId: "s4b" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ field: "workerId" });
    expect(calls).toHaveLength(0);
  });

  it("refuses caller state for a server-owned field with a 400 naming it", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "bound");
    const res = await create(router, "bound", {
      userId: "alice",
      sessionId: "s6",
      state: { workerId: "researcher", delegates: ["bobs-worker"] }
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "delegates" });
    expect(await stores.session.get("s6")).toBeUndefined();

    const ok = await create(router, "bound", {
      userId: "alice",
      sessionId: "s7",
      state: { workerId: "researcher", note: "hi" }
    });
    expect(ok.status).toBe(201);
    expect((await stores.session.get("s7"))?.state).toEqual({ workerId: "researcher", note: "hi", delegates: [] });
  });

  it("answers 409 for an id that exists, without calling the check again", async () => {
    const { router, stores, calls } = boot();
    await hold(stores, "alice", "researcher", "bound");
    const body = { userId: "alice", sessionId: "s8", state: { workerId: "researcher" } };
    expect((await create(router, "bound", body)).status).toBe(201);
    expect((await create(router, "bound", body)).status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  it("gives a session deleted and created again only what its own create named", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "bound");
    await hold(stores, "alice", "editor", "bound");
    await create(router, "bound", { userId: "alice", sessionId: "s9", state: { workerId: "researcher" } });
    await stores.session.delete("s9");
    await create(router, "bound", { userId: "alice", sessionId: "s9", state: { workerId: "editor" } });
    expect((await stores.session.get("s9"))?.state.workerId).toBe("editor");
  });

  it("leaves a flow that declares nothing as it was", async () => {
    const { router, stores } = boot();
    const res = await create(router, "plain", { userId: "alice", sessionId: "p1", state: { anything: 1 } });
    expect(res.status).toBe(201);
    expect((await stores.session.get("p1"))?.state).toEqual({ anything: 1 });
  });

  // Off state of the create-time schema refusal: only a flow that binds its
  // sessions (a readonly field or a create check) refuses. A flow with a schema
  // and neither keeps today's behaviour, which workforce's half-filled mailbox
  // sessions rely on.
  it("keeps a state the schema rejects as sent, on a flow with no readonly field and no check", async () => {
    const loose = defineFlow({
      kind: "loose",
      session: { stateSchema: z.object({ members: z.array(z.string()), mode: z.string().default("chat") }) },
      actions: { noop: { inputSchema: z.object({}).passthrough(), block: handler({ name: "loose-noop", execute: () => ({}) }) } }
    })({ id: "loose" }) as unknown as FlowInstance;
    const registry = createFlowRegistry();
    registry.register(loose);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });

    const rejected = await create(router, "loose", { userId: "alice", sessionId: "l1", state: { members: "nope" } });
    expect(rejected.status).toBe(201);
    expect((await stores.session.get("l1"))?.state).toEqual({ members: "nope" });

    const fits = await create(router, "loose", { userId: "alice", sessionId: "l2", state: { members: [] } });
    expect(fits.status).toBe(201);
    expect((await stores.session.get("l2"))?.state).toEqual({ members: [], mode: "chat" });
  });
});

describe("a readonly state field", () => {
  it("can't be changed by an action's block: the run fails naming it, and the stored value stays", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "bound");
    await create(router, "bound", { userId: "alice", sessionId: "r1", state: { workerId: "researcher" } });

    expect((await act(router, "bound", "r1", "move", { to: "editor" })).status).toBe(202);
    const [run] = await settled(stores, "r1");
    expect(run?.status).toBe("failed");
    expect(JSON.stringify(run?.items ?? [])).toContain('can\'t change state field \\"workerId\\"');
    expect((await stores.session.get("r1"))?.state.workerId).toBe("researcher");
  });

  it("refuses through every write, as ReadonlySessionStateError, while other fields still write", async () => {
    const { router, stores, flow } = boot();
    await hold(stores, "alice", "researcher", "bound");
    await create(router, "bound", { userId: "alice", sessionId: "r2", state: { workerId: "researcher" } });
    const run = (actionName: string, input: unknown) =>
      runAction({ flow, actionName, input, userId: "alice", orgId: ORG, sessionId: "r2", stores, runtimeConfig: {} });

    const moved = await run("move", { to: "editor" });
    expect(moved.error).toBeDefined();
    expect(String(moved.error?.message ?? moved.error)).toMatch(/workerId/);

    const wrote = await run("delegate", { to: ["a", "b"] });
    expect(wrote.error).toBeUndefined();
    expect((await stores.session.get("r2"))?.state).toEqual({ workerId: "researcher", delegates: ["a", "b"] });
    expect(ReadonlySessionStateError.name).toBe("ReadonlySessionStateError");
  });

  it("is read by a turn, which never calls the check", async () => {
    const { router, stores, flow, calls } = boot();
    await hold(stores, "alice", "researcher", "bound");
    await create(router, "bound", { userId: "alice", sessionId: "r3", state: { workerId: "researcher" } });
    const seen = await runAction({
      flow, actionName: "whoami", input: {}, userId: "alice", orgId: ORG, sessionId: "r3", stores, runtimeConfig: {}
    });
    expect(seen.error).toBeUndefined();
    expect(seen.output).toEqual({
      workerId: "researcher",
      lineageId: (await stores.session.get("r3"))?.lineageId
    });
    expect(calls).toHaveLength(1);
  });
});

describe("an action on a session id that does not exist", () => {
  it("is refused at the door when the state it would start with fails the check, with nothing written", async () => {
    const { router, stores } = boot();
    const res = await act(router, "bound", "fresh", "whoami", {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "workerId" });
    expect(await stores.session.get("fresh")).toBeUndefined();
    expect(await stores.request.list({ sessionId: "fresh" })).toEqual([]);
  });

  it("is refused by the birth itself when it reaches the context directly", async () => {
    const { stores, flow } = boot();
    const result = await runAction({
      flow, actionName: "whoami", input: {}, userId: "alice", orgId: ORG, sessionId: "direct", stores, runtimeConfig: {}
    }).catch((error: unknown) => ({ thrown: error }));
    expect(result).toMatchObject({ thrown: expect.any(SessionCreateRefusedError) });
    expect(await stores.session.get("direct")).toBeUndefined();
  });

  it("creates the session as before on a flow that declares nothing", async () => {
    const { stores, plain } = boot();
    const result = await runAction({
      flow: plain, actionName: "whoami", input: {}, userId: "alice", orgId: ORG, sessionId: "pfresh", stores, runtimeConfig: {}
    });
    expect(result.error).toBeUndefined();
    expect((await stores.session.get("pfresh"))?.state).toEqual({});
  });
});

describe("a webhook delivery for a session that does not exist", () => {
  it("is refused on a flow whose sessions need state a webhook doesn't carry", async () => {
    const { stores, flow } = boot();
    await expect(
      ensureSessionForWebhook({
        stores,
        sessionId: "hook-1",
        flow,
        principal: { userId: "alice", orgId: ORG },
        provider: "test",
        eventType: null
      })
    ).rejects.toBeInstanceOf(SessionCreateRefusedError);
    expect(await stores.session.get("hook-1")).toBeUndefined();
  });

  it("is born at version 0, as a session created any other way is", async () => {
    const { stores, plain, router } = boot();
    await ensureSessionForWebhook({
      stores,
      sessionId: "hook-2",
      flow: plain,
      principal: { userId: "alice", orgId: ORG },
      provider: "test",
      eventType: null
    });
    await create(router, "plain", { userId: "alice", sessionId: "http-2" });
    expect((await stores.session.get("hook-2"))?.version).toBe(0);
    expect((await stores.session.get("http-2"))?.version).toBe(0);
  });
});

describe("a dispatch into a key-derived child", () => {
  function seam(stores: StoreRegistry, from: FlowInstance, target: FlowInstance) {
    return createRequestHost({
      stores,
      flow: from,
      identity: { userId: "alice", tenantId: undefined, orgId: ORG, sessionId: "parent", lineageId: "lin_parent" },
      dispatchOperation: async () => ({ requestId: "req_child" }),
      liveness: { staleThresholdMs: 60_000, heartbeatIntervalMs: 10_000, staleSweepIntervalMs: 30_000 },
      resolveFlow: (id) => (id === target.id ? target : undefined)
    }).seam;
  }

  it("births the child with the state the dispatching code named", async () => {
    const { stores, flow, plain, calls } = boot();
    await hold(stores, "alice", "researcher", "bound");
    const outcome = await seam(stores, plain, flow)({
      type: "internal",
      action: "work",
      flowKind: "bound",
      session: { key: "k1", state: { workerId: "researcher" } },
      payload: {},
      from: "test"
    });
    expect(outcome).toMatchObject({ ok: true, adopted: false });
    const child = await stores.session.get((outcome as { sessionId: string }).sessionId);
    expect(child?.state).toEqual({ workerId: "researcher", delegates: [] });
    expect(calls.at(-1)).toMatchObject({ via: "dispatch", principal: { userId: "alice" } });

    // The same key again adopts the child without a second check.
    const again = await seam(stores, plain, flow)({
      type: "internal", action: "work", flowKind: "bound", session: { key: "k1", state: { workerId: "researcher" } }, payload: {}, from: "test"
    });
    expect(again).toMatchObject({ ok: true, adopted: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses by name when the target refuses the child's state, and writes no child", async () => {
    const { stores, flow, plain } = boot();
    const outcome = await seam(stores, plain, flow)({
      type: "internal", action: "work", flowKind: "bound", session: { key: "k2" }, payload: {}, from: "test"
    });
    expect(outcome).toMatchObject({ ok: false, refused: "create-refused" });
    expect(await stores.session.list({ parentage: "all" })).toEqual([]);
  });
});

/** Send `input` through a relay flow's `send` action and return its run and children. */
async function sendThroughRelay(from: FlowInstance, input: unknown) {
  const h = flows();
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(h.flow);
  registry.register(from);
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  await hold(stores, "alice", "researcher", "bound");
  expect((await create(router, from.id, { userId: "alice", sessionId: "relay-parent" })).status).toBe(201);
  expect((await act(router, from.id, "relay-parent", "send", input)).status).toBe(202);
  const [sent] = await settled(stores, "relay-parent");
  const children = await stores.session.list({ parentage: { parentOf: "relay-parent" } });
  return { sent, children };
}

describe("a dispatch through the public dispatcher()", () => {
  function relay(withState: boolean): FlowInstance {
    const id = withState ? "relay" : "relay-nostate";
    return defineFlow({
      kind: id,
      actions: {
        send: {
          block: dispatcher({
            name: `${id}-send`,
            action: "work",
            flowKind: "bound",
            inputSchema: z.object({ worker: z.string() }),
            session: withState
              ? { key: (input) => `job-${input.worker}`, state: (input) => ({ workerId: input.worker }) }
              : { key: (input) => `job-${input.worker}` },
            payload: () => ({})
          })
        }
      }
    })({ id }) as unknown as FlowInstance;
  }

  it("creates the child with the state the dispatcher's own code computed", async () => {
    const { sent, children } = await sendThroughRelay(relay(true), { worker: "researcher" });
    expect(sent?.status).toBe("completed");
    expect(children.map((c) => c.state.workerId)).toEqual(["researcher"]);
  });

  it("is refused by the target when the dispatcher names no state", async () => {
    const { sent, children } = await sendThroughRelay(relay(false), { worker: "researcher" });
    expect(sent?.status).toBe("failed");
    expect(children).toEqual([]);
  });
});

describe("a dispatch through a public task dispatcher()", () => {
  function relay(withState: boolean): FlowInstance {
    const id = withState ? "task-relay" : "task-relay-nostate";
    return defineFlow({
      kind: id,
      actions: {
        send: {
          inputSchema: taskDispatchInputSchema,
          block: dispatcher({
            name: `${id}-send`,
            type: "task",
            action: "work",
            flowKind: "bound",
            session: "per-task",
            ...(withState ? { state: (task: { assignee: string }) => ({ workerId: task.assignee }) } : {})
          })
        }
      }
    })({ id }) as unknown as FlowInstance;
  }
  const envelope = { boardId: "board", seat: "researcher", taskId: "t1", attempt: 1, createdAt: 1, payload: {} };

  it("creates each task's child with the state the dispatcher looked up for it", async () => {
    const { sent, children } = await sendThroughRelay(relay(true), envelope);
    expect(sent?.status).toBe("completed");
    expect(children.map((c) => c.state.workerId)).toEqual(["researcher"]);
  });

  it("is refused by the target when the task dispatcher names no state", async () => {
    const { sent, children } = await sendThroughRelay(relay(false), envelope);
    expect(sent?.status).toBe("failed");
    expect(children).toEqual([]);
  });
});

describe("the session listing's state filter", () => {
  it("narrows to sessions whose readonly field holds the value, and never past the owner", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "bound");
    await hold(stores, "alice", "editor", "bound");
    await create(router, "bound", { userId: "alice", sessionId: "l1", state: { workerId: "researcher" } });
    await create(router, "bound", { userId: "alice", sessionId: "l2", state: { workerId: "editor" } });
    await create(router, "plain", { userId: "alice", sessionId: "l3" });

    const ids = async (query: string) => (await list(router, query)).body.sessions?.map((s) => s.id).sort();
    expect(await ids("userId=alice&flowKind=bound&state.workerId=researcher")).toEqual(["l1"]);
    expect(await ids("userId=alice")).toEqual(["l1", "l2", "l3"]);
    expect(await ids("userId=bob&flowKind=bound&state.workerId=researcher")).toEqual([]);
  });

  it("refuses a field that isn't readonly, a flow that declares none, and a filter with no flow", async () => {
    const { router } = boot();
    const notReadonly = await list(router, "userId=alice&flowKind=bound&state.note=hi");
    expect(notReadonly.status).toBe(400);
    expect(notReadonly.body.error).toContain('"note"');
    expect((await list(router, "userId=alice&flowKind=plain&state.workerId=x")).status).toBe(400);
    expect((await list(router, "userId=alice&state.workerId=x")).status).toBe(400);
  });

  it("matches a value exactly as sent", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "  spaced  ", "bound");
    await create(router, "bound", { userId: "alice", sessionId: "o1", state: { workerId: "  spaced  " } });
    const ids = async (value: string) =>
      (await list(router, `userId=alice&flowKind=bound&state.workerId=${encodeURIComponent(value)}`)).body.sessions?.map(
        (s) => s.id
      );
    expect(await ids("  spaced  ")).toEqual(["o1"]);
    expect(await ids("spaced")).toEqual([]);
  });
});

describe("readCollectionItem on a parameterized collection", () => {
  it("reads the item named by its parameters, and nothing when it is absent", async () => {
    const rooms = defineResourceCollection({
      pattern: "[room]/info",
      scope: "user",
      stateSchema: z.object({ open: z.boolean() })
    });
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(
      defineFlow({
        kind: "rooms",
        resources: { rooms },
        session: {
          stateSchema: z.object({ room: z.string().readonly() }),
          createCheck: async ({ state, readCollectionItem }) => {
            const row = await readCollectionItem("rooms", { room: state.room as string });
            return row?.open === true ? { ok: true } : { ok: false, status: 404, message: "No such room." };
          }
        },
        actions: { run: { inputSchema: z.object({}), block: handler({ name: "rooms-run", execute: () => ({}) }) } }
      })({ id: "rooms" }) as unknown as FlowInstance
    );
    const router = createFlowApiRouter({ registry, stores });
    const cell = resolveUserStorageKey("alice", ORG, { id: "rooms", isolateUserState: false });
    await stores.resourceState.set("user", cell, "lobby/info", { open: true }, "absent");

    expect((await create(router, "rooms", { userId: "alice", sessionId: "r1", state: { room: "lobby" } })).status).toBe(201);
    expect((await create(router, "rooms", { userId: "alice", sessionId: "r2", state: { room: "attic" } })).status).toBe(404);
  });
});

describe("one birth function", () => {
  it("is the only engine source that creates a session record", async () => {
    // A create-if-absent session write anywhere else is a path the create
    // check does not see. The grep the plan's V1 names, kept as a test.
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    const writers: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "testing") await walk(full);
        } else if (entry.name.endsWith(".ts")) {
          const text = await readFile(full, "utf8");
          if (/session\.set\([\s\S]{0,200}?"absent"/.test(text)) writers.push(path.relative(srcDir, full));
        }
      }
    };
    await walk(srcDir);
    expect(writers).toEqual(["context/session-birth.ts"]);
  });
});
