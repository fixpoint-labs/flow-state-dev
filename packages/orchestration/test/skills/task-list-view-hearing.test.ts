// FIX-2625: Cursor's security review and Codex's P2 on #5232. FIX-2733: a lineage-shared session board.
/**
 * What a board's task-list view hears, across members and across time.
 *
 * - On an org board, a member's answer names no other member's session. A
 *   task's filer is stripped from every client payload, so a topic naming
 *   the filer's session would leak it. The org ledger's own notices (on the
 *   org topic) carry a change to a row already on screen.
 * - On any shared ledger, a row filed after the view answered, from a session
 *   the answer never listed, still reaches the screen: every filing publishes
 *   an insert notice on the board's scope topic, which the answer hears. A
 *   session ledger shared to its lineage is the running session's on its
 *   scope topic, so its filings also go out on the owner's user topic,
 *   narrowed to the board and naming no task, as a lineage-shared resource's
 *   writes do.
 *
 * Run through the real engine (`runAction`, `runView`) on an in-memory bus.
 * Whether a notice reaches the screen is decided by the client's own rule for
 * an answer's `hears` (`hearsNotice`).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryBus, createInMemoryStores, type ChangeNotice, type SessionRecord } from "@flow-state-dev/engine/host";
import { runView } from "@flow-state-dev/engine/internal";
import { hearsNotice } from "@flow-state-dev/contracts/types/view-hearing";
import type { WireNotice } from "@flow-state-dev/contracts/types/push-delivery";
import { z } from "zod";
import { defineTaskCollection, getOrCreateTaskCollection, resolveResourceCollection } from "../../src/tasks";
import { taskToolViews } from "../../src/skills/views/task-list-view";

const BOARD = "desk";
const LIST = "listTasks_desk";

type Who = { user: string; session: string };

/** A board's ledger: at the user or org, or at the session, shared to its lineage or not. */
type Ledger = "user" | "org" | "lineage" | "session";

function boardFlow(ledger: Ledger): FlowInstance {
  async function desk(ctx: BlockContext) {
    const collection = resolveResourceCollection(ctx, BOARD);
    if (collection === undefined) throw new Error("the board is not declared");
    return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
  }
  const action = (name: string, run: (board: Awaited<ReturnType<typeof desk>>, id: string) => Promise<unknown>) => ({
    block: handler({
      name,
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({}),
      execute: async (input, ctx) => {
        await run(await desk(ctx), input.id);
        return {};
      }
    })
  });
  const tasks =
    ledger === "lineage"
      ? defineTaskCollection({ id: BOARD, scope: "session", sharedToLineage: true, delivery: {} })
      : defineTaskCollection({ id: BOARD, scope: ledger, delivery: {} });
  return defineFlow({
    kind: `board-${ledger}`,
    resources: { [BOARD]: tasks },
    actions: {
      file: action("file", (board, id) => board.createTask({ id, goal: `do ${id}` })),
      hold: action("hold", (board, id) => board.hold(id)),
      // Opens the caller's session, which a view reads in and never writes.
      open: action("open", async () => undefined)
    },
    views: taskToolViews(BOARD, async (ctx) => desk(ctx))
  })() as unknown as FlowInstance;
}

