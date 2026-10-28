/**
 * `createTask` on a board that starts a ready row at once, against a real
 * collection, driven directly with a hand-built turn context (FIX-1875 BR-15):
 * a replay of the same call answers as the first call did even when the team
 * changed in between, and files no second row.
 *
 * The context's `runOnce` memo outlives a crash, as the request store does:
 * share it across two calls to model the replay of one call.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection, type TaskCollectionRef } from "../../src/tasks";
import { taskToolsForTurn, type AssigneeRoster } from "../../src/skills/task-tools-capability";
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

/** One generator tool call's context; `memo` is the request's `runOnce` record. */
function turnCtx(memo: Map<string, unknown>, callId = "c1"): BlockContext {
  return {
    _blockIdentity: {
      blockName: "createTask",
      blockInstanceId: `req_1:root/step[0]/tool[createTask][0%3A${callId}]:0`
    },
    session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
    request: { identity: { type: "request", id: "req_1" } },
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    }
  } as unknown as BlockContext;
}

/** A team whose members the test changes between calls. */
function team(members: string[]): { roster: AssigneeRoster; members: string[] } {
  const roster: AssigneeRoster = {
    has: (name) => members.includes(name),
    describe: () => members.join(", "),
    soleAssignee: () => (members.length === 1 ? members[0] : undefined)
  };
  return { roster, members };
}

/** `createTask` on a board that starts a ready row at once. */
function createTool(collection: TaskCollectionRef, roster: AssigneeRoster): GeneratorTool {
  const tools = taskToolsForTurn(async () => collection, () => roster, { dispatches: true })({});
  const tool = tools.find((t) => (t as { name?: string }).name === "createTask");
  if (tool === undefined) throw new Error("createTask is not offered");
  return tool;
}

const run = (tool: GeneratorTool, input: Record<string, unknown>, ctx: BlockContext) =>
  runForTest(tool as never, input as never, ctx) as Promise<{ ok: boolean; taskId?: string; error?: string }>;

describe("createTask replayed after the team changed (BR-15)", () => {
  /** A board whose ready write commits and then the process dies, once. */
  function dyingOnce(collection: TaskCollectionRef, method: "createTask") {
    let died = false;
    return Object.assign(Object.create(Object.getPrototypeOf(collection)), collection, {
      [method]: async (...args: unknown[]) => {
        const out = await (collection[method] as (...a: unknown[]) => Promise<unknown>)(...args);
        if (!died) {
          died = true;
          throw new Error("the process died");
        }
        return out;
      }
    }) as TaskCollectionRef;
  }

  it("a new row filed for a named delegate who has since left answers as the first call did", async () => {
    const collection = await board();
    const dying = dyingOnce(collection, "createTask");
    const t = team(["eng.a", "eng.b"]);
    const memo = new Map<string, unknown>();
    const input = { goal: "Draft the release note", assignee: "eng.a" };

    await expect(run(createTool(dying, t.roster), input, turnCtx(memo))).rejects.toThrow("the process died");
    t.members.splice(0, 1); // eng.a leaves the team before the replay.

    const replay = await run(createTool(dying, t.roster), input, turnCtx(memo));
    expect(replay).toMatchObject({ ok: true, taskId: expect.any(String) });
    expect(collection.list()).toHaveLength(1);
    expect(collection.list()[0]).toMatchObject({ id: replay.taskId, assignee: "eng.a" });
  });

  it("a call that died after recording its id and before the add files its row on the replay, once", async () => {
    const collection = await board();
    let died = false;
    const dying = Object.assign(Object.create(Object.getPrototypeOf(collection)), collection, {
      createTask: async (...args: unknown[]) => {
        if (!died) {
          died = true;
          throw new Error("the process died before the add");
        }
        return (collection.createTask as (...a: unknown[]) => Promise<unknown>)(...args);
      }
    }) as TaskCollectionRef;
    const t = team(["eng.a"]);
    const memo = new Map<string, unknown>();
    const input = { goal: "Draft the release note", assignee: "eng.a" };
    await expect(run(createTool(dying, t.roster), input, turnCtx(memo))).rejects.toThrow("the process died before the add");
    expect(collection.list()).toHaveLength(0);
    const replay = await run(createTool(dying, t.roster), input, turnCtx(memo));
    expect(replay).toMatchObject({ ok: true, taskId: expect.any(String) });
    expect(collection.list().map((task) => task.id)).toEqual([replay.taskId]);
  });

  it("keeps the call that filed a row out of a caller's reach: metadata naming another call is not written", async () => {
    const collection = await board();
    const t = team(["eng.a"]);
    const out = await run(createTool(collection, t.roster), { goal: "Draft it", assignee: "eng.a", metadata: { filedByCall: "someone-elses-call", topic: "notes" } }, turnCtx(new Map(), "c7"));
    expect(out).toMatchObject({ ok: true });
    // A minted id is the call's alone, so the row names no call, and the forged one is dropped.
    expect(collection.get(out.taskId!)!.metadata).toEqual({ topic: "notes" });
  });

  it("a different call is still checked against the team as it is now", async () => {
    const collection = await board();
    const t = team(["eng.a", "eng.b"]);
    const memo = new Map<string, unknown>();
    await run(createTool(collection, t.roster), { goal: "first", assignee: "eng.a" }, turnCtx(memo, "c1"));
    t.members.splice(0, 1);
    expect(
      await run(createTool(collection, t.roster), { goal: "second", assignee: "eng.a" }, turnCtx(memo, "c2"))
    ).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: /) });
  });
});

