/**
 * Views over a lineage-shared resource (FIX-2623 D1): a `sharedToLineage`
 * session resource has one identity across a session lineage, so a sibling's
 * write changes what a session view in another member shows. The view's
 * answer must name a topic that write publishes on, or its watcher never
 * hears it. Every lineage member belongs to one user, so the write also
 * publishes on that user's topic, and the view records the user's topic.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResource, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowRegistry, runAction } from "../src";
import { handleCreateCollectionResource } from "../src/routes/resource-routes";
import { createInMemoryBus, createInMemoryStores, type BusTopic, type ChangeNotice } from "../src/host";
import { runView } from "../src/execution/runView";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const board = defineResource({
  scope: "session",
  sharedToLineage: true,
  ref: "board",
  stateSchema: z.object({ note: z.string().default("") })
});

const write = handler({
  name: "write-board",
  inputSchema: z.object({ note: z.string() }),
  resources: { board },
  execute: async (input, ctx) => {
    await ctx.resources.board.patchState({ note: input.note });
    return { ok: true };
  }
});

const readBoard = handler({
  name: "read-board",
  inputSchema: z.object({}),
  outputSchema: z.object({ note: z.string() }),
  resources: { board },
  execute: (_input, ctx) => ({ note: ctx.resources.board.state.note })
});

const notes = defineResourceCollection({
  pattern: "notes/*",
  scope: "session",
  sharedToLineage: true,
  stateSchema: z.object({ title: z.string().default("") }),
  client: { content: { read: true, create: true }, state: { read: true } } as never
});

const flow = defineFlow({
  kind: "lineage-desk",
  actions: { write },
  resources: { board, notes },
  views: { board: defineView({ scope: "session", block: readBoard }) }
})() as unknown as FlowInstance;

async function seed(stores: StoreRegistry, id: string, lineageId: string, parent?: string) {
  const ts = 1_700_000_000_000;
  const record: SessionRecord = {
    orgId: DEFAULT_ORG_ID,
    id,
    flowKind: flow.kind,
    flowId: flow.id,
    userId: "u_1",
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    lineageId,
    ...(parent !== undefined ? { parentSessionId: parent } : {})
  };
  await stores.session.set(id, record, "any");
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a session view over a lineage-shared resource", () => {
  it("names a topic a sibling's write publishes on", async () => {
    const bus = createInMemoryBus();
    const stores = { ...createInMemoryStores(), bus };
    await seed(stores, "root", "lin_shared");
    await seed(stores, "a", "lin_shared", "root");
    await seed(stores, "b", "lin_shared", "root");

    const answer = await runView({ flow, viewName: "board", input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
    expect(answer.output).toEqual({ note: "" });

    // Listen where the view's answer says to.
    const heard: ChangeNotice[] = [];
    for (const t of answer.topics) {
      const busTopic: BusTopic = t.scope === "session" ? { scope: "session", id: t.id, tenantId: "" } : { scope: t.scope, id: t.scope === "user" ? "u_1" : DEFAULT_ORG_ID, tenantId: "" };
      bus.subscribe(busTopic, (notice) => heard.push(notice));
    }

    // The sibling writes the shared resource.
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "write" as never,
      input: { note: "from b" } as never,
      userId: "u_1",
      sessionId: "b",
      stores,
      runtimeConfig: { requestHost: { hostHasViews: () => true } }
    });
    expect(result.error).toBeUndefined();
    await tick();
    await tick();

    const again = await runView({ flow, viewName: "board", input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
    expect(answer.topics).toEqual([{ scope: "session", id: "a" }, { scope: "user" }]);
    expect(again.output).toEqual({ note: "from b" });
    expect(heard.filter((n) => n.kind === "resource")).not.toEqual([]);
  });

  it("publishes a browser's write to a lineage-shared row on the owner's topic too", async () => {
    const bus = createInMemoryBus();
    const stores = { ...createInMemoryStores(), bus };
    await seed(stores, "root", "lin_shared");
    await seed(stores, "b", "lin_shared", "root");
    const registry = createFlowRegistry();
    registry.register(flow);
    const heard: ChangeNotice[] = [];
    bus.subscribe({ scope: "user", id: "u_1", tenantId: "" }, (notice) => heard.push(notice));
    const created = await handleCreateCollectionResource(
      new Request("http://x/sessions/b/resources/notes", { method: "POST", body: JSON.stringify({ topic: "n1", content: "hi" }) }),
      { kind: "create_collection_item", sessionId: "b", ref: "notes" },
      { registry, stores, checkedSession: (await stores.session.get("b"))! }
    );
    expect(created.status).toBe(201);
    await tick();
    expect(heard.filter((n) => n.kind === "resource")).toHaveLength(1);
  });

  it("joins no one else to a lineage: a session born outside a dispatch roots its own", async () => {
    // The user-topic publish rests on every lineage member having one owner.
    // A lineage is inherited only by a same-flow dispatch child, which carries
    // the parent's user, and a record of another user is never adopted
    // (`dispatch-run.test.ts`, "refuses a record belonging to another principal").
    // Every other birth, any user's, mints a lineage of its own.
    const stores = createInMemoryStores();
    await seed(stores, "root", "lin_shared");
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "write" as never,
      input: { note: "bob" } as never,
      userId: "bob",
      sessionId: "bob-1",
      stores,
      runtimeConfig: {}
    });
    expect(result.error).toBeUndefined();
    const born = await stores.session.get("bob-1");
    expect(born?.userId).toBe("bob");
    expect(born?.lineageId).toMatch(/^lin_/);
    expect(born?.lineageId).not.toBe("lin_shared");
  });
});
