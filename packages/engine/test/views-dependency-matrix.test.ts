// FIX-2623.
/**
 * Every way a view can read, against every place data lives.
 *
 * One cell per pair of read path {a resource through `ctx.resources`, a
 * template resolved for a resource, the session handle, the request host}
 * and scope {session, user, org, lineage-shared}. Each cell runs a view that
 * reads through that path, subscribes to exactly the topics its answer names,
 * has another writer change what was read, and requires the notice to arrive
 * and the view to answer differently. A read path that forgets to record
 * fails its row; a new path or scope is a new row here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResource, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "../src";
import { createInMemoryBus, createInMemoryStores, type BusTopic, type ChangeNotice } from "../src/host";
import { runView } from "../src/execution/runView";
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
const overlap = {
  notes: defineResourceCollection({ scope: "session", pattern: "notes/**", stateSchema: value }),
  sharedNotes: defineResourceCollection({ scope: "session", sharedToLineage: true, pattern: "notes/shared/*", stateSchema: value })
} as const;

type Scope = keyof typeof direct;
const SCOPES: Scope[] = ["session", "user", "org", "lineage"];
const resources = {
  ...Object.fromEntries(
    [...Object.values(direct), ...Object.values(template), ...Object.values(rendered)].map((r) => [(r as { ref: string }).ref, r])
  ),
  ...overlap
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
views.host_session = defineView({
  scope: "session",
  block: handler({
    name: "read-peer",
    inputSchema: z.object({}),
    outputSchema: out,
    resources,
    execute: async (_input, ctx) => ({ v: (await requestHostOf(ctx)?.sessions?.read("c")) === undefined ? "absent" : "present" })
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
    ...(parent !== undefined ? { parentSessionId: parent } : {})
  };
  await stores.session.set(id, record, "any");
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function cell(viewName: string, actionName: string, writer: string, writeFirst = true) {
  const bus = createInMemoryBus();
  const stores = { ...createInMemoryStores(), bus };
  await seed(stores, "root");
  await seed(stores, "a", "root");
  await seed(stores, "b", "root");
  const write = async (v: string) => {
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
  const before = await runView({ flow, viewName, input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
  const heard: ChangeNotice[] = [];
  for (const t of before.topics) {
    const busTopic: BusTopic =
      t.scope === "session" ? { scope: "session", id: t.id, tenantId: "" } : { scope: t.scope, id: t.scope === "user" ? "u_1" : DEFAULT_ORG_ID, tenantId: "" };
    bus.subscribe(busTopic, (notice) => heard.push(notice));
  }
  await write("2");
  const after = await runView({ flow, viewName, input: {}, userId: "u_1", orgId: DEFAULT_ORG_ID, sessionId: "a", stores });
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
      });
    }
  }

  it("overlapping collections × lineage", async () => {
    const { before, after, heard } = await cell("overlap_lineage", "overlap_lineage", "b");
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
  });

  it("session handle × session", async () => {
    const { before, after, heard } = await cell("handle_session", "say", "a");
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
  });

  it("request host × session", async () => {
    // The peer session doesn't exist yet; its first run makes it.
    const { before, after, heard } = await cell("host_session", "say", "c", false);
    expect(after.output).not.toEqual(before.output);
    expect(heard, JSON.stringify(before.topics)).not.toEqual([]);
  });
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
});