describe("a new task's input is an object, never its JSON as a string", () => {
  const project = { project: { visibility: "shared", id: "shift-manager" } };
  const tools = taskToolsForTurn(async () => {
    throw new Error("unused");
  }, () => team(["eng.coder"]).roster, { dispatches: true })({});

  for (const name of ["createTask"]) {
    it(`${name} refuses the payload as a string, so the model is told to send the object`, () => {
      const tool = tools.find((t) => (t as { name?: string }).name === name);
      if (tool === undefined) throw new Error(`${name} is not offered`);
      const base = { goal: "Create a file and commit it", assignee: "eng.coder" };
      expect(tool.inputSchema.safeParse({ ...base, input: JSON.stringify(project) }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ ...base, input: 1 }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ ...base, input: [project] }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ ...base, input: project }).success).toBe(true);
    });
  }
});

describe("createTask title", () => {
  // A row filed with no title is listed by its whole goal, so a coordinator
  // that can name the task gives every list a short label.
  it("files the task under the title it names, apart from its goal", async () => {
    const collection = await board();
    const t = team(["eng.coder"]);
    const goal = "Take a quick look at the flow state code in the project's repository and report back what you find";
    const result = await run(
      createTool(collection, t.roster),
      { goal, title: "Look at the flow state code", assignee: "eng.coder" },
      turnCtx(new Map())
    );
    expect(result.ok).toBe(true);
    const row = collection.get(result.taskId!);
    expect(row?.title).toBe("Look at the flow state code");
    expect(row?.goal).toBe(goal);
  });

  it("leaves the title unset when none is named, so a row's goal still labels it", async () => {
    const collection = await board();
    const t = team(["eng.coder"]);
    const result = await run(createTool(collection, t.roster), { goal: "Audit licenses", assignee: "eng.coder" }, turnCtx(new Map()));
    expect(collection.get(result.taskId!)?.title).toBeUndefined();
  });

  it("refuses an empty title at the schema, so no row carries a blank label", () => {
    const tools = taskToolsForTurn(async () => {
      throw new Error("unused");
    }, () => team(["eng.coder"]).roster, { dispatches: true })({});
    for (const name of ["createTask"]) {
      const tool = tools.find((t) => (t as { name?: string }).name === name)!;
      const base = { goal: "Audit licenses", assignee: "eng.coder" };
      expect(tool.inputSchema.safeParse({ ...base, title: "" }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ ...base, title: "Audit" }).success).toBe(true);
    }
  });

});

describe("listTasks title", () => {
  it("answers a task's title when it has one, and none when it has none", async () => {
    const collection = await board();
    await collection.createTask({ id: "t_titled", goal: "A long brief about the licenses", title: "Audit licenses", assignee: "eng.a" });
    await collection.createTask({ id: "t_plain", goal: "Write the notes", assignee: "eng.a" });
    const tools = taskToolsForTurn(async () => collection, () => team(["eng.a"]).roster, { dispatches: true })({});
    const list = tools.find((t) => (t as { name?: string }).name === "listTasks")!;
    const out = (await runForTest(list as never, {} as never, turnCtx(new Map()))) as { tasks: { id: string; title?: string }[] };
    const byId = Object.fromEntries(out.tasks.map((t) => [t.id, t]));
    expect(byId.t_titled!.title).toBe("Audit licenses");
    expect("title" in byId.t_plain!).toBe(false);
  });
});
