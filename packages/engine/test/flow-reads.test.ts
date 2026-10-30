/**
 * A flow's reads (FIX-2286): an app runs a block on a session and gets its
 * answer back, and nothing is stored. The checks that matter are the ones a
 * poll would break: a read adds no request, changes no row, can't write,
 * can't start a request, and reaches only a session its caller may run in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, dispatcher, handler } from "@flow-state-dev/core";
import { onRequestEnded } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores, disposeFlowApiRouter } from "../src";
import { drainRequestEnds } from "../src/execution/request-end-hooks";
import type { StoreRegistry } from "../src";

const notes = defineResourceCollection({
  scope: "session",
  pattern: "notes/*",
  stateSchema: z.object({ title: z.string() })
});

const listNotes = handler({
  name: "list-notes",
  inputSchema: z.object({ prefix: z.string().default("") }),
  resources: { notes },
  execute: async (input, ctx) => ({
    titles: (await ctx.resources.notes.list())
      .map((note) => note.state.title)
      .filter((title) => title.startsWith(input.prefix))
      .sort()
  })
});

const addNote = handler({
  name: "add-note",
  inputSchema: z.object({ title: z.string() }),
  resources: { notes },
  execute: async (input, ctx) => {
    await ctx.resources.notes.create(input.title, { title: input.title });
    return { ok: true };
  }
});

const writes = handler({
  name: "read-that-writes",
  inputSchema: z.object({}),
  resources: { notes },
  execute: async (_input, ctx) => {
    await ctx.resources.notes.create("sneaky", { title: "sneaky" });
    return { ok: true };
  }
});

const writesState = handler({
  name: "read-that-writes-state",
  inputSchema: z.object({}),
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ touched: true });
    return { ok: true };
  }
});

const writesUser = handler({
  name: "read-that-writes-user-state",
  inputSchema: z.object({}),
  execute: async (_input, ctx) => {
    await ctx.user.patchState({ touched: true });
    return { ok: true };
  }
});

const ended: string[] = [];
const cleansUp = handler({
  name: "read-that-cleans-up",
  inputSchema: z.object({ fail: z.boolean().default(false) }),
  execute: async (input, ctx) => {
    onRequestEnded(ctx, (ending) => {
      ended.push(ending.status);
    });
    if (input.fail) throw new Error("the read failed");
    return { ok: true };
  }
});

const dispatches = dispatcher({
  name: "read-that-dispatches",
  type: "internal",
  action: "add",
  inputSchema: z.object({}),
  session: { key: () => "child-of-a-read" }
});

function build() {
  const flow = defineFlow({
    kind: "board",
    actions: { addNote: { block: addNote } },
    internal: { actions: { add: { block: handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({}) }) } } },
    reads: {
      notes: { block: listNotes },
      writes: { block: writes },
      writesState: { block: writesState },
      writesUser: { block: writesUser },
      cleansUp: { block: cleansUp },
      dispatches: { block: dispatches }
    }
  })();
  const registry = createFlowRegistry();
  registry.register(flow);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

type Router = ReturnType<typeof createFlowApiRouter>;

function post(router: Router, path: string[], body: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.join("/")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return router.POST(request, { params: { path } });
}

async function runAction(router: Router, stores: StoreRegistry, sessionId: string, action: string, input: unknown) {
  const res = await post(router, ["board", sessionId, "actions", action], { userId: "alice", input });
  expect(res.status).toBe(202);
  const { request } = (await res.json()) as { request: { id: string } };
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(request.id);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${action} did not finish`);
}

/** Everything the stores hold that a read could leave behind, as one comparable value. */
async function snapshot(stores: StoreRegistry) {
  return JSON.stringify({
    requests: (await stores.request.list({})).map((r) => [r.id, r.status, r.version]),
    sessions: (await stores.session.list({})).map((s) => [s.id, s.version, s.state]),
    notes: (await stores.resourceState.getAll("session", "sess_1")) ?? null
  });
}

async function seeded() {
  const { router, stores } = build();
  const created = await post(router, ["board", "sessions"], { userId: "alice", sessionId: "sess_1" });
  expect(created.status).toBeLessThan(300);
  const { session } = (await created.json()) as { session: { id: string } };
  await runAction(router, stores, session.id, "addNote", { title: "alpha" });
  await runAction(router, stores, session.id, "addNote", { title: "beta" });
  return { router, stores, sessionId: session.id };
}

