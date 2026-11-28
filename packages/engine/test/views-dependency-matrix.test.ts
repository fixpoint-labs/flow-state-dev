// FIX-2623.
/**
 * Every way a view can read, against every place data lives.
 *
 * One cell per pair of read path {a resource through `ctx.resources`, a
 * template resolved for a resource, the session handle, the request host}
 * and scope {session, user, org, lineage-shared}. Each cell runs a view that
 * reads through that path, subscribes to exactly the topics its answer names,
 * has another writer change what was read, and requires the notice to arrive,
 * the answer's hearing to admit it (FIX-2625), and the view to answer
 * differently. A read path that forgets to record fails its row; a new path or
 * scope is a new row here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResource, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import { hearsNotice } from "@flow-state-dev/contracts/types/view-hearing";
import type { WireNotice } from "@flow-state-dev/contracts/types/push-delivery";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowRegistry, runAction } from "../src";
import { handleCreateCollectionResource } from "../src/routes/resource-routes";
import { createInMemoryBus, createInMemoryStores, withChangeBus, type BusTopic, type ChangeNotice } from "../src/host";
import { changeTopicHears, isChangeTopicResource, ownerTopic } from "../src/bus/owner-topic";
import { runView, type ViewAnswer } from "../src/execution/runView";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const value = z.object({ v: z.string().default("") });
const open = z.object({}).passthrough();

const direct = {
  session: defineResource({ scope: "session", ref: "dSession", stateSchema: value }),
  user: defineResource({ scope: "user", ref: "dUser", stateSchema: value }),
  org: defineResource({ scope: "org", ref: "dOrg", stateSchema: value }),
  lineage: defineResource({ scope: "session", sharedToLineage: true, ref: "dLineage", stateSchema: value })
} as const;

const template = {
  session: defineResource({ scope: "session", ref: "tSession", stateSchema: open }),
  user: defineResource({ scope: "user", ref: "tUser", stateSchema: open }),
  org: defineResource({ scope: "org", ref: "tOrg", stateSchema: open }),
  lineage: defineResource({ scope: "session", sharedToLineage: true, ref: "tLineage", stateSchema: open })
} as const;

const rendered = {
  session: defineResource({ scope: "session", ref: "rSession", stateSchema: open, contentTemplateRef: "tSession" }),
  user: defineResource({ scope: "session", ref: "rUser", stateSchema: open, contentTemplateRef: "tUser" }),
  org: defineResource({ scope: "session", ref: "rOrg", stateSchema: open, contentTemplateRef: "tOrg" }),
  lineage: defineResource({ scope: "session", ref: "rLineage", stateSchema: open, contentTemplateRef: "tLineage" })
} as const;

/**
 * An unshared collection whose pattern also covers a lineage-shared one's
 * rows: a list through the unshared handle returns the shared rows, which a
 * sibling writes.
 */
const routeGrant = { content: { read: true, create: true }, state: { read: true } } as never;
const overlap = {
  notes: defineResourceCollection({ scope: "session", pattern: "notes/**", stateSchema: value, client: routeGrant }),
  sharedNotes: defineResourceCollection({ scope: "session", sharedToLineage: true, pattern: "notes/shared/*", stateSchema: value, client: routeGrant })
} as const;

/** A per-session collection read across the owner's sessions. */
const across = defineResourceCollection({ scope: "session", pattern: "across/*", stateSchema: value });

type Scope = keyof typeof direct;
const SCOPES: Scope[] = ["session", "user", "org", "lineage"];
const resources = {
  ...Object.fromEntries(
    [...Object.values(direct), ...Object.values(template), ...Object.values(rendered)].map((r) => [(r as { ref: string }).ref, r])
  ),
  ...overlap,
  across
} as unknown as Record<string, (typeof direct)[Scope]>;
const out = z.object({ v: z.string().nullable() });

