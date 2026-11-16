// FIX-2625.
/**
 * What a view's answer says it hears: per topic, the kinds of notice that may
 * change what its run read and, for a resource, the roots its path must fall
 * under. A watcher reads on nothing else.
 *
 * Why it matters: a view listened to its whole scope, so a pin woke the
 * roster's view and a hire's run notices made it read again; and a board read
 * through its task collection heard its ledger's user-topic notices, which
 * name no task, so one task's change answered the whole board.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineResource, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import { recordBoardRead } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createInMemoryBus, createInMemoryStores, type ChangeNotice } from "../src/host";
import { runAction } from "../src";
import { runView } from "../src/execution/runView";

const workers = defineResourceCollection({ scope: "user", pattern: "workers/*", stateSchema: z.object({ name: z.string().default("") }) });
const pins = defineResource({ scope: "user", ref: "pins", stateSchema: z.object({ n: z.number().default(0) }) });
const desk = defineResourceCollection({ scope: "user", pattern: "desk/**", stateSchema: z.object({}).passthrough() });
const orgDesk = defineResourceCollection({ scope: "org", pattern: "org-desk/**", stateSchema: z.object({}).passthrough() });
const resources = { workers, pins, desk, orgDesk };
const out = z.object({ n: z.number() });

const view = (name: string, execute: (ctx: any) => Promise<number> | number) =>
  defineView({
    scope: "session",
    block: handler({ name, inputSchema: z.object({}), outputSchema: out, resources, execute: async (_input, ctx) => ({ n: await execute(ctx) }) })
  });

function flow(): FlowInstance {
  return defineFlow({
    kind: "hears",
    user: { stateSchema: z.object({ theme: z.string().default("light") }) },
    resources,
    actions: {},
    views: {
      roster: view("roster", async (ctx) => (await ctx.resources.workers.list()).length),
      rosterAndTheme: view("roster-and-theme", async (ctx) => (await ctx.resources.workers.list()).length + ctx.user.state.theme.length),
      pinned: view("pinned", (ctx) => ctx.resources.pins.state.n),
      items: view("items", (ctx) => ctx.session.items.all().length),
      sessionState: view("session-state", (ctx) => Object.keys(ctx.session.state).length),
      board: view("board", async (ctx) => {
        const ledger = ctx.resources.desk;
        const entries = await ledger.list();
        recordBoardRead(ctx, { board: "desk", sessionIds: [ctx.session.identity.id, "filer-2", ctx.session.identity.id], ledger });
        return entries.length;
      }),
      orgBoard: view("org-board", async (ctx) => {
        const ledger = ctx.resources.orgDesk;
        const entries = await ledger.list();
        recordBoardRead(ctx, { board: "org-desk", sessionIds: [ctx.session.identity.id, "filer-2"], ledger });
        return entries.length;
      }),
      boardNoSession: view("board-no-session", async (ctx) => {
        const ledger = ctx.resources.desk;
        recordBoardRead(ctx, { board: "desk", sessionIds: [], ledger });
        return (await ledger.list()).length;
      })
    }
  })() as unknown as FlowInstance;
}

async function run(viewName: string) {
  const stores = createInMemoryStores();
  const f = flow();
  const at = 1_700_000_000_000;
  await stores.session.set(
    "s1",
    { orgId: DEFAULT_ORG_ID, id: "s1", flowKind: f.kind, flowId: f.id, userId: "alice", state: {}, version: 0, createdAt: at, updatedAt: at, journal: [] },
    "any"
  );
  return runView({ flow: f, viewName, input: {}, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "s1", stores });
}

describe("a view's answer says which notices change what it read", () => {
  it("a collection read hears resource notices under the collection's root, and nothing else on its scope", async () => {
    const answer = await run("roster");
    expect(answer.topics).toEqual([{ scope: "user" }]);
    expect(answer.hears).toEqual([{ topic: { scope: "user" }, kinds: ["resource"], paths: ["workers"] }]);
  });

  it("a single resource read hears its own key; a state read adds the state kind on the same topic", async () => {
    expect((await run("pinned")).hears).toEqual([{ topic: { scope: "user" }, kinds: ["resource"], paths: ["pins"] }]);
    expect((await run("rosterAndTheme")).hears).toEqual([{ topic: { scope: "user" }, kinds: ["state", "resource"], paths: ["workers"] }]);
  });

  it("a session read hears every change to the session but its resources and boards", async () => {
    expect((await run("items")).hears).toEqual([{ topic: { scope: "session", id: "s1" }, kinds: ["items", "request", "run", "state"] }]);
  });

  it("a session state read hears the session's state writes, not a reply streaming in it or a request stamping it", async () => {
    // A board view reads its conversation's state to find its worker. A reply's items, its
    // request's moves and the request stamping the session record (`run`) change no state:
    // hearing them re-read an idle board on every chunk and every turn.
    expect((await run("sessionState")).hears).toEqual([{ topic: { scope: "session", id: "s1" }, kinds: ["state"] }]);
  });

  // A user ledger's filing in a session the answer never named is heard as
  // its insert notice on the user topic, narrowed to the board (no ids: the
  // user topic spans the user's orgs).
  it("a user board read hears the board's notices on each session it names and on the user topic, and not its ledger's resource notices", async () => {
    const answer = await run("board");
    expect(answer.topics).toEqual([
      { scope: "session", id: "filer-2", resource: "desk" },
      { scope: "session", id: "s1", resource: "desk" },
      { scope: "user", resource: "desk" }
    ]);
    expect(answer.hears).toEqual([
      { topic: { scope: "session", id: "filer-2", resource: "desk" }, kinds: ["board"] },
      { topic: { scope: "session", id: "s1", resource: "desk" }, kinds: ["board"] },
      { topic: { scope: "user", resource: "desk" }, kinds: ["board"] }
    ]);
  });

  // Cursor on #5232: a session another member filed from is not the viewer's
  // to be told of. An org board hears its ledger on the org topic, and its
  // insert notices there.
  it("an org board read hears the org topic only: its ledger's notices and the board's insert notices, no session", async () => {
    const answer = await run("orgBoard");
    expect(answer.topics).toEqual([{ scope: "org" }, { scope: "org", resource: "org-desk" }]);
    expect(answer.hears).toEqual([
      { topic: { scope: "org" }, kinds: ["resource"], paths: ["org-desk"] },
      { topic: { scope: "org", resource: "org-desk" }, kinds: ["board"] }
    ]);
  });

  it("a board read that names no session keeps its ledger's resource notices", async () => {
    const answer = await run("boardNoSession");
    expect(answer.hears).toEqual([{ topic: { scope: "user" }, kinds: ["resource"], paths: ["desk"] }]);
  });

  // Codex on #5232: two user collections overlap; a write through the broader
  // one, from a flow that doesn't declare the narrower (another flow, the
  // default write flow), names its own root on the user topic: an ancestor of
  // the narrower root a view hears.
  it("an overlapping broader collection's write names its root, an ancestor of the narrower root a view hears", async () => {
    const allNotes = defineResourceCollection({ scope: "user", pattern: "notes/**", stateSchema: z.object({ v: z.string().default("") }) });
    const sharedNotes = defineResourceCollection({ scope: "user", pattern: "notes/shared/*", stateSchema: z.object({ v: z.string().default("") }) });
    const writer = defineFlow({
      kind: "notes-writer",
      resources: { allNotes },
      actions: {
        write: {
          block: handler({
            name: "write",
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            resources: { allNotes },
            execute: async (_input, ctx) => (await ctx.resources.allNotes.create("shared/a", { v: "x" }), {})
          })
        }
      }
    })() as unknown as FlowInstance;
    const overlap = defineFlow({
      kind: "overlap",
      resources: { sharedNotes },
      actions: {},
      views: {
        shared: defineView({
          scope: "user",
          block: handler({
            name: "shared",
            inputSchema: z.object({}),
            outputSchema: out,
            resources: { sharedNotes },
            execute: async (_input, ctx) => ({ n: (await ctx.resources.sharedNotes.list()).length })
          })
        })
      }
    })() as unknown as FlowInstance;
    const bus = createInMemoryBus();
    const stores = { ...createInMemoryStores(), bus };
    const answer = await runView({ flow: overlap, viewName: "shared", input: {}, userId: "alice", orgId: DEFAULT_ORG_ID, stores });
    expect(answer.hears).toEqual([{ topic: { scope: "user" }, kinds: ["resource"], paths: ["notes/shared"] }]);
    const heard: ChangeNotice[] = [];
    bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (notice) => heard.push(notice));
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: writer,
      actionName: "write" as never,
      input: {} as never,
      userId: "alice",
      sessionId: "w1",
      stores,
      runtimeConfig: { requestHost: { hostHasViews: () => true } }
    });
    expect(result.error).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(heard.filter((n) => n.kind === "resource").map((n) => n.topic.resource)).toEqual(["notes"]);
  });
});
