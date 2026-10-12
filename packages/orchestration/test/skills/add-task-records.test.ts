/**
 * `addTask` and `assignTask` record work on a board that dispatches, and
 * `addTask` never waits (FIX-1875 S7): BR-1 to BR-3, BR-21, BR-23, BR-27 at
 * the tool and the action, against a real collection.
 *
 * "Not started" is read off the stored row (`undispatched`), and through the
 * substrate's claim, which is what every board's start goes through: a row a
 * claim can't take never starts, however often the board is touched.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection, type TaskCollectionRef } from "../../src/tasks";
import { taskToolActions, taskToolsForTurn, type AssigneeRoster } from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

function boardCtx(): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } }
  } as unknown as BlockContext;
}

const board = () =>
  getOrCreateTaskCollection({
    ctx: boardCtx(),
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "desk"
  });

const roster: AssigneeRoster = {
  has: (name) => name === "ops" || name === "writer",
  describe: () => "ops, writer"
};

function toolsOf(collection: TaskCollectionRef, dispatches: boolean): GeneratorTool[] {
  return taskToolsForTurn(async () => collection, roster, { dispatches })({});
}

function tool(tools: GeneratorTool[], name: string): GeneratorTool {
  const found = tools.find((t) => (t as { name?: string }).name === name);
  if (found === undefined) throw new Error(`${name} is not offered`);
  return found;
}

type Result = { ok: boolean; taskId?: string; error?: string; status?: string; note?: string };
const run = (t: GeneratorTool, input: Record<string, unknown>) =>
  runForTest(t as never, input as never, boardCtx()) as Promise<Result>;

describe("addTask on a board that dispatches records the task (BR-1, BR-27)", () => {
  it("files the row not dispatched, and no claim takes it", async () => {
    const collection = await board();
    const result = await run(tool(toolsOf(collection, true), "addTask"), { goal: "Draft the release note", assignee: "writer" });
    expect(result.ok).toBe(true);
    const row = collection.get(result.taskId!)!;
    expect(row.status).toBe("pending");
    expect(row.assignee).toBe("writer");
    expect(row.undispatched).toBe(true);
    // Every board starts a row by claiming it: a recorded row is never claimed.
    for (let touch = 0; touch < 20; touch++) expect(await collection.claim("writer-worker")).toBeNull();
    expect(collection.get(result.taskId!)!.attempts).toBe(0);
  });

  it("says the task is recorded and how it starts, so a caller that logs the result sees why it didn't run", async () => {
    const collection = await board();
    const result = await run(tool(toolsOf(collection, true), "addTask"), { goal: "Draft the release note", assignee: "writer" });
    expect(result).toMatchObject({ ok: true, status: "recorded" });
    expect(result.note).toMatch(/dispatchTask/);
  });

  it("the addTask_<board> action records the same way", async () => {
    const collection = await board();
    const actions = taskToolActions("desk", async () => collection, roster, { dispatches: true });
    const action = actions["addTask_desk"]!;
    const result = (await runForTest(action.block as never, { goal: "Draft", assignee: "ops" } as never, boardCtx())) as Result;
    expect(result).toMatchObject({ ok: true, status: "recorded" });
    expect(collection.get(result.taskId!)!.undispatched).toBe(true);
  });

  it("dispatchTask({ taskId }) starts the recorded row", async () => {
    const collection = await board();
    const tools = toolsOf(collection, true);
    const added = await run(tool(tools, "addTask"), { goal: "Draft", assignee: "writer" });
    expect((await run(tool(tools, "dispatchTask"), { taskId: added.taskId! })).ok).toBe(true);
    expect(collection.get(added.taskId!)!.undispatched).toBeUndefined();
    expect((await collection.claim("writer-worker"))?.id).toBe(added.taskId);
  });
});

describe("assignTask on a recorded row (BR-3)", () => {
  it("changes the owner and the row stays recorded", async () => {
    const collection = await board();
    const tools = toolsOf(collection, true);
    const added = await run(tool(tools, "addTask"), { goal: "Draft", assignee: "writer" });
    expect((await run(tool(tools, "assignTask"), { taskId: added.taskId!, assignee: "ops" })).ok).toBe(true);
    const row = collection.get(added.taskId!)!;
    expect(row.assignee).toBe("ops");
    expect(row.undispatched).toBe(true);
    expect(await collection.claim("ops-worker")).toBeNull();
  });
});

describe("addTask on a board a drain runs is unchanged (BR-7)", () => {
  it("files the row ready, with no mark and no status, and offers no dispatchTask", async () => {
    const collection = await board();
    const tools = toolsOf(collection, false);
    expect(tools.map((t) => (t as { name?: string }).name)).not.toContain("dispatchTask");
    const result = await run(tool(tools, "addTask"), { goal: "Draft", assignee: "writer" });
    expect(result).toEqual({ ok: true, taskId: result.taskId });
    expect(collection.get(result.taskId!)!.undispatched).toBeUndefined();
  });
});

describe("addTask refuses the fields it used to wait with, by name (BR-21)", () => {
  // retired-name-refusal: the old field is sent on purpose, to be refused.
  for (const [label, fields] of [
    ["waitForResponse", { waitForResponse: true }], // retired-name-refusal
    ["timeoutMs", { timeoutMs: 60_000 }],
    ["waitForResponse: false", { waitForResponse: false }] // retired-name-refusal
  ] as const) {
    for (const dispatches of [true, false]) {
      it(`refuses ${label} and files nothing, on a board that ${dispatches ? "dispatches" : "a drain runs"}`, async () => {
        const collection = await board();
        const result = await run(tool(toolsOf(collection, dispatches), "addTask"), { goal: "Draft", assignee: "writer", ...fields });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/^add_task_does_not_wait:/);
        expect(result.error).toContain(label.split(":")[0]);
        if (dispatches) expect(result.error).toMatch(/dispatchTask/);
        else expect(result.error).not.toMatch(/dispatchTask/);
        expect(collection.list()).toEqual([]);
      });
    }
  }

  it("the action refuses it too", async () => {
    const collection = await board();
    const actions = taskToolActions("desk", async () => collection, roster, { dispatches: true });
    const result = (await runForTest(
      actions["addTask_desk"]!.block as never,
      { goal: "Draft", assignee: "ops", waitForResponse: true } as never, // retired-name-refusal
      boardCtx()
    )) as Result;
    expect(result.error).toMatch(/^add_task_does_not_wait:/);
    expect(collection.list()).toEqual([]);
  });

  it("offers neither field in addTask's schema, wherever a wait could be held", async () => {
    const collection = await board();
    const canWait = { requestHost: { resumeAsk: async () => undefined, hasAskSweeper: true } };
    const tools = taskToolsForTurn(async () => collection, roster, { dispatches: true, resumesAsks: true })(canWait);
    const fields = Object.keys(((tool(tools, "addTask") as any).config.inputSchema as { shape: object }).shape);
    expect(fields).not.toContain("timeoutMs");
    expect(fields.some((f) => f.startsWith("wait"))).toBe(false);
    // The wait lives on dispatchTask.
    const dispatchFields = Object.keys(((tool(tools, "dispatchTask") as any).config.inputSchema as { shape: object }).shape);
    expect(dispatchFields).toEqual(expect.arrayContaining(["wait", "timeoutMs"]));
  });
});

describe("addTask's description (BR-23)", () => {
  it("on a board that dispatches, says it records and doesn't start, and points at dispatchTask", async () => {
    const collection = await board();
    const description = (tool(toolsOf(collection, true), "addTask") as { description?: string }).description!;
    expect(description).toMatch(/doesn't start|does not start/);
    expect(description).toMatch(/dispatchTask/);
    expect(description).not.toMatch(/timeoutMs|you wait/);
  });

  it("on a board a drain runs, doesn't name a tool it doesn't have", async () => {
    const collection = await board();
    const description = (tool(toolsOf(collection, false), "addTask") as { description?: string }).description!;
    expect(description).not.toMatch(/dispatchTask/);
  });

  it("assignTask's, on a board that dispatches, says a recorded task stays recorded", async () => {
    const collection = await board();
    const description = (tool(toolsOf(collection, true), "assignTask") as { description?: string }).description!;
    expect(description).toMatch(/dispatchTask/);
  });
});
