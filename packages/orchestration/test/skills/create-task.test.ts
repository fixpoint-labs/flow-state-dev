/**
 * `createTask` starts a task as its start setting says, and never waits
 * (FIX-2081; FIX-1875 BR-21): at the tool and the action, against a real
 * collection. `updateTask` releases a held one.
 *
 * "Not started" is read off the stored row (`held`), and through the
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

type Result = { ok: boolean; taskId?: string; error?: string; status?: string };
const run = (t: GeneratorTool, input: Record<string, unknown>) =>
  runForTest(t as never, input as never, boardCtx()) as Promise<Result>;

describe("createTask starts a task as its start setting says", () => {
  for (const dispatches of [true, false]) {
    const where = dispatches ? "a board that dispatches" : "a board a drain runs";

    it(`files a ready row a claim takes at once, on ${where}`, async () => {
      const collection = await board();
      const result = await run(tool(toolsOf(collection, dispatches), "createTask"), { goal: "Draft", assignee: "writer" });
      expect(result).toEqual({ ok: true, taskId: result.taskId });
      expect(collection.get(result.taskId!)!.status).toBe("pending");
      expect((await collection.claim("writer-worker"))?.id).toBe(result.taskId);
    });

    it(`files a held row no claim takes, until updateTask releases it, on ${where}`, async () => {
      const collection = await board();
      const tools = toolsOf(collection, dispatches);
      const result = await run(tool(tools, "createTask"), { goal: "Draft", assignee: "writer", held: true });
      expect(result).toMatchObject({ ok: true, status: "held" });
      for (let touch = 0; touch < 5; touch++) expect(await collection.claim("writer-worker")).toBeNull();
      expect((await run(tool(tools, "updateTask"), { id: result.taskId!, status: "pending" })).ok).toBe(true);
      expect((await collection.claim("writer-worker"))?.id).toBe(result.taskId);
    });
  }

  it("the createTask_<board> action files the same way", async () => {
    const collection = await board();
    const actions = taskToolActions("desk", async () => collection, roster, { dispatches: true });
    const result = (await runForTest(actions["createTask_desk"]!.block as never, { goal: "Draft", assignee: "ops", held: true } as never, boardCtx())) as Result;
    expect(result).toMatchObject({ ok: true, status: "held" });
    expect(collection.get(result.taskId!)!.status).toBe("held");
  });

  it("dispatchTask({ taskId }) releases a held row while it stands (D1)", async () => {
    const collection = await board();
    const tools = toolsOf(collection, true);
    const added = await run(tool(tools, "createTask"), { goal: "Draft", assignee: "writer", held: true });
    expect((await run(tool(tools, "dispatchTask"), { taskId: added.taskId! })).ok).toBe(true);
    expect(collection.get(added.taskId!)!.status).toBe("pending");
  });

  it("offers no dispatchTask on a board a drain runs", async () => {
    const collection = await board();
    expect(toolsOf(collection, false).map((t) => (t as { name?: string }).name)).not.toContain("dispatchTask");
  });
});

describe("createTask refuses the fields a filing once waited with, by name (BR-21)", () => {
  // retired-name-refusal: the old field is sent on purpose, to be refused.
  for (const [label, fields] of [
    ["waitForResponse", { waitForResponse: true }], // retired-name-refusal
    ["timeoutMs", { timeoutMs: 60_000 }],
    ["waitForResponse: false", { waitForResponse: false }] // retired-name-refusal
  ] as const) {
    for (const dispatches of [true, false]) {
      it(`refuses ${label} and files nothing, on a board that ${dispatches ? "dispatches" : "a drain runs"}`, async () => {
        const collection = await board();
        const result = await run(tool(toolsOf(collection, dispatches), "createTask"), { goal: "Draft", assignee: "writer", ...fields });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/^create_task_does_not_wait:/);
        expect(result.error).toContain(label.split(":")[0]);
        if (dispatches) expect(result.error).toMatch(/dispatchTask/);
        else expect(result.error).not.toMatch(/dispatchTask/);
        expect(collection.list()).toEqual([]);
      });
    }
  }

  it("offers neither field in createTask's schema, wherever a wait could be held", async () => {
    const collection = await board();
    const canWait = { requestHost: { resumeWait: async () => undefined, hasWaitSweeper: true } };
    const tools = taskToolsForTurn(async () => collection, roster, { dispatches: true, resumesWaits: true })(canWait);
    const fields = Object.keys(((tool(tools, "createTask") as any).config.inputSchema as { shape: object }).shape);
    expect(fields).not.toContain("timeoutMs");
    expect(fields.some((f) => f.startsWith("wait"))).toBe(false);
    // The wait lives on dispatchTask until FIX-2082.
    const dispatchFields = Object.keys(((tool(tools, "dispatchTask") as any).config.inputSchema as { shape: object }).shape);
    expect(dispatchFields).toEqual(expect.arrayContaining(["wait", "timeoutMs"]));
  });
});
