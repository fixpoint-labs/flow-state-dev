// FIX-2625 D1.
/**
 * The board's task-list view answers for just the tasks a board notice names
 * and every task listed beside them: each task of a follow-up chain lists the
 * chain's latest completed follow-up (`current`), so a follow-up's ending
 * changes its root's listing too; answering only the named task (identity)
 * would leave the root stale. Anything it can't place
 * safely (a filter that rows may enter or leave, a task it no longer holds,
 * another board's notice) answers whole.
 *
 * Run through the real engine's view runner, so `ctx.view` is the one every
 * view's block gets, and each partial answer is compared with a whole run of
 * the same view on the same store.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, ViewChange } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { runView } from "@flow-state-dev/engine/internal";
import { z } from "zod";
import { defineTaskCollection, getOrCreateTaskCollection, resolveResourceCollection, ticketForClaim } from "../../src/tasks";
import { taskToolViews } from "../../src/skills/views/task-list-view";

const BOARD = "desk";
const LIST = "listTasks_desk";

async function desk(ctx: BlockContext) {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) throw new Error("the board is not declared");
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

const flow = defineFlow({
  kind: "board-view",
  resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "user", delivery: {} }) },
  actions: {
    file: {
      block: handler({
        name: "file",
        inputSchema: z.object({ id: z.string(), followUpOf: z.string().optional() }),
        outputSchema: z.object({}),
        execute: async (input, ctx) => {
          await (await desk(ctx)).createTask({ id: input.id, goal: `do ${input.id}`, ...(input.followUpOf !== undefined ? { followUpOf: input.followUpOf } : {}) });
          return {};
        }
      })
    },
    finish: {
      block: handler({
        name: "finish",
        inputSchema: z.object({ id: z.string() }),
        outputSchema: z.object({}),
        execute: async (input, ctx) => {
          const board = await desk(ctx);
          const claimed = (await board.claim("w", { eligibility: (t) => t.id === input.id }))!;
          await board.complete(input.id, { done: input.id }, { claim: ticketForClaim(BOARD, claimed, board.partition) });
          return {};
        }
      })
    }
  },
  views: taskToolViews(BOARD, async (ctx) => desk(ctx))
})() as unknown as FlowInstance;

async function boot() {
  const stores = createInMemoryStores();
  const act = async (actionName: "file" | "finish", input: unknown) => {
    const result = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName, input, userId: "alice", sessionId: "conversation", stores, runtimeConfig: {} });
    if (result.error !== undefined) throw new Error(`${actionName}: ${JSON.stringify(result.error)}`);
  };
  const view = (input: unknown = {}, changed?: ViewChange) =>
    runView({ flow, viewName: LIST, input, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "conversation", stores, ...(changed !== undefined ? { changed } : {}) });
  return { act, view };
}

const boardChange = (ids: string[], board = BOARD): ViewChange => ({ topic: { scope: "session", id: "conversation", resource: board }, kind: "board", ids });

/** The whole answer's rows, by id. */
const byId = (listed: unknown) => new Map((listed as Array<{ id: string }>).map((task) => [task.id, task]));

describe("the board's task-list view · a board notice", () => {
  it("answers just the named task, as a whole run lists it", async () => {
    const { act, view } = await boot();
    for (const id of ["a", "b", "c"]) await act("file", { id });
    await act("finish", { id: "b" });

    const partial = await view({}, boardChange(["b"]));
    expect(partial.partial).toEqual({ removed: [] });
    expect(partial.keys).toEqual(["b"]);
    const whole = await view();
    expect(whole.partial).toBeUndefined();
    expect(whole.keys).toEqual(["a", "b", "c"]);
    expect(partial.output).toEqual([byId(whole.output).get("b")]);
  });

  it("answers every row in a follow-up's chain, since each shows the chain's latest completed follow-up", async () => {
    const { act, view } = await boot();
    await act("file", { id: "root" });
    await act("file", { id: "other" });
    await act("finish", { id: "root" });
    await act("file", { id: "fix", followUpOf: "root" });
    await act("finish", { id: "fix" });

    const partial = await view({}, boardChange(["fix"]));
    expect(partial.keys).toEqual(["root", "fix"]);
    const whole = byId((await view()).output);
    // The root's row moved with its follow-up's ending: it names the follow-up as current.
    expect(whole.get("root")).toMatchObject({ current: { id: "fix" } });
    expect(partial.output).toEqual([whole.get("root"), whole.get("fix")]);
  });

  it("answers whole for a filtered list, which a changed row may enter or leave", async () => {
    const { act, view } = await boot();
    await act("file", { id: "a" });
    const answer = await view({ status: "pending" }, boardChange(["a"]));
    expect(answer.partial).toBeUndefined();
  });

  it("answers whole for a task it no longer holds, and for another board's notice", async () => {
    const { act, view } = await boot();
    await act("file", { id: "a" });
    expect((await view({}, boardChange(["gone"]))).partial).toBeUndefined();
    expect((await view({}, boardChange(["a"], "plan"))).partial).toBeUndefined();
    expect((await view({}, { topic: { scope: "session", id: "conversation" }, kind: "request", ids: ["a"] })).partial).toBeUndefined();
  });
});
