/**
 * A task board's change publishes a board notice (FIX-2429), from whichever
 * session writes it, on the topic of the session that filed the row, narrowed
 * to the board.
 *
 * Run through the real runtime, so the engine's seam is the one every block
 * gets: a conversation files a row on a user-scoped ledger, and a task session
 * (another session of the user) claims and settles it. The conversation's view
 * of the board hears every write; the task session's own topic hears none, and
 * a row with no filer (a board on request state) goes on the session that
 * wrote it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createInMemoryBus, type ChangeNotice } from "@flow-state-dev/engine/host";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { z } from "zod";
import { defineTaskCollection, getOrCreateTaskCollection, resolveResourceCollection, ticketForClaim } from "../../src/tasks";

const BOARD = "desk";

async function desk(ctx: BlockContext) {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) throw new Error("the board is not declared");
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

const flow = defineFlow({
  kind: "board-notice",
  resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "user", delivery: {} }) },
  actions: {
    file: {
      block: handler({
        name: "file",
        outputSchema: z.object({ id: z.string() }),
        execute: async (_input, ctx) => ({ id: (await (await desk(ctx)).createTask({ goal: "look it up", assignee: "researcher" })).id })
      })
    },
    settle: {
      block: handler({
        name: "settle",
        outputSchema: z.object({}),
        execute: async (_input, ctx) => {
          const board = await desk(ctx);
          const claimed = await board.claim("researcher-worker");
          if (claimed === null) throw new Error("nothing to claim");
          await board.complete(claimed.id, { answer: 42 });
          return {};
        }
      })
    },
    // A run's spend tick: a write that changes what the board's read shows (its model,
    // tokens and cost) and emits no task-change item.
    spend: {
      block: handler({
        name: "spend",
        outputSchema: z.object({}),
        execute: async (_input, ctx) => {
          // A request of its own, on a row claimed earlier: only the spend write happens here.
          const board = await desk(ctx);
          const row = board.list()[0];
          if (row === undefined) throw new Error("nothing filed");
          await board.recordSpend!(
            row.id,
            { requestId: ctx.request.identity.id, part: "live", spend: { byModel: { "openai/gpt-6-luna": { prompt: 10, completion: 5, total: 15, cacheReadTokens: 0, cacheCreationTokens: 0 } }, harnessRuns: [] } },
            { claim: ticketForClaim(BOARD, row) }
          );
          return {};
        }
      })
    },
    scratch: {
      block: handler({
        name: "scratch",
        outputSchema: z.object({}),
        execute: async (_input, ctx) => {
          const board = await getOrCreateTaskCollection({ ctx, backing: "state", collectionId: "scratch" });
          await board.createTask({ goal: "a step" });
          return {};
        }
      })
    }
  }
})();

function boot() {
  const bus = createInMemoryBus();
  const stores = { ...createInMemoryStores(), bus };
  const heard = (id: string, resource?: string) => {
    const notices: ChangeNotice[] = [];
    bus.subscribe({ scope: "session", id, tenantId: "", ...(resource !== undefined ? { resource } : {}) }, (n) => {
      if (n.kind === "board") notices.push(n);
    });
    return notices;
  };
  const run = async (actionName: "file" | "settle" | "scratch" | "spend", sessionId: string) => {
    const result = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName, input: {}, userId: "alice", sessionId, stores, runtimeConfig: {} });
    if (result.error !== undefined) throw new Error(`${actionName} failed: ${JSON.stringify(result.error)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    lastOutput = result.output;
    return result.requestId!;
  };
  let lastOutput: unknown;
  /** The id of the task the last `file` filed. */
  const filedTask = () => (lastOutput as { id: string }).id;
  return { heard, run, filedTask };
}

describe("a board change publishes a board notice", () => {
  it("on the filer's session, narrowed to the board, for the filing and for a settle in another session", async () => {
    const { heard, run, filedTask } = boot();
    const conversationBoard = heard("conversation", BOARD);
    const taskSession = heard("task-session");

    const filed = await run("file", "conversation");
    const task = filedTask();
    // FIX-2625: the notice names the task whose row changed.
    expect(conversationBoard).toEqual([
      { topic: { scope: "session", id: "conversation", tenantId: "", resource: BOARD }, kind: "board", origin: { requestId: filed }, ids: [task] }
    ]);

    const settled = await run("settle", "task-session");
    // The claim and the completion, folded or not: each names the settling request, and the task.
    expect(conversationBoard.length).toBeGreaterThan(1);
    expect(conversationBoard.slice(1).every((n) => n.origin?.requestId === settled)).toBe(true);
    expect(conversationBoard.slice(1).map((n) => n.ids)).toEqual(conversationBoard.slice(1).map(() => [task]));
    // The session that wrote is not where the board's view listens.
    expect(taskSession).toEqual([]);
  });

  it("on the running session for a row with no filer", async () => {
    const { heard, run } = boot();
    const scratch = heard("worker", "scratch");
    await run("scratch", "worker");
    expect(scratch.map((n) => n.topic)).toEqual([{ scope: "session", id: "worker", tenantId: "", resource: "scratch" }]);
  });

  it("for a write that emits no task-change item: a run's spend, which the board read shows", async () => {
    const { heard, run, filedTask } = boot();
    const conversationBoard = heard("conversation", BOARD);
    await run("file", "conversation");
    const task = filedTask();
    const spent = await run("spend", "task-session");
    expect(conversationBoard.filter((n) => n.origin?.requestId === spent)).toEqual([
      { topic: { scope: "session", id: "conversation", tenantId: "", resource: BOARD }, kind: "board", origin: { requestId: spent }, ids: [task] }
    ]);
  });
});

