// FIX-2623.
/**
 * Views: a block a screen watches, at the scope its data lives
 * in. The checks that matter are the ones a screen would feel: a user or org
 * view answers a user who never had a session without making one; the answer
 * names the topics of what the run read, a child block's reads included, so a
 * change to any of them reaches the watcher; a view writes nothing and calls
 * no model; and once a host has a view, a resource write publishes whichever
 * flow makes it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResourceCollection,
  defineView,
  generator,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, runAction } from "../src";
import { createInMemoryBus, createInMemoryStores, type BusTopic, type ChangeBus, type ChangeNotice } from "../src/host";
import { runView } from "../src/execution/runView";
import type { StoreRegistry } from "../src";

const pins = defineResourceCollection({
  scope: "user",
  pattern: "pins/*",
  stateSchema: z.object({ label: z.string() })
});
const orgNotes = defineResourceCollection({
  scope: "org",
  pattern: "org-notes/*",
  stateSchema: z.object({ text: z.string() })
});
const notes = defineResourceCollection({
  scope: "session",
  pattern: "notes/*",
  stateSchema: z.object({ title: z.string() })
});

const pinEntries = z.array(z.object({ id: z.string(), label: z.string() }));

const listPins = handler({
  name: "list-pins",
  inputSchema: z.object({}),
  outputSchema: pinEntries,
  resources: { pins },
  execute: async (_input, ctx) =>
    (await ctx.resources.pins.list()).map((pin) => ({ id: pin.path.replace(/^pins\//, ""), label: pin.state.label })).sort((a, b) => a.id.localeCompare(b.id))
});

const listOrgNotes = handler({
  name: "list-org-notes",
  inputSchema: z.object({}),
  outputSchema: z.object({ texts: z.array(z.string()) }),
  resources: { orgNotes },
  execute: async (_input, ctx) => ({ texts: (await ctx.resources.orgNotes.list()).map((n) => n.state.text).sort() })
});

const listNotes = handler({
  name: "list-notes",
  inputSchema: z.object({}),
  outputSchema: z.object({ titles: z.array(z.string()), topic: z.string() }),
  resources: { notes },
  execute: async (_input, ctx) => ({
    titles: (await ctx.resources.notes.list()).map((n) => n.state.title).sort(),
    topic: String((ctx.session.state as { topic?: string }).topic ?? "")
  })
});

const readsNothing = handler({
  name: "reads-nothing",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: () => ({ ok: true })
});

/** FIX-2621's probe: the view's only read is one user resource, made one block down, in a sequencer step. */
const probeStep = handler({
  name: "probe-step",
  inputSchema: z.unknown(),
  outputSchema: z.object({ count: z.number() }),
  resources: { pins },
  execute: async (_input, ctx) => ({ count: (await ctx.resources.pins.list()).length })
});
const probe = sequencer({ name: "probe", inputSchema: z.object({}) }).step(probeStep);

const touchesSession = handler({
  name: "touches-session",
  inputSchema: z.object({}),
  outputSchema: z.object({ id: z.string() }),
  execute: (_input, ctx) => ({ id: ctx.session.identity.id })
});

const writesPin = handler({
  name: "writes-pin",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { pins },
  execute: async (_input, ctx) => {
    await ctx.resources.pins.create("sneaky", { label: "sneaky" });
    return { ok: true };
  }
});

const summarize = generator({ name: "summarize", model: "openai/gpt-6-luna", prompt: "Summarize.", outputSchema: z.object({ text: z.string() }) });
const callsModel = handler({
  name: "calls-model",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: (_input, ctx) => {
    ctx.resolveModel("openai/gpt-6-luna");
    return { ok: true };
  }
});

const duplicateKeys = handler({
  name: "duplicate-keys",
  inputSchema: z.object({}),
  outputSchema: pinEntries,
  execute: () => [
    { id: "a", label: "one" },
    { id: "a", label: "two" }
  ]
});

const addPin = handler({
  name: "add-pin",
  inputSchema: z.object({ id: z.string(), label: z.string() }),
  resources: { pins },
  execute: async (input, ctx) => {
    await ctx.resources.pins.create(input.id, { label: input.label });
    return { ok: true };
  }
});
const addOrgNote = handler({
  name: "add-org-note",
  inputSchema: z.object({ text: z.string() }),
  resources: { orgNotes },
  execute: async (input, ctx) => {
    await ctx.resources.orgNotes.create(input.text, { text: input.text });
    return { ok: true };
  }
});
const addNote = handler({
  name: "add-note",
  inputSchema: z.object({ title: z.string() }),
  resources: { notes },
  execute: async (input, ctx) => {
    await ctx.resources.notes.create(input.title, { title: input.title });
    await ctx.session.patchState({ topic: input.title });
    return { ok: true };
  }
});

