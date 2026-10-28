/**
 * The task tools' routing fields (FIX-2083): `createTask` files `target` as a
 * filing setting, beside `session` and `resultTo`; `updateTask` refuses all
 * three by name, since none changes after filing; and no tool takes the
 * post form: `dispatchTask` is gone, and `createTask` has no `post` field.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection, type TaskCollectionRef, type TaskInit } from "../../src/tasks";
import { taskToolsForTurn, type AssigneeRoster } from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

const ctx = {
  _blockIdentity: { blockName: "createTask", blockInstanceId: "req_1:root/step[0]/tool[createTask][0%3Ac1]:0" },
  emit: { component: () => undefined },
  session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
  request: { identity: { type: "request", id: "req_1" }, state: {} },
  runOnce: async <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn()
} as unknown as BlockContext;

const roster: AssigneeRoster = { has: (name) => name === "eng.em", describe: () => "eng.em", soleAssignee: () => "eng.em" };

/** The tools over a board that records every filing it is handed. */
async function toolsFor() {
  const collection = await getOrCreateTaskCollection({
    ctx,
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "desk"
  });
  const filed: TaskInit[] = [];
  const board: TaskCollectionRef = {
    ...collection,
    createTask: async (init) => {
      filed.push(init);
      return collection.createTask(init);
    }
  };
  const tools = taskToolsForTurn(async () => board, () => roster, { dispatches: true })(ctx);
  const call = (name: string, input: Record<string, unknown>) =>
    runForTest(tools.find((tool) => (tool as { name?: string }).name === name) as GeneratorTool as never, input as never, ctx) as Promise<{
      ok: boolean;
      taskId?: string;
      error?: string;
    }>;
  return { call, filed, collection, tools };
}

describe("the task tools' routing fields", () => {
  it("createTask hands target to the board as a filing setting, and the row keeps it", async () => {
    const { call, filed, collection } = await toolsFor();
    const out = await call("createTask", { goal: "Draft the pricing page", assignee: "eng.em", target: "pricing-page" });
    expect(out.ok).toBe(true);
    expect(filed).toEqual([expect.objectContaining({ target: "pricing-page", assignee: "eng.em" })]);
    expect(collection.get(out.taskId!)).toMatchObject({ target: "pricing-page" });
  });

  it("updateTask refuses target, session and resultTo by name: each is chosen at filing", async () => {
    const { call, collection } = await toolsFor();
    const filed = await call("createTask", { goal: "g", assignee: "eng.em" });
    for (const field of [{ target: "pricing-page" }, { session: "ongoing" }, { resultTo: "conversation" }]) {
      const out = await call("updateTask", { id: filed.taskId!, ...field });
      expect(out).toEqual({
        ok: false,
        taskId: filed.taskId,
        error: expect.stringMatching(new RegExp(`^filing_setting_fixed: ${Object.keys(field)[0]} is chosen when a task is filed`))
      });
    }
    expect(collection.get(filed.taskId!)).not.toHaveProperty("target");
    expect(collection.get(filed.taskId!)?.session).toBeUndefined();
  });

  it("offers no post form: no dispatchTask, and no post field on createTask", async () => {
    const { tools } = await toolsFor();
    expect(tools.map((tool) => (tool as { name?: string }).name)).not.toContain("dispatchTask");
    const create = tools.find((tool) => (tool as { name?: string }).name === "createTask") as GeneratorTool;
    const shape = (create as unknown as { inputSchema: { shape: Record<string, unknown> } }).inputSchema.shape;
    expect(Object.keys(shape)).not.toContain("post");
  });
});