async function boot(ledger: Ledger, lineage: { root: Who; member: Who } | undefined = undefined) {
  const flow = boardFlow(ledger);
  const bus = createInMemoryBus();
  const stores = { ...createInMemoryStores(), bus };
  if (lineage !== undefined) {
    // The state a task dispatch writes: the child carries its parent's user and lineage.
    const ts = 1_700_000_000_000;
    const base = { flowKind: flow.kind, flowId: flow.id, userId: lineage.root.user, orgId: DEFAULT_ORG_ID, state: {}, version: 0, createdAt: ts, updatedAt: ts, journal: [], lineageId: "lin_desk" };
    await stores.session.set(lineage.root.session, { ...base, id: lineage.root.session } as SessionRecord, "any");
    await stores.session.set(lineage.member.session, { ...base, id: lineage.member.session, parentSessionId: lineage.root.session } as SessionRecord, "any");
  }
  const act = async (who: Who, actionName: "file" | "hold" | "open", id: string) => {
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName,
      input: { id },
      userId: who.user,
      sessionId: who.session,
      stores,
      // A host that serves views: every resource write publishes, as `serve()`'s does.
      runtimeConfig: { requestHost: { hostHasViews: () => true } }
    });
    if (result.error !== undefined) throw new Error(`${actionName}: ${JSON.stringify(result.error)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const view = (who: Who) => runView({ flow, viewName: LIST, input: {}, userId: who.user, orgId: DEFAULT_ORG_ID, sessionId: who.session, stores });
  /** Every notice the viewer's scopes publish while `run` runs, on any of the viewer's topics. */
  const heardDuring = async (viewer: Who, run: () => Promise<void>) => {
    const heard: ChangeNotice[] = [];
    const offs = [
      bus.subscribe({ scope: "session", id: viewer.session, tenantId: "" }, (n) => heard.push(n)),
      bus.subscribe({ scope: "user", id: viewer.user, tenantId: "" }, (n) => heard.push(n)),
      bus.subscribe({ scope: "org", id: DEFAULT_ORG_ID, tenantId: "" }, (n) => heard.push(n))
    ];
    await run();
    for (const off of offs) off();
    return heard;
  };
  return { act, view, heardDuring };
}

const alice: Who = { user: "alice", session: "alice-conv" };
const bob: Who = { user: "bob", session: "bob-conv" };

describe("an org board's task-list view, watched by a member who didn't file its rows", () => {
  it("names no session of another member in what its answer hears", async () => {
    const { act, view } = await boot("org");
    await act(alice, "file", "t1");
    await act(bob, "file", "t2");

    const answer = await view(bob);
    expect((answer.output as Array<{ id: string }>).map((task) => task.id).sort()).toEqual(["t1", "t2"]);
    const sessions = [...answer.topics, ...answer.hears.map((hearing) => hearing.topic)].filter((topic) => topic.scope === "session");
    expect(sessions.filter((topic) => topic.id !== bob.session)).toEqual([]);
    expect(JSON.stringify(answer.hears)).not.toContain(alice.session);
  });

  it("still hears another member's change to a row on screen", async () => {
    const { act, view, heardDuring } = await boot("org");
    await act(alice, "file", "t1");
    await act(bob, "open", "");
    const answer = await view(bob);

    const heard = await heardDuring(bob, () => act(alice, "hold", "t1"));
    expect(heard.some((notice) => hearsNotice(answer.hears, notice as WireNotice))).toBe(true);
  });
});

describe("a board's task-list view hears a filing from a session its answer never listed", () => {
  // A user ledger is shared by the user's sessions; an org ledger by its members.
  const writers = { user: { user: "alice", session: "alice-other" }, org: bob } as const;
  for (const scope of ["user", "org"] as const) {
    it(`${scope} ledger: the viewer answers on an empty board, then another session files its first task`, async () => {
      const { act, view, heardDuring } = await boot(scope);
      await act(alice, "open", "");
      const answer = await view(alice);
      expect(answer.output).toEqual([]);

      const heard = await heardDuring(alice, () => act(writers[scope], "file", "w1"));
      expect(heard.filter((notice) => hearsNotice(answer.hears, notice as WireNotice)).map((notice) => notice.kind)).toContain("board");
    });
  }
});

describe("a session board shared to its lineage", () => {
  const member: Who = { user: "alice", session: "alice-child" };

  it("hears a lineage member's first filing after the viewer answered on an empty board", async () => {
    const { act, view, heardDuring } = await boot("lineage", { root: alice, member });
    const answer = await view(alice);
    expect(answer.output).toEqual([]);

    const heard = await heardDuring(alice, () => act(member, "file", "w1"));
    expect(heard.filter((notice) => hearsNotice(answer.hears, notice as WireNotice)).map((notice) => notice.kind)).toContain("board");
    // And the row it hears of is on the board when the view reads again.
    expect(((await view(alice)).output as Array<{ id: string }>).map((task) => task.id)).toEqual(["w1"]);
  });

  it("names no task on the owner's user topic", async () => {
    const { act, view, heardDuring } = await boot("lineage", { root: alice, member });
    await view(alice);

    const heard = await heardDuring(alice, () => act(member, "file", "w1"));
    const onUser = heard.filter((notice) => notice.kind === "board" && notice.topic.scope === "user");
    expect(onUser.map((notice) => notice.topic.resource)).toEqual([BOARD]);
    expect(onUser.every((notice) => notice.ids === undefined)).toBe(true);
  });

  it("not shared to its lineage, publishes a filing on the running session only", async () => {
    const { act, heardDuring } = await boot("session");
    const heard = await heardDuring(alice, () => act(alice, "file", "w1"));
    const inserts = heard.filter((notice) => notice.kind === "board");
    expect(inserts).not.toEqual([]);
    expect(inserts.every((notice) => notice.topic.scope === "session" && notice.topic.id === alice.session)).toBe(true);
  });
});