function desk() {
  return defineFlow({
    kind: "desk",
    session: { stateSchema: z.object({ topic: z.string().default("") }) },
    actions: { addPin, addOrgNote, addNote },
    views: {
      pins: defineView({ scope: "user", block: listPins, key: (entry) => entry.id }),
      orgNotes: defineView({ scope: "org", block: listOrgNotes }),
      notes: defineView({ scope: "session", block: listNotes }),
      nothing: defineView({ scope: "user", block: readsNothing }),
      probe: defineView({ scope: "user", block: probe }),
      touchesSession: defineView({ scope: "user", block: touchesSession }),
      writesPin: defineView({ scope: "user", block: writesPin }),
      summarize: defineView({ scope: "session", block: summarize }),
      summarizeUser: defineView({ scope: "user", block: summarize }),
      callsModel: defineView({ scope: "user", block: callsModel }),
      duplicateKeys: defineView({ scope: "user", block: duplicateKeys, key: (entry) => entry.id })
    }
  })() as unknown as FlowInstance;
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

type Router = ReturnType<typeof createFlowApiRouter>;

/** A session store that counts every call, so "no session" means none was even read. */
function countingSessions(stores: StoreRegistry): { stores: StoreRegistry; calls: string[] } {
  const calls: string[] = [];
  const session = new Proxy(stores.session, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      return (...args: unknown[]) => {
        calls.push(prop);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
  return { stores: { ...stores, session }, calls };
}

function build(flows: FlowInstance[] = [desk()], bus?: ChangeBus) {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow);
  const base = { ...createInMemoryStores(), ...(bus !== undefined ? { bus } : {}) };
  const router = createFlowApiRouter({ registry, stores: base, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores: base, registry };
}

function post(router: Router, path: string[], body: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.join("/")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return router.POST(request, { params: { path } });
}

async function act(router: Router, stores: StoreRegistry, sessionId: string, action: string, input: unknown, userId = "alice") {
  const res = await post(router, ["desk", sessionId, "actions", action], { userId, input });
  expect(res.status, await res.clone().text()).toBe(202);
  const { request } = (await res.json()) as { request: { id: string } };
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(request.id);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${action} did not finish`);
}

const view = (router: Router, name: string, userId = "alice", sessionId?: string) =>
  post(router, sessionId === undefined ? ["desk", "views", name] : ["desk", sessionId, "views", name], { userId, input: {} });

describe("a user or org view runs with no session", () => {
  it("answers a user who never had a session, and the session store is never called", async () => {
    const registry = createFlowRegistry();
    registry.register(desk());
    const seededStores = createInMemoryStores();
    const seedRouter = createFlowApiRouter({ registry, stores: seededStores, staleSweepIntervalMs: 0 });
    routers.push(seedRouter);
    // Bob seeds the org's notes; Alice has never had a session.
    await act(seedRouter, seededStores, "bob-1", "addOrgNote", { text: "org note" }, "bob");
    const sessionsBefore = (await seededStores.session.list({})).map((s) => s.id);

    const { stores, calls } = countingSessions(seededStores);
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    routers.push(router);
    const res = await view(router, "orgNotes");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ output: { texts: ["org note"] }, topics: [{ scope: "org" }] });

    const pinsRes = await view(router, "pins");
    expect(await pinsRes.json()).toEqual({ output: [], topics: [{ scope: "user" }], keys: [] });
    expect(calls).toEqual([]);
    expect((await seededStores.session.list({})).map((s) => s.id)).toEqual(sessionsBefore);
  });

  it("answers each user their own rows", async () => {
    const { router, stores } = build();
    await act(router, stores, "a-1", "addPin", { id: "b", label: "alice b" });
    await act(router, stores, "a-1", "addPin", { id: "a", label: "alice a" });
    await act(router, stores, "b-1", "addPin", { id: "z", label: "bob z" }, "bob");
    const alice = await view(router, "pins");
    expect(alice.status, await alice.clone().text()).toBe(200);
    const answer = await alice.json();
    expect(answer.keys).toEqual(["a", "b"]);
    expect(answer.output).toEqual([
      { id: "a", label: "alice a" },
      { id: "b", label: "alice b" }
    ]);
    expect((await (await view(router, "pins", "bob")).json()).output).toEqual([{ id: "z", label: "bob z" }]);
  });

  it("refuses a block that reaches for the session, by name", async () => {
    const { router } = build();
    const res = await view(router, "touchesSession");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "view_no_session", message: expect.stringContaining("no session") });
  });

  it("is addressed without a session, and a session view with one", async () => {
    const { router } = build();
    expect((await view(router, "pins", "alice", "s1")).status).toBe(400);
    expect((await view(router, "notes")).status).toBe(400);
  });
});

describe("the answer names the topics of what the run read", () => {
  it("names the session's topic for a session view that read its state and resources", async () => {
    const { router, stores } = build();
    await act(router, stores, "s1", "addNote", { title: "alpha" });
    const res = await view(router, "notes", "alice", "s1");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ output: { titles: ["alpha"], topic: "alpha" }, topics: [{ scope: "session", id: "s1" }] });
  });

  it("names no topic for a view that read nothing", async () => {
    const { router } = build();
    expect(await (await view(router, "nothing")).json()).toEqual({ output: { ok: true }, topics: [] });
  });

  it("records a read made one block down, in a sequencer step", async () => {
    // FIX-2621's probe: no recorder outside the engine saw this read. The
    // engine records it where it builds every block's context.
    const { router } = build();
    const res = await view(router, "probe");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ output: { count: 0 }, topics: [{ scope: "user" }] });
  });

  it("records by accessor, child blocks included, at runView", async () => {
    const stores = createInMemoryStores();
    const answer = await runView({ flow: desk(), viewName: "probe", input: {}, userId: "alice", orgId: "default", stores });
    expect(answer.topics).toEqual([{ scope: "user" }]);
  });
});

describe("a view changes nothing and calls no model", () => {
  it("refuses a write with read_only", async () => {
    const { router, stores } = build();
    const res = await view(router, "writesPin");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "read_only" });
    expect(Object.keys((await stores.resourceState.getAll("user", "alice")) ?? {})).toEqual([]);
  });

  it("refuses a generator, at session and at user scope, by name", async () => {
    const { router, stores } = build();
    await act(router, stores, "s1", "addNote", { title: "alpha" });
    for (const res of [await view(router, "summarize", "alice", "s1"), await view(router, "summarizeUser")]) {
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: "view_model_call", message: expect.stringContaining("summarize") });
    }
  });

  it("refuses a model resolved from a handler", async () => {
    const { router } = build();
    const res = await view(router, "callsModel");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "view_model_call" });
  });
});

describe("keyed rows", () => {
  it("refuses an answer whose keys repeat", async () => {
    const { router } = build();
    const res = await view(router, "duplicateKeys");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "view_answer_not_keyed" });
  });
});

describe("once a host has a view, every resource write publishes", () => {
  /** A flow with no view, no `client` config and no derived value: today its user writes publish nothing. */
  const writer = () =>
    defineFlow({ kind: "writer", actions: { addPin } })() as unknown as FlowInstance;

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const userTopic: BusTopic = { scope: "user", id: "alice", tenantId: "" };
  function hear(bus: ChangeBus, topic: BusTopic): ChangeNotice[] {
    const heard: ChangeNotice[] = [];
    bus.subscribe(topic, (notice) => heard.push(notice));
    return heard;
  }
  async function write(bus: ChangeBus, hostHasViews: boolean) {
    const result = await runAction({
      orgId: "default",
      flow: writer(),
      actionName: "addPin" as never,
      input: { id: "p1", label: "one" } as never,
      userId: "alice",
      sessionId: "w1",
      stores: { ...createInMemoryStores(), bus },
      runtimeConfig: { requestHost: { hostHasViews: () => hostHasViews } }
    });
    if (result.error !== undefined) throw result.error;
    await tick();
    await tick();
  }

  it("publishes another flow's user write on the user's topic", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, userTopic);
    await write(bus, true);
    expect(heard.filter((n) => n.kind === "resource").map((n) => n.topic.resource)).toEqual(["pins/p1"]);
  });

  it("publishes nothing for it on a host with no view", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, userTopic);
    await write(bus, false);
    expect(heard.filter((n) => n.kind === "resource")).toEqual([]);
  });

  it("is wired from the host's registry", async () => {
    const bus = createInMemoryBus();
    const heard = hear(bus, userTopic);
    const { router, stores } = build([desk(), writer()], bus);
    const res = await post(router, ["writer", "w1", "actions", "addPin"], { userId: "alice", input: { id: "p2", label: "two" } });
    expect(res.status).toBe(202);
    const { request } = (await res.json()) as { request: { id: string } };
    for (let i = 0; i < 200 && (await stores.request.get(request.id))?.status === "in_progress"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await tick();
    expect(heard.filter((n) => n.kind === "resource").map((n) => n.topic.resource)).toContain("pins/p2");
  });
});
