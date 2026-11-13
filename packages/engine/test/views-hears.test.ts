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
import { createInMemoryStores } from "../src/host";
import { runView } from "../src/execution/runView";

const workers = defineResourceCollection({ scope: "user", pattern: "workers/*", stateSchema: z.object({ name: z.string().default("") }) });
const pins = defineResource({ scope: "user", ref: "pins", stateSchema: z.object({ n: z.number().default(0) }) });
const desk = defineResourceCollection({ scope: "user", pattern: "desk/**", stateSchema: z.object({}).passthrough() });
const resources = { workers, pins, desk };
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
      board: view("board", async (ctx) => {
        const ledger = ctx.resources.desk;
        const rows = await ledger.list();
        recordBoardRead(ctx, { board: "desk", sessionIds: [ctx.session.identity.id, "filer-2", ctx.session.identity.id], ledger });
        return rows.length;
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

  it("a board read hears the board's notices on each session it names, and not its ledger's scope", async () => {
    const answer = await run("board");
    expect(answer.topics).toEqual([
      { scope: "session", id: "filer-2", resource: "desk" },
      { scope: "session", id: "s1", resource: "desk" }
    ]);
    expect(answer.hears).toEqual([
      { topic: { scope: "session", id: "filer-2", resource: "desk" }, kinds: ["board"] },
      { topic: { scope: "session", id: "s1", resource: "desk" }, kinds: ["board"] }
    ]);
  });

  it("a board read that names no session keeps its ledger's resource notices", async () => {
    const answer = await run("boardNoSession");
    expect(answer.hears).toEqual([{ topic: { scope: "user" }, kinds: ["resource"], paths: ["desk"] }]);
  });
});
