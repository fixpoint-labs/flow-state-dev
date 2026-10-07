/**
 * Server-owned session data, decided at create (`session.createCheck`,
 * `session.serverOwned`), on every path that writes a new session record.
 *
 * The flow under test links each session to a "worker" a user holds in a
 * user-scoped collection, which is the shape Workforce builds on it. The check
 * accepts or refuses; an accepted link is stored exactly as the create sent it.
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
 * `linked`: every session names a worker the creating user holds on this flow.
 * `plain`: declares nothing, and must behave exactly as before.
 */
function flows(): Harness {
  const calls: SessionCreateCheckInput[] = [];
  const createCheck = async (input: SessionCreateCheckInput): Promise<SessionCreateCheckResult> => {
    calls.push(input);
    if (input.link === undefined) return { ok: false, message: "Name a worker to create this session." };
    const row = await input.readCollectionItem("workers", input.link);
    // A worker that isn't the caller's reads as one that doesn't exist.
    if (row === undefined) return { ok: false, status: 404, message: `No worker "${input.link}".` };
    if (row.flow !== input.flow.kind) {
      return { ok: false, message: `Worker "${input.link}" runs on "${String(row.flow)}", not "${input.flow.kind}".` };
    }
    return { ok: true };
  };
  const whoAmI = handler({
    name: "whoami",
    inputSchema: z.object({}).passthrough(),
    execute: async (_input, ctx) => {
      return { link: ctx.session.link ?? null, lineageId: ctx.session.lineageId ?? null };
    }
  });
  const writeDelegates = handler({
    name: "write-delegates",
    inputSchema: z.object({ to: z.array(z.string()) }),
    execute: async (input, ctx) => {
      await ctx.session.patchState({ delegates: input.to });
      return { ok: true };
    }
  });
  const flow = defineFlow({
    kind: "linked",
    resources: { workers },
    session: {
      stateSchema: z.object({ delegates: z.array(z.string()).default([]), note: z.string().optional() }),
      createCheck,
      serverOwned: ["delegates"]
    },
    actions: {
      whoami: { inputSchema: z.object({}).passthrough(), block: whoAmI },
      delegate: { inputSchema: z.object({ to: z.array(z.string()) }), block: writeDelegates }
    },
    internal: { actions: { work: { block: handler({ name: "linked-work", execute: () => ({}) }) } } },
    // `from` with a gate that lets every task through: what is under test is
    // the child's birth, which happens before any gate runs.
    task: {
      actions: {
        work: {
          block: handler({ name: "linked-task-work", execute: () => ({}) }),
          from: { boardId: "board", gate: (entry) => entry }
        }
      }
    }
  })({ id: "linked" }) as unknown as FlowInstance;
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
  const router = createFlowApiRouter({ registry, stores });
  return { ...h, stores, router };
}

/** Put a worker on a user's roster the way a hire would: one row in their cell. */
async function hold(stores: StoreRegistry, userId: string, workerId: string, flowKind: string) {
  const cell = resolveUserStorageKey(userId, ORG, { id: "linked", isolateUserState: false });
  await stores.resourceState.set("user", cell, `workers/${workerId}`, { flow: flowKind }, "absent");
}

