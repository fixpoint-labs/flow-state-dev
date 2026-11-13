// FIX-2625 D1.
/**
 * A view that answers for just the entries a change touches. The run carries the
 * notice that woke the watcher (`ctx.view.changed`), never entry keys: only the
 * view knows which of its entries an id touches. A view that says nothing answers
 * whole, as before; one that calls `ctx.view.partial` answers the entries to place
 * by key and the keys to drop, and the answer says so on the wire.
 *
 * Why it matters: a board view re-run whole for one task's change, per
 * watcher, is the cost this removes; a partial answer the client can't tell
 * from a whole one would drop every entry it didn't carry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResourceCollection, defineView, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, ViewChange } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { runView } from "../src/execution/runView";
import type { StoreRegistry } from "../src";

const pins = defineResourceCollection({ scope: "user", pattern: "pins/*", stateSchema: z.object({ label: z.string() }) });
const pinEntries = z.array(z.object({ id: z.string(), label: z.string() }));

/** Every pin, or, for a change that names pins, just those: the entries it can find, and the keys it can't as removed. */
const listPins = handler({
  name: "list-pins",
  inputSchema: z.object({}),
  outputSchema: pinEntries,
  resources: { pins },
  execute: async (_input, ctx) => {
    const all = (await ctx.resources.pins.list()).map((pin) => ({ id: pin.path.replace(/^pins\//, ""), label: pin.state.label }));
    const changed = ctx.view?.changed;
    if (changed?.kind !== "resource") return all;
    const named = new Set(changed.ids.map((id) => id.replace(/^pins\//, "")));
    const entries = all.filter((entry) => named.has(entry.id));
    return ctx.view!.partial(entries, { removed: [...named].filter((id) => !entries.some((entry) => entry.id === id)) });
  }
});

/** What a block one step down sees of the view's run. */
const seen: Array<ViewChange | undefined | "absent"> = [];
const sees = handler({
  name: "sees",
  inputSchema: z.unknown(),
  outputSchema: z.array(z.object({ id: z.string() })),
  execute: (_input, ctx) => {
    seen.push(ctx.view === undefined ? "absent" : ctx.view.changed);
    return [];
  }
});
const nested = sequencer({ name: "nested", inputSchema: z.object({}), outputSchema: z.array(z.object({ id: z.string() })) }).step(sees);

/** A view with no key that tries to answer partially. */
const unkeyedPartial = handler({
  name: "unkeyed-partial",
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({ id: z.string() })),
  execute: (_input, ctx) => ctx.view!.partial([{ id: "a" }])
});

/** A view that always answers partially, notice or not. */
const alwaysPartial = handler({
  name: "always-partial",
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({ id: z.string() })),
  execute: (_input, ctx) => ctx.view!.partial([{ id: "a" }])
});

const addPin = handler({
  name: "add-pin",
  inputSchema: z.object({ id: z.string(), label: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { pins },
  execute: async (input, ctx) => {
    await ctx.resources.pins.create(input.id, { label: input.label });
    return { ok: true };
  }
});
const action = handler({
  name: "looks",
  inputSchema: z.object({}),
  outputSchema: z.object({ view: z.boolean() }),
  execute: (_input, ctx) => ({ view: ctx.view !== undefined })
});

function desk(): FlowInstance {
  return defineFlow({
    kind: "desk",
    actions: { addPin, looks: action },
    views: {
      pins: defineView({ scope: "user", block: listPins, key: (entry) => entry.id }),
      nested: defineView({ scope: "user", block: nested, key: (entry: { id: string }) => entry.id }),
      unkeyed: defineView({ scope: "user", block: unkeyedPartial }),
      always: defineView({ scope: "user", block: alwaysPartial, key: (entry) => entry.id })
    }
  })() as unknown as FlowInstance;
}

const pinChange = (...ids: string[]): ViewChange => ({ topic: { scope: "user", resource: ids[0] }, kind: "resource", ids });

async function seeded(): Promise<StoreRegistry> {
  const stores = createInMemoryStores();
  for (const [id, label] of [
    ["a", "one"],
    ["b", "two"],
    ["c", "three"]
  ]) {
    const result = await runAction({ orgId: DEFAULT_ORG_ID, flow: desk(), actionName: "addPin", input: { id, label }, userId: "alice", sessionId: "seed", stores, runtimeConfig: {} });
    if (result.error !== undefined) throw new Error(JSON.stringify(result.error));
  }
  return stores;
}

const run = async (stores: StoreRegistry, viewName: string, changed?: ViewChange) =>
  runView({ flow: desk(), viewName, input: {}, userId: "alice", orgId: DEFAULT_ORG_ID, stores, ...(changed !== undefined ? { changed } : {}) });

describe("runView · a change it may answer for", () => {
  it("answers whole with no change, and the answer is not partial", async () => {
    const answer = await run(await seeded(), "pins");
    expect(answer.partial).toBeUndefined();
    expect(answer.keys).toEqual(["a", "b", "c"]);
  });

  it("answers just the entries the view chose for a change, with the keys it removed, and says it is partial", async () => {
    const answer = await run(await seeded(), "pins", pinChange("pins/b", "pins/gone"));
    expect(answer.output).toEqual([{ id: "b", label: "two" }]);
    expect(answer.keys).toEqual(["b"]);
    expect(answer.partial).toEqual({ removed: ["gone"] });
  });

  it("hands the change to a block one step down", async () => {
    seen.length = 0;
    await run(await seeded(), "nested", pinChange("pins/a"));
    await run(await seeded(), "nested");
    expect(seen).toEqual([pinChange("pins/a"), undefined]);
  });

  it("refuses a partial answer from a run with no change, or from a view with no key", async () => {
    await expect(run(await seeded(), "always")).rejects.toThrow(/partial/);
    await expect(run(await seeded(), "unkeyed", pinChange("pins/a"))).rejects.toThrow(/key/);
  });
});

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

async function router() {
  const registry = createFlowRegistry();
  registry.register(desk());
  const stores = await seeded();
  const built = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(built);
  return built;
}

const post = (r: Awaited<ReturnType<typeof router>>, path: string[], body: unknown) =>
  r.POST(new Request(`http://localhost/api/flows/${path.join("/")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: { path }
  });

describe("the view route · the change a call carries", () => {
  it("runs the view for the change in the body and answers partial with the removed keys", async () => {
    const r = await router();
    const res = await post(r, ["desk", "views", "pins"], { userId: "alice", input: {}, changed: pinChange("pins/c") });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ output: [{ id: "c", label: "three" }], topics: [{ scope: "user" }], keys: ["c"], partial: { removed: [] } });
  });

  it("runs whole for a change it can't read: no ids, ids that aren't strings, or past the cap", async () => {
    const r = await router();
    for (const changed of [
      { topic: { scope: "user" }, kind: "resource" },
      { topic: { scope: "user" }, kind: "resource", ids: [1] },
      { topic: { scope: "user" }, kind: "resource", ids: [] },
      { topic: { scope: "user" }, kind: "resource", ids: Array.from({ length: 101 }, (_, i) => `pins/${i}`) },
      { topic: { scope: "nowhere" }, kind: "resource", ids: ["pins/a"] }
    ]) {
      const body = await (await post(r, ["desk", "views", "pins"], { userId: "alice", input: {}, changed })).json();
      expect(body.keys, JSON.stringify(changed)).toEqual(["a", "b", "c"]);
      expect(body.partial).toBeUndefined();
    }
  });

  it("gives an action's blocks no view context", async () => {
    const result = await runAction({ orgId: DEFAULT_ORG_ID, flow: desk(), actionName: "looks", input: {}, userId: "alice", sessionId: "s1", stores: createInMemoryStores(), runtimeConfig: {} });
    expect(result.output).toEqual({ view: false });
  });
});
