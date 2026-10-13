/**
 * `dispatchTask` against a real collection, driven directly with a hand-built
 * turn context (FIX-1875 BR-15, BR-25): a named owner stands against a
 * reassign that lands between the tool's read and its write, and a replay of
 * the same call answers as the first call did even when the team changed in
 * between.
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
      blockName: "dispatchTask",
      blockInstanceId: `req_1:root/step[0]/tool[dispatchTask][0%3A${callId}]:0`
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

function dispatchTool(collection: TaskCollectionRef, roster: AssigneeRoster): GeneratorTool {
  const tools = taskToolsForTurn(async () => collection, () => roster, { dispatches: true })({});
  const tool = tools.find((t) => (t as { name?: string }).name === "dispatchTask");
  if (tool === undefined) throw new Error("dispatchTask is not offered");
  return tool;
}

const run = (tool: GeneratorTool, input: Record<string, unknown>, ctx: BlockContext) =>
  runForTest(tool as never, input as never, ctx) as Promise<{ ok: boolean; taskId?: string; error?: string }>;

describe("dispatchTask with a named owner, racing a reassign (BR-25)", () => {
  it("a dispatch naming the row's own owner still writes it, so a reassign landing after the read doesn't stand", async () => {
    const collection = await board();
    await collection.addTask({ id: "task_rec", goal: "Audit licenses", assignee: "eng.a", undispatched: true });
    // assignTask(B) commits after dispatchTask read the row as A's, and before its write.
    const racing = Object.assign(Object.create(Object.getPrototypeOf(collection)), collection, {
      dispatch: async (...args: Parameters<NonNullable<TaskCollectionRef["dispatch"]>>) => {
        await collection.setAssignee("task_rec", "eng.b");
        return collection.dispatch!(...args);
      }
    }) as TaskCollectionRef;
    const { roster } = team(["eng.a", "eng.b"]);

    const result = await run(dispatchTool(racing, roster), { taskId: "task_rec", assignee: "eng.a" }, turnCtx(new Map()));
    expect(result).toEqual({ ok: true, taskId: "task_rec" });
    // The dispatch is the later write, so its owner stands.
    expect(collection.get("task_rec")).toMatchObject({ assignee: "eng.a" });
    expect(collection.get("task_rec")?.undispatched).toBeUndefined();
  });

  it("a dispatch that names nobody keeps the row's owner, whoever set it last", async () => {
    const collection = await board();
    await collection.addTask({ id: "task_rec", goal: "Audit licenses", assignee: "eng.a", undispatched: true });
    const racing = Object.assign(Object.create(Object.getPrototypeOf(collection)), collection, {
      dispatch: async (...args: Parameters<NonNullable<TaskCollectionRef["dispatch"]>>) => {
        await collection.setAssignee("task_rec", "eng.b");
        return collection.dispatch!(...args);
      }
    }) as TaskCollectionRef;
    const { roster } = team(["eng.a", "eng.b"]);

    expect(await run(dispatchTool(racing, roster), { taskId: "task_rec" }, turnCtx(new Map()))).toEqual({
      ok: true,
      taskId: "task_rec"
    });
    expect(collection.get("task_rec")).toMatchObject({ assignee: "eng.b" });
  });
});

describe("dispatchTask replayed after the team changed (BR-15)", () => {
  /** A board whose ready write commits and then the process dies, once. */
  function dyingOnce(collection: TaskCollectionRef, method: "addTask" | "dispatch") {
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
    const dying = dyingOnce(collection, "addTask");
    const t = team(["eng.a", "eng.b"]);
    const memo = new Map<string, unknown>();
    const input = { goal: "Draft the release note", assignee: "eng.a" };

    await expect(run(dispatchTool(dying, t.roster), input, turnCtx(memo))).rejects.toThrow("the process died");
    t.members.splice(0, 1); // eng.a leaves the team before the replay.

    const replay = await run(dispatchTool(dying, t.roster), input, turnCtx(memo));
    expect(replay).toMatchObject({ ok: true, taskId: expect.any(String) });
    expect(collection.list()).toHaveLength(1);
    expect(collection.list()[0]).toMatchObject({ id: replay.taskId, assignee: "eng.a" });
  });

  it("a new row filed for the sole delegate answers as the first call did once there is no longer one", async () => {
    const collection = await board();
    const dying = dyingOnce(collection, "addTask");
    const t = team(["eng.a"]);
    const memo = new Map<string, unknown>();
    const input = { goal: "Draft the release note" };

    await expect(run(dispatchTool(dying, t.roster), input, turnCtx(memo))).rejects.toThrow("the process died");
    t.members.push("eng.b"); // A second delegate joins: there is no sole one now.

    const replay = await run(dispatchTool(dying, t.roster), input, turnCtx(memo));
    expect(replay).toMatchObject({ ok: true, taskId: expect.any(String) });
    expect(collection.list()).toHaveLength(1);
    expect(collection.list()[0]).toMatchObject({ assignee: "eng.a" });
  });

  it("a recorded row dispatched to a named delegate who has since left answers as the first call did", async () => {
    const collection = await board();
    await collection.addTask({ id: "task_rec", goal: "Audit licenses", undispatched: true });
    const dying = dyingOnce(collection, "dispatch");
    const t = team(["eng.a", "eng.b"]);
    const memo = new Map<string, unknown>();
    const input = { taskId: "task_rec", assignee: "eng.a" };

    await expect(run(dispatchTool(dying, t.roster), input, turnCtx(memo))).rejects.toThrow("the process died");
    t.members.splice(0, 1);

    expect(await run(dispatchTool(dying, t.roster), input, turnCtx(memo))).toEqual({ ok: true, taskId: "task_rec" });
    expect(collection.get("task_rec")).toMatchObject({ assignee: "eng.a" });
  });

  it("a different call is still checked against the team as it is now", async () => {
    const collection = await board();
    const t = team(["eng.a", "eng.b"]);
    const memo = new Map<string, unknown>();
    await run(dispatchTool(collection, t.roster), { goal: "first", assignee: "eng.a" }, turnCtx(memo, "c1"));
    t.members.splice(0, 1);
    expect(
      await run(dispatchTool(collection, t.roster), { goal: "second", assignee: "eng.a" }, turnCtx(memo, "c2"))
    ).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: /) });
  });
});

describe("a new task's input is an object, never its JSON as a string", () => {
  // A model handed a schema with no type for `input` may send the payload as a
  // JSON string. Every reader of the row then misses its fields: a coder bound
  // to a project reads `input.project`, finds none, and its run is refused.
  const project = { project: { visibility: "shared", id: "shift-manager" } };
  const toolsOf = () =>
    taskToolsForTurn(async () => {
      throw new Error("unused");
    }, () => team(["eng.coder"]).roster, { dispatches: true })({});

  for (const name of ["dispatchTask", "addTask"]) {
    it(`${name} refuses the payload as a string, so the model is told to send the object`, () => {
      const tool = toolsOf().find((t) => (t as { name?: string }).name === name) as unknown as {
        inputSchema: { safeParse(v: unknown): { success: boolean } };
      };
      const base = { goal: "Create a file and commit it", assignee: "eng.coder" };
      expect(tool.inputSchema.safeParse({ ...base, input: JSON.stringify(project) }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ ...base, input: project }).success).toBe(true);
    });
  }
});