function create(router: ReturnType<typeof boot>["router"], flowKind: string, body: Record<string, unknown>) {
  return router.POST(
    new Request(`http://localhost/api/flows/${flowKind}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { path: [flowKind, "sessions"] } }
  );
}

describe("the create route", () => {
  it("stores the link the check accepted, read from the caller's own scope", async () => {
    const { router, stores, calls } = boot();
    await hold(stores, "alice", "researcher", "linked");

    const res = await create(router, "linked", { userId: "alice", sessionId: "s1", link: "researcher" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { session: { link?: string } }).session.link).toBe("researcher");
    expect((await stores.session.get("s1"))?.link).toBe("researcher");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      principal: { userId: "alice", orgId: ORG },
      sessionId: "s1",
      flow: { kind: "linked", id: "linked" },
      link: "researcher",
      via: "create"
    });
  });

  it("refuses another user's worker with the answer a missing one gets, and writes nothing", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "linked");

    const bobs = await create(router, "linked", { userId: "bob", sessionId: "s2", link: "researcher" });
    const none = await create(router, "linked", { userId: "bob", sessionId: "s3", link: "nobody" });
    expect(bobs.status).toBe(404);
    expect(none.status).toBe(404);
    expect(((await bobs.json()) as { error: string }).error).toBe('No worker "researcher".');
    expect(await stores.session.get("s2")).toBeUndefined();
    expect(await stores.session.get("s3")).toBeUndefined();
  });

  it("refuses a create that names no link, and writes nothing", async () => {
    const { router, stores } = boot();
    const res = await create(router, "linked", { userId: "alice", sessionId: "s4" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Name a worker to create this session.");
    expect(await stores.session.get("s4")).toBeUndefined();
  });

  it("refuses a missing link even when the check accepts it", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(
      defineFlow({
        kind: "lax",
        session: { createCheck: () => ({ ok: true }) },
        actions: { run: { inputSchema: z.object({}), block: handler({ name: "lax-run", execute: () => ({}) }) } }
      })({ id: "lax" }) as unknown as FlowInstance
    );
    const router = createFlowApiRouter({ registry, stores });
    const res = await create(router, "lax", { userId: "alice", sessionId: "s5" });
    expect(res.status).toBe(400);
    expect(await stores.session.get("s5")).toBeUndefined();
  });

  it("refuses caller state for a server-owned field with a 400 naming it", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "linked");
    const res = await create(router, "linked", {
      userId: "alice",
      sessionId: "s6",
      link: "researcher",
      state: { delegates: ["bobs-worker"] }
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "delegates" });
    expect(await stores.session.get("s6")).toBeUndefined();

    // Other caller state is still the caller's to set.
    const ok = await create(router, "linked", {
      userId: "alice",
      sessionId: "s7",
      link: "researcher",
      state: { note: "hi" }
    });
    expect(ok.status).toBe(201);
    expect((await stores.session.get("s7"))?.state).toEqual({ note: "hi", delegates: [] });
  });

  it("answers 409 for an id that exists, without calling the check again", async () => {
    const { router, stores, calls } = boot();
    await hold(stores, "alice", "researcher", "linked");
    expect((await create(router, "linked", { userId: "alice", sessionId: "s8", link: "researcher" })).status).toBe(201);
    expect((await create(router, "linked", { userId: "alice", sessionId: "s8", link: "researcher" })).status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  it("gives a session deleted and created again only what its own create named", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "linked");
    await hold(stores, "alice", "editor", "linked");
    await create(router, "linked", { userId: "alice", sessionId: "s9", link: "researcher" });
    await stores.session.delete("s9");
    await create(router, "linked", { userId: "alice", sessionId: "s9", link: "editor" });
    expect((await stores.session.get("s9"))?.link).toBe("editor");
  });

  it("leaves a flow that declares nothing as it was: no check, no link", async () => {
    const { router, stores } = boot();
    const res = await create(router, "plain", { userId: "alice", sessionId: "p1", link: "ignored", state: { delegates: [] } });
    expect(res.status).toBe(201);
    const stored = await stores.session.get("p1");
    expect(stored?.link).toBeUndefined();
    expect(stored?.state).toEqual({ delegates: [] });
  });
});

describe("after create, the link never changes", () => {
  it("the metadata route does not write it", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "linked");
    await create(router, "linked", { userId: "alice", sessionId: "m1", link: "researcher" });
    const patched = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/m1/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", link: "other", metadata: { link: "other" } })
      }),
      { params: { path: ["sessions", "m1", "metadata"] } }
    );
    expect(patched.status).toBe(200);
    expect((await stores.session.get("m1"))?.link).toBe("researcher");
  });

  it("a turn reads it, flow code writes server-owned state, and no turn calls the check", async () => {
    const { router, stores, flow, calls } = boot();
    await hold(stores, "alice", "researcher", "linked");
    await create(router, "linked", { userId: "alice", sessionId: "m2", link: "researcher" });

    const seen = await runAction({
      flow, actionName: "whoami", input: {}, userId: "alice", orgId: ORG, sessionId: "m2", stores, runtimeConfig: {}
    });
    expect(seen.error).toBeUndefined();
    expect(seen.output).toEqual({
      link: "researcher",
      lineageId: (await stores.session.get("m2"))?.lineageId
    });

    const wrote = await runAction({
      flow, actionName: "delegate", input: { to: ["a", "b"] }, userId: "alice", orgId: ORG, sessionId: "m2", stores, runtimeConfig: {}
    });
    expect(wrote.error).toBeUndefined();
    const stored = await stores.session.get("m2");
    expect(stored?.state.delegates).toEqual(["a", "b"]);
    expect(stored?.link).toBe("researcher");
    expect(calls).toHaveLength(1);
  });
});

describe("an action on a session id that does not exist", () => {
  it("is refused at the door on a flow that checks its creates, with nothing written", async () => {
    const { router, stores } = boot();
    const res = await router.POST(
      new Request("http://localhost/api/flows/linked/fresh/actions/whoami", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {}, userId: "alice", sessionId: "fresh" })
      }),
      { params: { path: ["linked", "fresh", "actions", "whoami"] } }
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Name a worker to create this session.");
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
    expect((await stores.session.get("pfresh"))?.link).toBeUndefined();
  });
});

describe("a webhook delivery for a session that does not exist", () => {
  it("is refused on a flow that checks its creates", async () => {
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

  it("births the child linked to what the dispatching code named", async () => {
    const { stores, flow, plain, calls } = boot();
    await hold(stores, "alice", "researcher", "linked");
    const outcome = await seam(stores, plain, flow)({
      type: "internal",
      action: "work",
      flowKind: "linked",
      session: { key: "k1", link: "researcher" },
      payload: {},
      from: "test"
    });
    expect(outcome).toMatchObject({ ok: true, adopted: false });
    const child = await stores.session.get((outcome as { sessionId: string }).sessionId);
    expect(child?.link).toBe("researcher");
    expect(calls.at(-1)).toMatchObject({ via: "dispatch", principal: { userId: "alice" } });

    // The same key again adopts the child without a second check.
    const again = await seam(stores, plain, flow)({
      type: "internal", action: "work", flowKind: "linked", session: { key: "k1", link: "researcher" }, payload: {}, from: "test"
    });
    expect(again).toMatchObject({ ok: true, adopted: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses by name when the target's check refuses, and writes no child", async () => {
    const { stores, flow, plain } = boot();
    const outcome = await seam(stores, plain, flow)({
      type: "internal", action: "work", flowKind: "linked", session: { key: "k2" }, payload: {}, from: "test"
    });
    expect(outcome).toMatchObject({ ok: false, refused: "create-refused" });
    expect(await stores.session.list({ parentage: "all" })).toEqual([]);
  });
});

describe("a dispatch through the public dispatcher()", () => {
  function relay(withLink: boolean): FlowInstance {
    return defineFlow({
      kind: withLink ? "relay" : "relay-nolink",
      actions: {
        send: {
          block: dispatcher({
            name: withLink ? "relay-send" : "relay-nolink-send",
            action: "work",
            flowKind: "linked",
            inputSchema: z.object({ worker: z.string() }),
            session: withLink
              ? { key: (input: { worker: string }) => `job-${input.worker}`, link: (input: { worker: string }) => input.worker }
              : { key: (input: { worker: string }) => `job-${input.worker}` },
            payload: () => ({})
          })
        }
      }
    })({ id: withLink ? "relay" : "relay-nolink" }) as unknown as FlowInstance;
  }

  async function send(withLink: boolean) {
    const h = flows();
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(h.flow);
    const from = relay(withLink);
    registry.register(from);
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await hold(stores, "alice", "researcher", "linked");
    expect((await create(router, from.id, { userId: "alice", sessionId: "parent" })).status).toBe(201);
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${from.id}/parent/actions/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", input: { worker: "researcher" } })
      }),
      { params: { path: [from.id, "parent", "actions", "send"] } }
    );
    expect(res.status).toBe(202);
    const deadline = Date.now() + 5_000;
    while ((await stores.request.list({ sessionId: "parent" })).some((r) => r.status === "in_progress")) {
      if (Date.now() > deadline) throw new Error("the send never finished");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [sent] = await stores.request.list({ sessionId: "parent" });
    const children = await stores.session.list({ parentage: { parentOf: "parent" } });
    return { sent, children };
  }

  it("creates the child with the link the dispatcher's own code computed", async () => {
    const { sent, children } = await send(true);
    expect(sent?.status).toBe("completed");
    expect(children.map((c) => c.link)).toEqual(["researcher"]);
  });

  it("is refused by the target's check when the dispatcher names no link", async () => {
    const { sent, children } = await send(false);
    expect(sent?.status).toBe("failed");
    expect(children).toEqual([]);
  });
});

describe("a dispatch through a public task dispatcher()", () => {
  function relay(withLink: boolean): FlowInstance {
    return defineFlow({
      kind: withLink ? "task-relay" : "task-relay-nolink",
      actions: {
        send: {
          inputSchema: taskDispatchInputSchema,
          block: dispatcher({
            name: withLink ? "task-relay-send" : "task-relay-nolink-send",
            type: "task",
            action: "work",
            flowKind: "linked",
            session: "per-task",
            ...(withLink ? { link: (task: { assignee: string }) => task.assignee } : {})
          })
        }
      }
    })({ id: withLink ? "task-relay" : "task-relay-nolink" }) as unknown as FlowInstance;
  }

  async function send(withLink: boolean) {
    const h = flows();
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(h.flow);
    const from = relay(withLink);
    registry.register(from);
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await hold(stores, "alice", "researcher", "linked");
    expect((await create(router, from.id, { userId: "alice", sessionId: "tparent" })).status).toBe(201);
    const envelope = { boardId: "board", seat: "researcher", taskId: "t1", attempt: 1, createdAt: 1, payload: {} };
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${from.id}/tparent/actions/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", input: envelope })
      }),
      { params: { path: [from.id, "tparent", "actions", "send"] } }
    );
    expect(res.status).toBe(202);
    const deadline = Date.now() + 5_000;
    while ((await stores.request.list({ sessionId: "tparent" })).some((r) => r.status === "in_progress")) {
      if (Date.now() > deadline) throw new Error("the send never finished");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [sent] = await stores.request.list({ sessionId: "tparent" });
    const children = await stores.session.list({ parentage: { parentOf: "tparent" } });
    return { sent, children };
  }

  it("creates each task's child with the link the dispatcher looked up for it", async () => {
    const { sent, children } = await send(true);
    expect(sent?.status).toBe("completed");
    expect(children.map((c) => c.link)).toEqual(["researcher"]);
  });

  it("is refused by the target's check when the task dispatcher names no link", async () => {
    const { sent, children } = await send(false);
    expect(sent?.status).toBe("failed");
    expect(children).toEqual([]);
  });
});

describe("a link is stored and matched exactly as sent", () => {
  it("keeps surrounding spaces through create and the listing", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(
      defineFlow({
        kind: "opaque",
        session: { createCheck: () => ({ ok: true }) },
        actions: { run: { inputSchema: z.object({}), block: handler({ name: "opaque-run", execute: () => ({}) }) } }
      })({ id: "opaque" }) as unknown as FlowInstance
    );
    const router = createFlowApiRouter({ registry, stores });
    expect((await create(router, "opaque", { userId: "alice", sessionId: "o1", link: "  spaced  " })).status).toBe(201);
    expect((await stores.session.get("o1"))?.link).toBe("  spaced  ");

    const list = async (link: string) => {
      const res = await router.GET(
        new Request(`http://localhost/api/flows/sessions?userId=alice&link=${encodeURIComponent(link)}`),
        { params: { path: ["sessions"] } }
      );
      return ((await res.json()) as { sessions: Array<{ id: string }> }).sessions.map((row) => row.id);
    };
    expect(await list("  spaced  ")).toEqual(["o1"]);
    expect(await list("spaced")).toEqual([]);
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
          createCheck: async ({ link, readCollectionItem }) => {
            const row = link === undefined ? undefined : await readCollectionItem("rooms", { room: link });
            return row?.open === true ? { ok: true } : { ok: false, status: 404, message: "No such room." };
          }
        },
        actions: { run: { inputSchema: z.object({}), block: handler({ name: "rooms-run", execute: () => ({}) }) } }
      })({ id: "rooms" }) as unknown as FlowInstance
    );
    const router = createFlowApiRouter({ registry, stores });
    const cell = resolveUserStorageKey("alice", ORG, { id: "rooms", isolateUserState: false });
    await stores.resourceState.set("user", cell, "lobby/info", { open: true }, "absent");

    expect((await create(router, "rooms", { userId: "alice", sessionId: "r1", link: "lobby" })).status).toBe(201);
    expect((await create(router, "rooms", { userId: "alice", sessionId: "r2", link: "attic" })).status).toBe(404);
  });
});

describe("the session listing's link filter", () => {
  it("narrows to sessions whose stored link matches, and never past the owner", async () => {
    const { router, stores } = boot();
    await hold(stores, "alice", "researcher", "linked");
    await hold(stores, "alice", "editor", "linked");
    await create(router, "linked", { userId: "alice", sessionId: "l1", link: "researcher" });
    await create(router, "linked", { userId: "alice", sessionId: "l2", link: "editor" });
    await create(router, "plain", { userId: "alice", sessionId: "l3" });

    const list = async (query: string) => {
      const res = await router.GET(new Request(`http://localhost/api/flows/sessions?${query}`), {
        params: { path: ["sessions"] }
      });
      return ((await res.json()) as { sessions: Array<{ id: string }> }).sessions.map((s) => s.id).sort();
    };
    expect(await list("userId=alice&link=researcher")).toEqual(["l1"]);
    expect(await list("userId=alice")).toEqual(["l1", "l2", "l3"]);
    expect(await list("userId=bob&link=researcher")).toEqual([]);
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