describe("a flow's reads", () => {
  it("answers in the response and stores nothing", async () => {
    const { router, stores, sessionId } = await seeded();
    const before = await snapshot(stores);
    for (let i = 0; i < 10; i += 1) {
      const res = await post(router, ["board", sessionId, "reads", "notes"], { userId: "alice", input: {} });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ output: { titles: ["alpha", "beta"] } });
    }
    expect(await snapshot(stores)).toBe(before);
  });

  it("answers on a session no action has run in yet, and still stores nothing", async () => {
    // Session creation stores no user or org record; the first run seeds them.
    // A read must not need an action to have run first, and must not seed them itself.
    const { router, stores } = build();
    const created = await post(router, ["board", "sessions"], { userId: "alice", sessionId: "sess_1" });
    const { session } = (await created.json()) as { session: { id: string } };
    const before = JSON.stringify({ users: await stores.user.list(), orgs: await stores.org.list(), at: await snapshot(stores) });
    const res = await post(router, ["board", session.id, "reads", "notes"], { userId: "alice", input: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ output: { titles: [] } });
    expect(JSON.stringify({ users: await stores.user.list(), orgs: await stores.org.list(), at: await snapshot(stores) })).toBe(before);
    // The seed is only something to read: writing to the seeded user still refuses.
    const write = await post(router, ["board", session.id, "reads", "writesUser"], { userId: "alice", input: {} });
    expect(write.status).toBe(409);
    expect(JSON.stringify({ users: await stores.user.list(), orgs: await stores.org.list(), at: await snapshot(stores) })).toBe(before);
  });

  it("runs its request-end hooks when it ends, and owes nothing after", async () => {
    const { router, sessionId } = await seeded();
    ended.length = 0;
    const ok = await post(router, ["board", sessionId, "reads", "cleansUp"], { userId: "alice", input: {} });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const failed = await post(router, ["board", sessionId, "reads", "cleansUp"], { userId: "alice", input: { fail: true } });
    expect(failed.status).toBe(422);
    expect(ended).toEqual(["completed", "failed"]);
    // A host's shutdown would otherwise wait on every read that added a hook.
    expect(await drainRequestEnds(0)).toBe(0);
  });

  it("parses its input against the block's schema", async () => {
    const { router, sessionId } = await seeded();
    const narrowed = await post(router, ["board", sessionId, "reads", "notes"], { userId: "alice", input: { prefix: "b" } });
    expect(await narrowed.json()).toEqual({ output: { titles: ["beta"] } });
    const bad = await post(router, ["board", sessionId, "reads", "notes"], { userId: "alice", input: { prefix: 3 } });
    expect(bad.status).toBe(400);
  });

  it("answers another user as for a session that doesn't exist", async () => {
    const { router, sessionId } = await seeded();
    const res = await post(router, ["board", sessionId, "reads", "notes"], { userId: "bob", input: {} });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("alpha");
    const none = await post(router, ["board", "sess_missing", "reads", "notes"], { userId: "alice", input: {} });
    expect(none.status).toBe(404);
  });

  it("refuses a read the flow doesn't declare, even one named for an action", async () => {
    const { router, sessionId } = await seeded();
    const res = await post(router, ["board", sessionId, "reads", "addNote"], { userId: "alice", input: { title: "x" } });
    expect(res.status).toBe(404);
  });

  it.each([
    ["a resource write", "writes"],
    ["a session state write", "writesState"],
    ["a user state write", "writesUser"],
    ["a dispatch", "dispatches"]
  ])("refuses %s with read_only and changes nothing", async (_what, read) => {
    const { router, stores, sessionId } = await seeded();
    const before = await snapshot(stores);
    const res = await post(router, ["board", sessionId, "reads", read], { userId: "alice", input: {} });
    const body = (await res.json()) as { error: string; message: string };
    expect({ status: res.status, error: body.error }, body.message).toEqual({ status: 409, error: "read_only" });
    expect(await snapshot(stores)).toBe(before);
  });
});
