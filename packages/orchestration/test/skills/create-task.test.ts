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

  it("updateTask({ status: \"pending\" }) releases a held row while it stands (D1)", async () => {
    const collection = await board();
    const tools = toolsOf(collection, true);
    const added = await run(tool(tools, "createTask"), { goal: "Draft", assignee: "writer", held: true });
    expect((await run(tool(tools, "updateTask"), { id: added.taskId!, status: "pending" })).ok).toBe(true);
    expect(collection.get(added.taskId!)!.status).toBe("pending");
  });

  it("offers no dispatchTask on any board: createTask starts a task (FIX-2083)", async () => { // retired-name-refusal: refusal test
    const collection = await board();
    for (const starts of [true, false]) {
      expect(toolsOf(collection, starts).map((t) => (t as { name?: string }).name)).not.toContain("dispatchTask"); // retired-name-refusal: refusal test
    }
  });
});

describe("createTask only files: it refuses a wait field by name (BR-21, FIX-2082)", () => {
  /** A request whose host can hold a wait. */
  const canWait = {
    requestHost: {
      resumeWait: async () => undefined,
      hasWaitSweeper: true,
      waits: { deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 }, depth: async () => 1 }
    }
  };
  // retired-name-refusal: the old field is sent on purpose, to be refused.
  for (const [label, fields] of [
    ["wait", { wait: true }],
    ["deadline", { deadline: 60_000 }],
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
        // No wait is offered on this list, so none is pointed at.
        expect(result.error).not.toMatch(/getTask/);
        expect(collection.list()).toEqual([]);
      });
    }
  }

  it("points a filing that would wait at getTask, where a wait can be held", async () => {
    const collection = await board();
    const tools = taskToolsForTurn(async () => collection, roster, { dispatches: true, resumesWaits: true })(canWait);
    const result = await run(tool(tools, "createTask"), { goal: "Draft", assignee: "writer", wait: true });
    expect(result.error).toMatch(/^create_task_does_not_wait:.*getTask\(\{ id, wait: true \}\)/);
    expect(collection.list()).toEqual([]);
  });

  it("offers no wait field on createTask, and wait and deadline on getTask, wherever a wait can be held", async () => {
    const collection = await board();
    const tools = taskToolsForTurn(async () => collection, roster, { dispatches: true, resumesWaits: true })(canWait);
    const fieldsOf = (name: string) => Object.keys(((tool(tools, name) as any).config.inputSchema as { shape: object }).shape);
    for (const name of ["createTask"]) {
      expect(fieldsOf(name)).not.toContain("timeoutMs");
      expect(fieldsOf(name).some((f) => f.startsWith("wait"))).toBe(false);
    }
    expect(fieldsOf("getTask")).toEqual(expect.arrayContaining(["id", "wait", "deadline"]));
  });

  it("offers getTask no wait where the host can't hold one", async () => {
    const collection = await board();
    const tools = taskToolsForTurn(async () => collection, roster, { dispatches: true, resumesWaits: true })({});
    const fields = Object.keys(((tool(tools, "getTask") as any).config.inputSchema as { shape: object }).shape);
    expect(fields).toEqual(["id"]);
  });
});