const views: Record<string, ReturnType<typeof defineView>> = {};
const actions: Record<string, ReturnType<typeof handler>> = {};
for (const scope of SCOPES) {
  views[`direct_${scope}`] = defineView({
    scope: "session",
    block: handler({
      name: `read-direct-${scope}`,
      inputSchema: z.object({}),
      outputSchema: out,
      resources,
      execute: (_input, ctx) => ({ v: (ctx.resources as any)[`d${cap(scope)}`].state.v as string })
    })
  });
  views[`template_${scope}`] = defineView({
    scope: "session",
    block: handler({
      name: `read-template-${scope}`,
      inputSchema: z.object({}),
      outputSchema: out,
      resources,
      execute: async (_input, ctx) => ({ v: (await (ctx.resources as any)[`r${cap(scope)}`].readContent()) as string | null })
    })
  });
  actions[`direct_${scope}`] = handler({
    name: `write-direct-${scope}`,
    inputSchema: z.object({ v: z.string() }),
    resources,
    execute: async (input, ctx) => {
      await (ctx.resources as any)[`d${cap(scope)}`].patchState({ v: (input as { v: string }).v });
      return { ok: true };
    }
  });
  actions[`template_${scope}`] = handler({
    name: `write-template-${scope}`,
    inputSchema: z.object({ v: z.string() }),
    resources,
    execute: async (input, ctx) => {
      await (ctx.resources as any)[`t${cap(scope)}`].writeContent((input as { v: string }).v);
      return { ok: true };
    }
  });
}
views.handle_session = defineView({
  scope: "session",
  block: handler({
    name: "read-items",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: (_input, ctx) => ({ v: String(ctx.session.items.all().length) })
  })
});
views.state_session = defineView({
  scope: "session",
  block: handler({
    name: "read-session-state",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: (_input, ctx) => ({ v: String((ctx.session.state as { n: number }).n) })
  })
});
actions.state_session = handler({
  name: "write-session-state",
  inputSchema: z.object({ v: z.string() }),
  resources,
  execute: async (input, ctx) => {
    await ctx.session.patchState({ n: Number((input as { v: string }).v) } as never);
    return { ok: true };
  }
});
views.host_session = defineView({
  scope: "session",
  block: handler({
    name: "read-peer",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    // FIX-2725 D1: which lineage the session is, the one identity a read answers.
    execute: async (_input, ctx) => ({ v: (await requestHostOf(ctx)?.sessions?.read("c"))?.lineageId ?? "absent" })
  })
});
// FIX-2725 D1: the caller's sessions listed, and a session's turns.
views.host_list = defineView({
  scope: "session",
  block: handler({
    name: "list-sessions",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: async (_input, ctx) => ({ v: String((await requestHostOf(ctx)!.sessions!.list()).sessions.length) })
  })
});
// FIX-2754: the caller's sessions listed by id.
views.host_list_ids = defineView({
  scope: "session",
  block: handler({
    name: "list-sessions-by-id",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: async (_input, ctx) => ({ v: String((await requestHostOf(ctx)!.sessions!.list({ ids: ["c"] })).sessions.length) })
  })
});
// FIX-2770: the caller's pending suspensions.
views.host_user_suspensions = defineView({
  scope: "session",
  block: handler({
    name: "read-user-suspensions",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: async (_input, ctx) => ({
      v: (await requestHostOf(ctx)!.sessions!.userSuspensions({ flowKinds: [flow.kind] })).suspensions.map((entry) => entry.suspensionId).join(",")
    })
  })
});
views.host_turns = defineView({
  scope: "session",
  block: handler({
    name: "read-turns",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: async (_input, ctx) => ({ v: String((await requestHostOf(ctx)!.sessions!.turns("c"))?.length ?? "absent") })
  })
});
views.overlap_lineage = defineView({
  scope: "session",
  block: handler({
    name: "read-overlap",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: async (_input, ctx) => ({
      v: ((await (ctx.resources as any).notes.list()) as Array<{ path: string; state: { v: string } }>)
        .map((entry) => `${entry.path}=${entry.state.v}`)
        .sort()
        .join(",")
    })
  })
});
actions.overlap_lineage = handler({
  name: "write-overlap",
  inputSchema: z.object({ v: z.string() }),
  resources,
  execute: async (input, ctx) => {
    const ref = (ctx.resources as any).sharedNotes;
    const existing = await ref.getOptional("n1");
    if (existing === undefined) await ref.create("n1", { v: (input as { v: string }).v });
    else await existing.patchState({ v: (input as { v: string }).v });
    return { ok: true };
  }
});
// The read across the owner's sessions: heard on the owner's change topic for the collection.
views.across_user = defineView({
  scope: "session",
  block: handler({
    name: "read-across-sessions",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: async (_input, ctx) => ({
      v: ((await (ctx.resources as any).acrossSessions().across.list()).entries as Array<{ session: string; value: { v: string } }>)
        .map((entry) => `${entry.session}=${entry.value.v}`)
        .join(",")
    })
  })
});
actions.across_user = handler({
  name: "write-across",
  inputSchema: z.object({ v: z.string() }),
  resources,
  execute: async (input, ctx) => {
    await (ctx.resources as any).across.upsert("n1", { v: (input as { v: string }).v });
    return { ok: true };
  }
});
actions.say = handler({ name: "say", inputSchema: z.object({ v: z.string() }), resources, execute: (input) => ({ said: (input as { v: string }).v }) });

