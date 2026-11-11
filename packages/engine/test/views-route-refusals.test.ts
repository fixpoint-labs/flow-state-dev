// FIX-2623.
/**
 * The view routes refuse the way every other door does:
 *
 * - A caller outside a flow instance's owner pin gets the 404 an address the
 *   registry doesn't hold gets, byte for byte, whatever it asks: a view the
 *   flow has, one it doesn't, or one at the wrong scope. Nothing tells it the
 *   instance exists or which views it has.
 * - A session view on another user's session answers as an unused session id.
 * - Another organization reads none of the first one's user or org rows.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "../src";
import { createInMemoryStores } from "../src/host";
import { InstancePinMismatchError } from "../src/context/instance-pin";
import type { StoreRegistry } from "../src";

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  }
};

const pins = defineResourceCollection({ scope: "user", pattern: "pins/*", stateSchema: z.object({ label: z.string() }) });
const notes = defineResourceCollection({ scope: "org", pattern: "notes/*", stateSchema: z.object({ text: z.string() }) });

const listPins = handler({
  name: "list-pins",
  inputSchema: z.object({}),
  outputSchema: z.object({ labels: z.array(z.string()) }),
  resources: { pins },
  execute: async (_input, ctx) => ({ labels: (await ctx.resources.pins.list()).map((p) => p.state.label).sort() })
});
const listNotes = handler({
  name: "list-notes",
  inputSchema: z.object({}),
  outputSchema: z.object({ texts: z.array(z.string()) }),
  resources: { notes },
  execute: async (_input, ctx) => ({ texts: (await ctx.resources.notes.list()).map((n) => n.state.text).sort() })
});
const sessionState = handler({
  name: "session-state",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: (_input, ctx) => ({ ok: ctx.session.state !== undefined })
});
/** A pin refusal raised inside the run, for the route's last line of defence. */
const pinMiss = handler({
  name: "pin-miss",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: () => {
    throw new InstancePinMismatchError("desk", "owning-org");
  }
});
const seed = handler({
  name: "seed",
  inputSchema: z.object({ text: z.string() }),
  resources: { pins, notes },
  execute: async (input, ctx) => {
    await ctx.resources.pins.create(input.text, { label: input.text });
    await ctx.resources.notes.create(input.text, { text: input.text });
    return { ok: true };
  }
});

function desk(kind: string): FlowInstance {
  return defineFlow({
    kind,
    authentication: verified,
    actions: { seed },
    views: {
      pins: defineView({ scope: "user", block: listPins }),
      notes: defineView({ scope: "org", block: listNotes }),
      state: defineView({ scope: "session", block: sessionState }),
      pinMiss: defineView({ scope: "user", block: pinMiss })
    }
  })() as unknown as FlowInstance;
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function boot(pinned = false) {
  const registry = createFlowRegistry();
  registry.register(desk("desk"), pinned ? { pin: { orgId: "acme", userId: "alice" } } : undefined);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores };
}

type Router = ReturnType<typeof createFlowApiRouter>;
async function post(router: Router, path: string[], user: string, org: string, body: unknown = { input: {} }) {
  const response = await router.POST(
    new Request(`http://test/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-verified-user": user, "x-verified-org": org },
      body: JSON.stringify(body)
    }),
    { params: { path } }
  );
  return { status: response.status, body: await response.text() };
}

async function act(router: Router, stores: StoreRegistry, sessionId: string, user: string, org: string, text: string) {
  const res = await post(router, ["desk", sessionId, "actions", "seed"], user, org, { input: { text } });
  expect(res.status, res.body).toBe(202);
  const { request } = JSON.parse(res.body) as { request: { id: string } };
  for (let i = 0; i < 200 && (await stores.request.get(request.id))?.status === "in_progress"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** What an address the registry doesn't hold answers. */
const unregistered = (router: Router, path: string[], user: string, org: string) =>
  post(router, ["ghost", ...path.slice(1)], user, org);
const asGhost = (answer: { status: number; body: string }) => ({ status: answer.status, body: answer.body.replace(/ghost/g, "desk") });

describe("a pinned flow's views, to a caller outside the pin", () => {
  for (const [who, user, org] of [
    ["a second user", "bob", "acme"],
    ["a second org", "alice", "other"]
  ] as const) {
    it(`answers ${who} exactly as an unregistered address, for any view`, async () => {
      const { router } = boot(true);
      for (const path of [
        ["desk", "views", "pins"],
        ["desk", "views", "nope"],
        ["desk", "views", "state"],
        ["desk", "s1", "views", "state"],
        ["desk", "s1", "views", "pins"]
      ]) {
        const answer = await post(router, path, user, org);
        expect(answer.status).toBe(404);
        expect(answer).toEqual(asGhost(await unregistered(router, path, user, org)));
      }
    });
  }

  it("answers a pin refusal raised during the run as an unregistered address, naming nothing", async () => {
    const { router } = boot(true);
    const answer = await post(router, ["desk", "views", "pinMiss"], "alice", "acme");
    expect(answer).toEqual(asGhost(await unregistered(router, ["desk", "views", "pinMiss"], "alice", "acme")));
    expect(answer.body).not.toMatch(/organization|admitted/);
  });

  it("answers the pinned owner", async () => {
    const { router } = boot(true);
    const answer = await post(router, ["desk", "views", "pins"], "alice", "acme");
    expect(answer.status, answer.body).toBe(200);
  });
});

describe("a session view on another user's session", () => {
  it("answers as an unused session id", async () => {
    const { router, stores } = boot();
    await act(router, stores, "alice-1", "alice", "acme", "a");
    const theirs = await post(router, ["desk", "alice-1", "views", "state"], "bob", "acme");
    const unused = await post(router, ["desk", "never-used", "views", "state"], "bob", "acme");
    expect(theirs.status).toBe(404);
    expect(theirs).toEqual({ status: unused.status, body: unused.body.replace(/never-used/g, "alice-1") });
  });
});

describe("another organization", () => {
  it("reads none of the first org's user or org rows", async () => {
    const { router, stores } = boot();
    await act(router, stores, "alice-1", "alice", "acme", "acme row");
    const own = JSON.parse((await post(router, ["desk", "views", "pins"], "alice", "acme")).body);
    expect(own.output).toEqual({ labels: ["acme row"] });
    expect(JSON.parse((await post(router, ["desk", "views", "pins"], "alice", "other")).body).output).toEqual({ labels: [] });
    expect(JSON.parse((await post(router, ["desk", "views", "notes"], "alice", "acme")).body).output).toEqual({ texts: ["acme row"] });
    expect(JSON.parse((await post(router, ["desk", "views", "notes"], "bob", "other")).body).output).toEqual({ texts: [] });
  });
});
