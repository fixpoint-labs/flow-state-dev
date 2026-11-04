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
import { createInMemoryBus, createInMemoryStores, runAction, type ChangeNotice } from "@flow-state-dev/engine";
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
    return result.requestId!;
  };
  return { heard, run };
}

describe("a board change publishes a board notice", () => {
  it("on the filer's session, narrowed to the board, for the filing and for a settle in another session", async () => {
    const { heard, run } = boot();
    const conversationBoard = heard("conversation", BOARD);
    const taskSession = heard("task-session");

    const filed = await run("file", "conversation");
    expect(conversationBoard).toEqual([
      { topic: { scope: "session", id: "conversation", tenantId: "", resource: BOARD }, kind: "board", origin: { requestId: filed } }
    ]);

    const settled = await run("settle", "task-session");
    // The claim and the completion, folded or not: each names the settling request.
    expect(conversationBoard.length).toBeGreaterThan(1);
    expect(conversationBoard.slice(1).every((n) => n.origin?.requestId === settled)).toBe(true);
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
    const { heard, run } = boot();
    const conversationBoard = heard("conversation", BOARD);
    await run("file", "conversation");
    const spent = await run("spend", "task-session");
    expect(conversationBoard.filter((n) => n.origin?.requestId === spent)).toEqual([
      { topic: { scope: "session", id: "conversation", tenantId: "", resource: BOARD }, kind: "board", origin: { requestId: spent } }
    ]);
  });
});
