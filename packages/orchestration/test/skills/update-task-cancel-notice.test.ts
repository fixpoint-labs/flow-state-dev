/**
 * Who hears a cancel (FIX-2078 D2), through `updateTask({ status: "cancelled" })`.
 *
 * A model that cancels its own filing in its own turn hears it from the call's
 * result, so the cancel owes its filer no notice: one would wake the same
 * session a second time over its own act. The board's public `_tasks` action
 * is someone else's cancel (an app, a person), so the filer is owed one. And
 * the result names the dependents the cancel took along, since they owe no
 * notice of their own either.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import {
  createTaskToolsCapability,
  taskToolActions,
  taskToolSuffix,
} from "../../src/skills/task-tools-capability";
import { createResourceBackedTaskCollection, type TaskCollectionRef } from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";
import { buildDelegationCtx } from "./delegation-ctx";

const FILER = "filer-session";

/** A delivery board whose every row this session filed. */
async function deliveryBoard(): Promise<TaskCollectionRef> {
  const board = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    delivery: {
      ownSession: FILER,
      hooks: {
        filerOf: () => FILER,
        beforeEnding: async () => {},
        owePassAt: async () => {},
        afterEnding: async () => {},
      },
    },
  });
  await board.createTask({ id: "t", goal: "t" });
  await board.createTask({ id: "after", goal: "after", deps: ["t"] });
  return board;
}

const owesANotice = (board: TaskCollectionRef, id: string): boolean =>
  Object.keys(board.get(id)?.metadata ?? {}).some((key) => key.startsWith("noticeOwed:"));

function modelsTool(board: TaskCollectionRef): GeneratorTool {
  // As the task tools test reads them: the capability's control tools, chosen per turn.
  const capability = createTaskToolsCapability(async () => board) as unknown as {
    __presetDefs?: { tools?: { controlTools?: unknown } };
  };
  const list = capability.__presetDefs?.tools?.controlTools;
  const tools = (typeof list === "function" ? list({}) : (list ?? [])) as GeneratorTool[];
  return tools.find((tool) => tool.config?.name === "updateTask")!;
}

describe("updateTask's cancel", () => {
  it("a model's own cancel owes its filer no notice, and names the dependents it took along", async () => {
    const board = await deliveryBoard();
    const { ctx } = buildDelegationCtx({ self: false });

    const result = await runForTest(modelsTool(board), { id: "t", status: "cancelled" }, ctx);

    expect(result).toEqual({ ok: true, cancelled: ["after"] });
    expect(board.get("t")?.status).toBe("cancelled");
    expect(owesANotice(board, "t")).toBe(false);
  });

  it("a cancel through the board's public action owes the filer a notice", async () => {
    const board = await deliveryBoard();
    const { ctx } = buildDelegationCtx({ self: false });
    const action = taskToolActions("tasks", async () => board)[`updateTask_${taskToolSuffix("tasks")}`]!;

    await runForTest(action.block as never, { id: "t", status: "cancelled" }, ctx);

    expect(board.get("t")?.status).toBe("cancelled");
    expect(owesANotice(board, "t")).toBe(true);
  });
});