// FIX-2625: the owner's call. A view of the board hears only its board
// notices, never its ledger's user-topic ones, so a write to the ledger that
// published no board notice would leave every screen of the board stale. This
// checks it at the store: every ledger entry a request writes, through every
// write the task collection offers, has a board notice from that request
// naming its task.
describe("every write to the ledger publishes the board notice naming its task", () => {
  type Board = Awaited<ReturnType<typeof desk>>;
  /** Each step writes the ledger one way, from a session other than the filer's. */
  const steps: Array<[string, (board: Board, ctx: BlockContext) => Promise<unknown>]> = [
    ["createTask", (b) => b.createTask({ id: "a", goal: "a", assignee: "w" })],
    ["createTasks", (b) => b.createTasks([{ id: "b", goal: "b" }, { id: "c", goal: "c" }, { id: "d", goal: "d" }])],
    ["setAssignee", (b) => b.setAssignee("b", "w")],
    ["setPriority", (b) => b.setPriority("b", 3)],
    ["addLabel", (b) => b.addLabel("b", "x")],
    ["removeLabel", (b) => b.removeLabel("b", "x")],
    ["patchMetadata", (b) => b.patchMetadata("b", { k: 1 })],
    ["hold", (b) => b.hold("c")],
    ["release", (b) => b.release("c")],
    ["patchSettings", (b) => b.patchSettings("c", { maxAttempts: 3 })],
    ["claim", (b) => b.claim("w", { eligibility: (t) => t.id === "a" })],
    ["renewLease", (b) => b.renewLease("a", Date.now() + 60_000, { claim: ticketForClaim(BOARD, b.get("a")!) })],
    ["reportProgress", (b) => b.reportProgress!("a", { statusNote: "half way" }, { claim: ticketForClaim(BOARD, b.get("a")!) })],
    [
      "recordSpend",
      (b, ctx) =>
        b.recordSpend!(
          "a",
          { requestId: ctx.request.identity.id, part: "live", spend: { byModel: { "openai/gpt-6-luna": { prompt: 1, completion: 1, total: 2, cacheReadTokens: 0, cacheCreationTokens: 0 } }, harnessRuns: [] } },
          { claim: ticketForClaim(BOARD, b.get("a")!) }
        )
    ],
    [
      "linkRun",
      (b, ctx) =>
        b.linkRun("a", { sessionId: ctx.session.identity.id, requestId: ctx.request.identity.id, attempt: b.get("a")!.attempts } as never, {
          claim: ticketForClaim(BOARD, b.get("a")!)
        })
    ],
    ["steer", (b) => b.steer!("a", { message: "go left", from: "user" } as never)],
    ["takeSteers", (b) => b.takeSteers!("a", { claim: ticketForClaim(BOARD, b.get("a")!), takenIn: "turn-1" })],
    ["complete", (b) => b.complete("a", { done: true }, { claim: ticketForClaim(BOARD, b.get("a")!) })],
    ["claim and fail", async (b) => {
      const claimed = (await b.claim("w", { eligibility: (t) => t.id === "b" }))!;
      return b.fail("b", "broke", { claim: ticketForClaim(BOARD, claimed) } as never);
    }],
    ["retry", (b) => b.retry!("b")],
    ["cancel", (b) => b.cancel("c", "not needed")],
    ["claim, then reclaim a lapsed lease", async (b) => {
      await b.claim("w", { eligibility: (t) => t.id === "d" });
      // A day on: the lease has lapsed.
      return b.reclaim(Date.now() + 24 * 60 * 60_000);
    }]
  ];

  const stepFlow = defineFlow({
    kind: "board-notice-steps",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "user", delivery: {} }) },
    actions: {
      step: {
        block: handler({
          name: "step",
          inputSchema: z.object({ index: z.number() }),
          outputSchema: z.object({}),
          execute: async ({ index }, ctx) => {
            await steps[index]![1](await desk(ctx), ctx);
            return {};
          }
        })
      }
    }
  })();

  it("for each write the task collection offers", async () => {
    const bus = createInMemoryBus();
    const raw = createInMemoryStores();
    // Every ledger entry the store writes, by the request writing it.
    const written: string[] = [];
    const resourceState = new Proxy(raw.resourceState, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if ((prop !== "set" && prop !== "delete") || typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const key = String(args[2]);
          if (key.startsWith(`${BOARD}/`)) written.push(key.slice(BOARD.length + 1));
          return value.apply(target, args);
        };
      }
    });
    const stores = { ...raw, resourceState, bus };
    const notices: ChangeNotice[] = [];
    bus.subscribe({ scope: "session", id: "conversation", tenantId: "", resource: BOARD }, (n) => notices.push(n));

    const report: string[] = [];
    for (const [index, [name]] of steps.entries()) {
      written.length = 0;
      // The first filing is the conversation's: it is every entry's filer. Every later write comes from another session.
      const sessionId = index <= 1 ? "conversation" : `writer-${index}`;
      const result = await runAction({ orgId: DEFAULT_ORG_ID, flow: stepFlow, actionName: "step", input: { index }, userId: "alice", sessionId, stores, runtimeConfig: {} });
      if (result.error !== undefined) throw new Error(`${name}: ${JSON.stringify(result.error)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const named = new Set(notices.filter((n) => n.origin?.requestId === result.requestId).flatMap((n) => n.ids ?? []));
      const wrote = [...new Set(written)];
      // A step that wrote nothing proves nothing about its write path.
      if (wrote.length === 0) report.push(`${name}: wrote no ledger entry`);
      const unnamed = wrote.filter((id) => !named.has(id));
      if (unnamed.length > 0) report.push(`${name}: wrote ${unnamed.join(", ")} with no board notice naming it`);
    }
    expect(report).toEqual([]);
  });
});
