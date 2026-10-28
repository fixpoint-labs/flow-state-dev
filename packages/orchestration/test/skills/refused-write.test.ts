/**
 * A wrapping ref's own refusal (FIX-2076): a board with rules of its own (a
 * session board that keeps a worker's steps apart from its delegates' tasks)
 * throws `TaskWriteRefusedError`, and the task tools answer it as a soft error
 * the model can act on, with nothing written. Any other throw still propagates.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection, TaskWriteRefusedError, type TaskCollectionRef } from "../../src/tasks";
import { taskToolsForTurn, type AssigneeRoster } from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

function boardCtx(): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } },
  } as unknown as BlockContext;
}

const roster: AssigneeRoster = {
  has: (name) => name === "ops" || name === "me",
  describe: () => "ops, me",
};

/** A board that refuses every write naming "me", as a session board refuses a crossing. */
async function refusingBoard(): Promise<TaskCollectionRef> {
  const inner = await getOrCreateTaskCollection({
    ctx: boardCtx(),
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "desk",
  });
  return {
    ...inner,
    createTask: async (init) => {
      if (init.assignee === "me") throw new TaskWriteRefusedError("not_here", "file it elsewhere");
      if (init.assignee === "boom") throw new Error("storage down");
      return inner.createTask(init);
    },
    patchSettings: async (id, patch) => {
      if (patch.assignee === "me") throw new TaskWriteRefusedError("crossing", "cancel and file again", id);
      return inner.patchSettings(id, patch);
    },
  };
}

function tool(tools: GeneratorTool[], name: string): GeneratorTool {
  const found = tools.find((t) => (t as { name?: string }).name === name);
  if (found === undefined) throw new Error(`${name} is not offered`);
  return found;
}

const run = (t: GeneratorTool, input: Record<string, unknown>) =>
  runForTest(t as never, input as never, boardCtx()) as Promise<{ ok: boolean; error?: string; taskId?: string }>;

describe("the task tools answer a ref's own refusal as a soft error", () => {
  it("createTask answers it by code and message, and files nothing", async () => {
    const board = await refusingBoard();
    const tools = taskToolsForTurn(async () => board, roster, { dispatches: true })({});
    expect(await run(tool(tools, "createTask"), { goal: "x", assignee: "me" })).toEqual({
      ok: false,
      error: "not_here: file it elsewhere",
    });
    expect(board.list()).toEqual([]);
  });

  it("updateTask answers it naming the task, and the row keeps its owner", async () => {
    const board = await refusingBoard();
    const tools = taskToolsForTurn(async () => board, roster, { dispatches: true })({});
    const filed = await run(tool(tools, "createTask"), { goal: "x", assignee: "ops" });
    const refused = await run(tool(tools, "updateTask"), { id: filed.taskId!, assignee: "me" });
    expect(refused).toEqual({ ok: false, error: "crossing: cancel and file again", taskId: filed.taskId });
    expect(board.get(filed.taskId!)!.assignee).toBe("ops");
  });

  it("still lets any other throw through", async () => {
    const board = await refusingBoard();
    const tools = taskToolsForTurn(async () => board, { ...roster, has: () => true }, { dispatches: true })({});
    await expect(run(tool(tools, "createTask"), { goal: "x", assignee: "boom" })).rejects.toThrow(/storage down/);
  });
});