function cap(scope: string): string {
  return scope[0]!.toUpperCase() + scope.slice(1);
}

const flow = defineFlow({
  kind: "matrix",
  session: { stateSchema: z.object({ n: z.number().default(0) }) },
  resources,
  actions: Object.fromEntries(Object.entries(actions).map(([name, block]) => [name, { block }])),
  views
})() as unknown as FlowInstance;

async function seed(stores: StoreRegistry, id: string, parent?: string) {
  const ts = 1_700_000_000_000;
  const record: SessionRecord = {
    orgId: DEFAULT_ORG_ID,
    id,
    flowKind: flow.kind,
    flowId: flow.id,
    userId: "u_1",
    state: { n: 0 },
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    lineageId: "lin_matrix",
    // Made by a person, as a door makes it: a read across sessions reaches its siblings.
    principalKind: "person",
    ...(parent !== undefined ? { parentSessionId: parent } : {})
  };
  await stores.session.set(id, record, "any");
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const registry = createFlowRegistry();
registry.register(flow);

// FIX-2625.
/**
 * The notices of `heard` a watcher of `answer` reads on, by the client's own
 * rule (`hearsNotice`).
 */
function admitted(answer: ViewAnswer, heard: readonly ChangeNotice[]): ChangeNotice[] {
  return heard.filter((notice) => hearsNotice(answer.hears, notice as WireNotice));
}

async function cell(viewName: string, actionName: string, writer: string, writeFirst = true, recreate = false) {
  const bus = createInMemoryBus();
  const stores = { ...createInMemoryStores(), bus };
  await seed(stores, "root");
  await seed(stores, "a", "root");
  await seed(stores, "b", "root");
  const write = async (v: string) => {
    if (recreate && v === "2") {
      // The session deleted and made again under its id: a new lineage.
      const published = withChangeBus(stores);
      const old = (await stores.session.get(writer))!;
      await published.session.delete(writer);
      await published.session.set(writer, { ...old, version: 0, lineageId: `lin_${v}` }, "absent");
      await tick();
      await tick();
      return;
    }
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: actionName as never,
      input: { v } as never,
      userId: "u_1",
      sessionId: writer,
      stores,
      runtimeConfig: { requestHost: { hostHasViews: () => true } }
    });
    expect(result.error).toBeUndefined();
    await tick();
    await tick();
  };
  if (writeFirst) await write("1");
  // The caller as a person's door resolves them, and the registry that admits each session a read across sessions joins.
  const caller = { principalKind: "person" as const, flows: registry };
  const before = await runView({ flow, viewName, input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores, ...caller });
  const heard: ChangeNotice[] = [];
  for (const t of before.topics) {
    // A change topic hears the owner topic's notices its pattern covers, as the socket matches them, on its own wire topic.
    if (t.scope === "user" && isChangeTopicResource(t.resource)) {
      const resource = t.resource;
      bus.subscribe(ownerTopic({ userId: "u_1", orgId: DEFAULT_ORG_ID, tenantId: undefined }, flow.id), (notice) => {
        if (changeTopicHears(resource, notice)) heard.push({ ...notice, topic: { scope: "user", id: "u_1", tenantId: "", resource } });
      });
      continue;
    }
    const busTopic: BusTopic =
      t.scope === "session" ? { scope: "session", id: t.id, tenantId: "" } : { scope: t.scope, id: t.scope === "user" ? "u_1" : DEFAULT_ORG_ID, tenantId: "" };
    bus.subscribe(busTopic, (notice) => heard.push(notice));
  }
  await write("2");
  const after = await runView({ flow, viewName, input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores, ...caller });
  return { before, after, heard };
}

