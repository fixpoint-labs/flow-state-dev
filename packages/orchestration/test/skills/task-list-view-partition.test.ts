// FIX-2750.
/**
 * A partitioned board's task-list view hears the rows added to its own
 * partitions, and no other's.
 *
 * Every row added to a user ledger goes out on the user topic, which every
 * board of that user hears, so a row filed in one conversation's partition
 * used to wake the board of every other conversation. The insert notice now
 * names its partition, and the view's answer the partitions it read, so the
 * client's rule (`hearsNotice`) skips a filing elsewhere and still hears the
 * first row in a partition the view read empty.
 *
 * Run through the real engine (`runAction`, `runView`) on an in-memory bus.
 * In process the bus carries the raw partition; the push edge keys it, which
 * `engine/test/board-partition-key.test.ts` checks.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryBus, createInMemoryStores, type ChangeNotice } from "@flow-state-dev/engine/host";
import { runView } from "@flow-state-dev/engine/internal";
import { hearsNotice } from "@flow-state-dev/contracts/types/view-hearing";
import { z } from "zod";
import { defineTaskCollection, getOrCreateTaskCollection, resolveResourceCollection } from "../../src/tasks";
import { taskToolViews } from "../../src/skills/views/task-list-view";

const BOARD = "desk";
const LIST = "listTasks_desk";
const USER = "alice";

/** A user ledger kept per conversation: a board reads and writes the partition it is handed. */
function boardFlow(): FlowInstance {
  async function desk(ctx: BlockContext, partition: string) {
    const collection = resolveResourceCollection(ctx, BOARD);
    if (collection === undefined) throw new Error("the board is not declared");
    return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection, partition });
  }
  const tasks = defineTaskCollection({ id: BOARD, scope: "user", partitionBy: (view) => view.sessionId, delivery: {} });
  return defineFlow({
    kind: "board-partitioned",
    resources: { [BOARD]: tasks },
    actions: {
      file: {
        block: handler({
          name: "file",
          inputSchema: z.object({ id: z.string(), partition: z.string() }),
          outputSchema: z.object({}),
          execute: async (input, ctx) => {
            await (await desk(ctx, input.partition)).createTask({ id: input.id, goal: `do ${input.id}` });
            return {};
          }
        })
      },
      open: {
        block: handler({ name: "open", inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) })
      }
    },
    // The view reads its own conversation's partition.
    views: taskToolViews(BOARD, async (ctx) => desk(ctx, ctx.session.identity.id))
  })() as unknown as FlowInstance;
}

async function boot() {
  const flow = boardFlow();
  const bus = createInMemoryBus();
  const stores = { ...createInMemoryStores(), bus };
  const run = async (sessionId: string, actionName: "file" | "open", input: Record<string, unknown>) => {
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName,
      input,
      userId: USER,
      sessionId,
      stores,
      runtimeConfig: { requestHost: { hostHasViews: () => true } }
    });
    if (result.error !== undefined) throw new Error(`${actionName}: ${JSON.stringify(result.error)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const view = (sessionId: string) => runView({ flow, viewName: LIST, input: {}, userId: USER, orgId: DEFAULT_ORG_ID, sessionId, stores });
  /** The board notices published on the viewer's topics while `during` runs. */
  const boardNoticesDuring = async (viewer: string, during: () => Promise<void>) => {
    const heard: ChangeNotice[] = [];
    const offs = [
      bus.subscribe({ scope: "session", id: viewer, tenantId: "" }, (n) => heard.push(n)),
      bus.subscribe({ scope: "user", id: USER, tenantId: "" }, (n) => heard.push(n))
    ];
    await during();
    for (const off of offs) off();
    return heard.filter((notice) => notice.kind === "board");
  };
  return { run, view, boardNoticesDuring };
}

describe("a partitioned board's task-list view", () => {
  it("is not woken by a row filed in another conversation's partition", async () => {
    const { run, view, boardNoticesDuring } = await boot();
    await run("conv-a", "open", {});
    const answer = await view("conv-a");

    const notices = await boardNoticesDuring("conv-a", () => run("conv-b", "file", { id: "b1", partition: "conv-b" }));
    // The filing did go out on the user topic this view hears...
    expect(notices.map((notice) => notice.topic.scope)).toContain("user");
    // ...and the view's answer rules it out by its partition.
    expect(notices.filter((notice) => hearsNotice(answer.hears, notice))).toEqual([]);
  });

  it("hears the first row filed in the partition it read empty, from a session it never listed", async () => {
    const { run, view, boardNoticesDuring } = await boot();
    await run("conv-a", "open", {});
    const answer = await view("conv-a");
    expect(answer.output).toEqual([]);

    const notices = await boardNoticesDuring("conv-a", () => run("task-of-a", "file", { id: "a1", partition: "conv-a" }));
    expect(notices.filter((notice) => hearsNotice(answer.hears, notice)).map((notice) => notice.topic.scope)).toEqual(["user"]);
    // And the row it hears of is on the board when the view reads again.
    expect(((await view("conv-a")).output as Array<{ id: string }>).map((task) => task.id)).toEqual(["a1"]);
  });
});
