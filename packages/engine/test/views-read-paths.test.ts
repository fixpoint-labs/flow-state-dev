/**
 * Views (FIX-2623): every path a view's run can read through is either
 * recorded, so its watchers hear a change to it, or refused. A read the
 * engine can't record would leave a watcher stale with no error.
 *
 * - A resource's `contentTemplateRef` into another scope resolves through the
 *   template resolver, not through `ctx.resources`: the template's scope is
 *   recorded, found or not, since creating it later changes the answer.
 * - The request host's session reads (`sessions.read`, `sessions.history`)
 *   are refused in a view with no session, and record the session they read
 *   in a session view. `livenessOf` reads the active-request registry, which
 *   no topic covers, so a view is refused it.
 * - A session view's reads of `ctx.session` outside its state (items,
 *   metadata, journal) record the session.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { runView } from "../src/execution/runView";
import type { StoreRegistry } from "../src";

const ORG = "acme";

const greetingTemplate = defineResource({
  scope: "org",
  ref: "greetingTemplate",
  stateSchema: z.object({}).passthrough()
});
const greeting = defineResource({
  scope: "user",
  stateSchema: z.object({ name: z.string().default("Ada") }),
  default: { name: "Ada" },
  contentTemplateRef: "greetingTemplate"
});

const setTemplate = handler({
  name: "set-template",
  inputSchema: z.object({ text: z.string() }),
  resources: { greetingTemplate },
  execute: async (input, ctx) => {
    await ctx.resources.greetingTemplate.writeContent(input.text);
    return { ok: true };
  }
});

const readGreeting = handler({
  name: "read-greeting",
  inputSchema: z.object({}),
  outputSchema: z.object({ text: z.string().nullable() }),
  resources: { greeting, greetingTemplate },
  execute: async (_input, ctx) => ({ text: await ctx.resources.greeting.readContent() })
});

const readsSession = handler({
  name: "reads-session",
  inputSchema: z.object({ target: z.string() }),
  outputSchema: z.object({ found: z.boolean() }),
  execute: async (input, ctx) => ({ found: (await requestHostOf(ctx)?.sessions?.read(input.target)) !== undefined })
});

const readsLiveness = handler({
  name: "reads-liveness",
  inputSchema: z.object({}),
  outputSchema: z.object({ n: z.number() }),
  execute: async (_input, ctx) => ({ n: Object.keys((await requestHostOf(ctx)?.livenessOf?.(["r1"])) ?? {}).length })
});

const readsItems = handler({
  name: "reads-items",
  inputSchema: z.object({}),
  outputSchema: z.object({ n: z.number() }),
  execute: (_input, ctx) => ({ n: ctx.session.items.all().length })
});

const touch = handler({ name: "touch", inputSchema: z.object({}), execute: () => ({ ok: true }) });

function app(): FlowInstance {
  return defineFlow({
    kind: "desk",
    resources: { greeting, greetingTemplate },
    actions: { setTemplate, touch },
    views: {
      greeting: defineView({ scope: "user", block: readGreeting }),
      peekUser: defineView({ scope: "user", block: readsSession }),
      peekSession: defineView({ scope: "session", block: readsSession }),
      liveness: defineView({ scope: "session", block: readsLiveness }),
      items: defineView({ scope: "session", block: readsItems })
    }
  })() as unknown as FlowInstance;
}

async function act(stores: StoreRegistry, flow: FlowInstance, sessionId: string, actionName: string, input: unknown) {
  const result = await runAction({
    orgId: ORG,
    flow,
    actionName: actionName as never,
    input: input as never,
    userId: "alice",
    sessionId,
    stores,
    runtimeConfig: {}
  });
  if (result.error !== undefined) throw result.error;
}

const view = (stores: StoreRegistry, flow: FlowInstance, viewName: string, input: unknown, sessionId?: string) =>
  runView({ flow, viewName, input, userId: "alice", orgId: ORG, stores, ...(sessionId !== undefined ? { sessionId } : {}) });

describe("a template in another scope is a dependency", () => {
  it("names the template's scope, so a write to the template reaches the watcher", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "s1", "setTemplate", { text: "Hello there" });
    const answer = await view(stores, flow, "greeting", {});
    expect(answer.output).toEqual({ text: "Hello there" });
    expect(answer.topics).toEqual([{ scope: "org" }, { scope: "user" }]);
  });

  it("names it when the template is missing too, since creating it changes the answer", async () => {
    const stores = createInMemoryStores();
    const answer = await view(stores, app(), "greeting", {});
    expect(answer.output).toEqual({ text: null });
    expect(answer.topics).toEqual([{ scope: "org" }, { scope: "user" }]);
  });
});

describe("the request host's reads in a view", () => {
  it("refuses a session read in a view with no session", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine", "touch", {});
    await expect(view(stores, flow, "peekUser", { target: "mine" })).rejects.toMatchObject({ name: "NoSessionError" });
  });

  it("records the session a session view reads", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine", "touch", {});
    await act(stores, flow, "other", "touch", {});
    const answer = await view(stores, flow, "peekSession", { target: "other" }, "mine");
    expect(answer.output).toEqual({ found: true });
    expect(answer.topics).toEqual([{ scope: "session", id: "other" }]);
  });

  it("refuses a liveness read, which no topic covers", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine", "touch", {});
    await expect(view(stores, flow, "liveness", {}, "mine")).rejects.toMatchObject({ name: "UnrecordedReadError" });
  });

  it("records the session when a session view reads its items", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine", "touch", {});
    const answer = await view(stores, flow, "items", {}, "mine");
    expect(answer.topics).toEqual([{ scope: "session", id: "mine" }]);
  });
});