describe("a view hears a change through every read path, at every scope", () => {
  for (const path of ["direct", "template"] as const) {
    for (const scope of SCOPES) {
      it(`${path} × ${scope}`, async () => {
        // A lineage-shared write comes from a sibling; the rest from another request.
        const { before, after, heard } = await cell(`${path}_${scope}`, `${path}_${scope}`, scope === "lineage" ? "b" : "a");
        expect(after.output).not.toEqual(before.output);
        expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
        expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
      });
    }
  }

  it("read across sessions × user, written in a sibling session", async () => {
    const { before, after, heard } = await cell("across_user", "across_user", "b");
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("overlapping collections × lineage", async () => {
    const { before, after, heard } = await cell("overlap_lineage", "overlap_lineage", "b");
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("session handle × session", async () => {
    const { before, after, heard } = await cell("handle_session", "say", "a");
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("session state × session", async () => {
    const { before, after, heard } = await cell("state_session", "state_session", "a");
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("request host read × session", async () => {
    // FIX-2725 D1: a read of its identity is heard on `run`, which a delete
    // and a recreate under the same id publish.
    const { before, after, heard } = await cell("host_session", "say", "c", true, true);
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("request host read × user, of a session that was deleted and is made again", async () => {
    // A view that watched a conversation and saw it deleted must still wake
    // when it is made again: a read that answers nothing is heard on the
    // caller's own user topic, where every session write publishes `run`, and
    // never on the missing session's topic, which it can't check is theirs.
    const bus = createInMemoryBus();
    const stores = { ...createInMemoryStores(), bus };
    await seed(stores, "root");
    await seed(stores, "a", "root");
    await seed(stores, "c");
    const published = withChangeBus(stores);
    const run = () => runView({ flow, viewName: "host_session", input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
    expect((await run()).output).toEqual({ v: "lin_matrix" });
    const old = (await stores.session.get("c"))!;
    await published.session.delete("c");
    await tick();
    const before = await run();
    expect(before.output).toEqual({ v: "absent" });
    expect(before.topics).not.toContainEqual({ scope: "session", id: "c" });
    const heard: ChangeNotice[] = [];
    for (const t of before.topics) {
      const busTopic: BusTopic =
        t.scope === "session" ? { scope: "session", id: t.id, tenantId: "" } : { scope: t.scope, id: t.scope === "user" ? "u_1" : DEFAULT_ORG_ID, tenantId: "" };
      bus.subscribe(busTopic, (notice) => heard.push(notice));
    }
    await published.session.set("c", { ...old, version: 0, lineageId: "lin_2" }, "absent");
    await tick();
    await tick();
    const after = await run();
    expect(after.output).toEqual({ v: "lin_2" });
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("request host turns × session, deleted", async () => {
    // A deleted session's requests stay in the store, so a turns view that
    // heard only `request` would keep showing them: it hears the session's
    // lifecycle too, which a delete publishes.
    const bus = createInMemoryBus();
    const stores = { ...createInMemoryStores(), bus };
    await seed(stores, "root");
    await seed(stores, "a", "root");
    const said = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "say" as never,
      input: { v: "1" } as never,
      userId: "u_1",
      sessionId: "c",
      stores,
      runtimeConfig: { requestHost: { hostHasViews: () => true } }
    });
    expect(said.error).toBeUndefined();
    await tick();
    const run = () => runView({ flow, viewName: "host_turns", input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
    const before = await run();
    expect(before.output).toEqual({ v: "1" });
    const heard: ChangeNotice[] = [];
    for (const t of before.topics) {
      const busTopic: BusTopic =
        t.scope === "session" ? { scope: "session", id: t.id, tenantId: "" } : { scope: t.scope, id: t.scope === "user" ? "u_1" : DEFAULT_ORG_ID, tenantId: "" };
      bus.subscribe(busTopic, (notice) => heard.push(notice));
    }
    await withChangeBus(stores).session.delete("c");
    await tick();
    await tick();
    const after = await run();
    expect(after.output).toEqual({ v: "absent" });
    expect(admitted(before, heard), `${JSON.stringify(before.hears)} heard ${JSON.stringify(heard)}`).not.toEqual([]);
  });

  it("request host user suspensions × user", async () => {
    // FIX-2770 D1: a suspension made in any session of the caller's, or none, is
    // heard on their user topic's `suspension` notice, which the suspension
    // store's wrapper publishes.
    const bus = createInMemoryBus();
    const stores = { ...createInMemoryStores(), bus };
    await seed(stores, "root");
    await seed(stores, "a", "root");
    const published = withChangeBus(stores);
    const run = () => runView({ flow, viewName: "host_user_suspensions", input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
    const before = await run();
    expect(before.output).toEqual({ v: "" });
    const heard: ChangeNotice[] = [];
    for (const t of before.topics) {
      const busTopic: BusTopic =
        t.scope === "session" ? { scope: "session", id: t.id, tenantId: "" } : { scope: t.scope, id: t.scope === "user" ? "u_1" : DEFAULT_ORG_ID, tenantId: "" };
      bus.subscribe(busTopic, (notice) => heard.push(notice));
    }
    const ts = Date.now();
    await published.request.set(
      "r_stop",
      { id: "r_stop", state: {}, version: 0, createdAt: ts, updatedAt: ts, flowKind: flow.kind, flowId: flow.id, actionName: "say", userId: "u_1", orgId: DEFAULT_ORG_ID, source: "http", status: "suspended", startedAtMs: ts },
      "absent"
    );
    await published.suspensions.set({
      suspensionId: "s_stop",
      requestId: "r_stop",
      flowKind: flow.kind,
      flowId: flow.id,
      actionName: "say",
      userId: "u_1",
      reason: "user_approval",
      message: "ok?",
      status: "pending",
      blockInstanceId: "b",
      stepIndex: 0,
      createdAt: ts
    });
    await tick();
    await tick();
    const after = await run();
    expect(after.output).toEqual({ v: "s_stop" });
    expect(admitted(before, heard), `${JSON.stringify(before.hears)} heard ${JSON.stringify(heard)}`).not.toEqual([]);
    expect(admitted(before, heard).every((notice) => notice.kind === "suspension")).toBe(true);
  });

  it("request host list × user", async () => {
    // A first run in a new session makes it, on the caller's user topic.
    const { before, after, heard } = await cell("host_list", "say", "c", false);
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("request host list by ids × user, of a session made after the read", async () => {
    // A list by id hears as the list does, on the caller's own user topic,
    // never on the asked-for session's topic, which it can't check is theirs.
    const { before, after, heard } = await cell("host_list_ids", "say", "c", false);
    expect(before.output).toEqual({ v: "0" });
    expect(after.output).toEqual({ v: "1" });
    expect(before.topics).not.toContainEqual({ scope: "session", id: "c" });
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });

  it("request host turns × session", async () => {
    const { before, after, heard } = await cell("host_turns", "say", "c");
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
    expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
  });
});

describe("a browser's write through the resource routes reaches the same view", () => {
  // Each read cell is also driven by the HTTP write path: a create from a
  // sibling session `b`, addressed through the shared handle or through the
  // unshared one whose pattern covers it, with and without the auth layer's
  // checked session.
  for (const ref of ["sharedNotes", "notes"] as const) {
    for (const checked of [true, false]) {
      it(`route create through ${ref} × lineage, checked session ${checked ? "given" : "absent"}`, async () => {
        const bus = createInMemoryBus();
        const stores = { ...createInMemoryStores(), bus };
        await seed(stores, "root");
        await seed(stores, "a", "root");
        await seed(stores, "b", "root");
        const registry = createFlowRegistry();
        registry.register(flow);
        const before = await runView({ flow, viewName: "overlap_lineage", input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
        const heard: ChangeNotice[] = [];
        for (const t of before.topics) {
          const busTopic: BusTopic =
            t.scope === "session" ? { scope: "session", id: t.id, tenantId: "" } : { scope: t.scope, id: t.scope === "user" ? "u_1" : DEFAULT_ORG_ID, tenantId: "" };
          bus.subscribe(busTopic, (notice) => heard.push(notice));
        }
        const topic = ref === "notes" ? "shared/n2" : "n2";
        const created = await handleCreateCollectionResource(
          new Request(`http://x/sessions/b/resources/${ref}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, content: "hi", state: { v: "web" } }) }),
          { kind: "create_collection_item", sessionId: "b", ref },
          { registry, stores, ...(checked ? { checkedSession: (await stores.session.get("b"))! } : {}) }
        );
        expect(created.status, await created.clone().text()).toBe(201);
        await tick();
        const after = await runView({ flow, viewName: "overlap_lineage", input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
        expect(after.output).not.toEqual(before.output);
        expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
        expect(admitted(before, heard), JSON.stringify(before.hears)).not.toEqual([]);
      });
    }
  }
});

describe("one way to record a view's dependency", () => {
  it("the execution context hands the raw recorder only to the dependency surface", () => {
    // A read path that records by hand can forget a topic rule (the lineage
    // one, a template's scope); one that goes through the surface can't.
    const source = readFileSync(new URL("../src/context/createExecutionContext.ts", import.meta.url), "utf8");
    // The recorder is read off `options` twice (the presence check and the
    // call that passes it to the surface) and named nowhere else.
    expect(source.match(/[\w.]*\brecordRead\b/g)).toEqual(["options.recordRead", "options.recordRead"]);
    expect(source).toMatch(/createViewDependencies\(options\.recordRead, sessionId,/);
  });

  it("every session resource write publishes through the one publish surface", () => {
    // The mirror of the recorder check: a writer that publishes by hand can
    // forget the lineage rule the read side records.
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const routes = read("../src/routes/resource-routes.ts");
    expect(routes).not.toMatch(/publishScopeChange\(/);
    expect(routes).toMatch(/publishSessionResourceChange\(/);
    const context = read("../src/context/createExecutionContext.ts");
    const resourceNotices = context
      .split("\n")
      .filter((line) => /publishScopeNotice\([^)]*"resource"/.test(line) && !line.includes("function publishScopeNotice"));
    expect(resourceNotices).toEqual([expect.stringContaining("if (notice !== undefined) publishScopeNotice(scope, \"resource\"")]);
    expect(context).toMatch(/if \(scope !== "session"\) \{\n\s*if \(notice !== undefined\) publishScopeNotice/);
    expect(context).toMatch(/publishSessionResourceChange\(stores\.bus,/);
  });
});
