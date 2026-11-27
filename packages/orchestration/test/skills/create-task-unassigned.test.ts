/**
 * `createTask` with no assignee files a task only when something will take
 * it. A board whose default worker claims a task naming nobody keeps it
 * unassigned; otherwise the roster's one worker gets it; otherwise the call is
 * refused, naming who can take it. A task left unassigned on a board that
 * claims only named tasks would wait pending forever while the filer believes
 * it under way.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection, type TaskCollectionRef, type TaskInit } from "../../src/tasks";
import { taskToolActions, taskToolsForTurn, type AssigneeRoster } from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

const ctx = {
  _blockIdentity: { blockName: "createTask", blockInstanceId: "req_1:root/step[0]/tool[createTask][0%3Ac1]:0" },
  emit: { data: () => undefined },
  session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
  request: { identity: { type: "request", id: "req_1" }, state: {} },
  runOnce: async <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn()
} as unknown as BlockContext;

/** A roster over `members`, whose sole assignee is the only member when there is one. */
const rosterOf = (members: string[], extra: Partial<AssigneeRoster> = {}): AssigneeRoster => ({
  has: (name) => members.includes(name),
  describe: () => members.join(", "),
  soleAssignee: () => (members.length === 1 ? members[0] : undefined),
  ...extra
});

/** `createTask` over a board that records every filing it is handed. */
async function createTaskOn(roster: AssigneeRoster | undefined) {
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
  const tools = taskToolsForTurn(async () => board, roster, { dispatches: true })(ctx);
  const tool = tools.find((t) => (t as { name?: string }).name === "createTask") as GeneratorTool;
  const call = (input: Record<string, unknown>) =>
    runForTest(tool as never, input as never, ctx) as Promise<{ ok: boolean; taskId?: string; error?: string }>;
  return { call, filed, collection, board };
}

describe("createTask with no assignee", () => {
  it("keeps the task unassigned on a board whose default worker claims a task naming nobody", async () => {
    const { call, filed } = await createTaskOn(rosterOf(["desk.coder", "desk.researcher"], { claimsUnassigned: true }));
    const out = await call({ goal: "Rename the greeting" });
    expect(out.ok).toBe(true);
    expect(filed).toHaveLength(1);
    expect(filed[0]).not.toHaveProperty("assignee");
  });

  it("gives the task to the roster's one worker when nothing claims a task naming nobody", async () => {
    const { call, filed, collection } = await createTaskOn(rosterOf(["desk.coder"]));
    const out = await call({ goal: "Rename the greeting" });
    expect(out.ok).toBe(true);
    expect(filed).toEqual([expect.objectContaining({ assignee: "desk.coder" })]);
    expect(collection.get(out.taskId!)?.assignee).toBe("desk.coder");
  });

  it("is refused, naming every worker it could name, when nothing would take it", async () => {
    const { call, filed } = await createTaskOn(rosterOf(["desk.coder", "desk.researcher"]));
    const out = await call({ goal: "Rename the greeting" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^assignee_required: /);
    expect(out.error).toContain("desk.coder, desk.researcher");
    // Nothing waits on the board with nobody to run it.
    expect(filed).toEqual([]);
  });

  it("still files a held task unassigned: a hold waits for a person, who names its owner", async () => {
    const { call, filed } = await createTaskOn(rosterOf(["desk.coder", "desk.researcher"]));
    const out = await call({ goal: "Pick someone", held: true });
    expect(out.ok).toBe(true);
    expect(filed).toEqual([expect.objectContaining({ held: true })]);
    expect(filed[0]).not.toHaveProperty("assignee");
  });

  it("files it unassigned through the board's action: a person or an app names its owner later", async () => {
    const { filed, board } = await createTaskOn(rosterOf(["desk.coder", "desk.researcher"]));
    const actions = taskToolActions("desk", async () => board, rosterOf(["desk.coder", "desk.researcher"]));
    const action = Object.values(actions).find((entry) => (entry.block as { name?: string }).name?.startsWith("createTask"))!;
    const out = (await runForTest(action.block as never, { goal: "Pick someone" } as never, ctx)) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(filed).toHaveLength(1);
    expect(filed[0]).not.toHaveProperty("assignee");
  });

  it("is unchecked with no roster, as before", async () => {
    const { call, filed } = await createTaskOn(undefined);
    expect((await call({ goal: "Anything" })).ok).toBe(true);
    expect(filed[0]).not.toHaveProperty("assignee");
  });
});

describe("a replay of a call an older build filed with no assignee (BP-030)", () => {
  it("answers the task it filed, not assignee_required, though the roster now refuses a new one", async () => {
    // The request record as the older build left it: the call's filing id,
    // and no decision about a missing assignee, which that build never made.
    const recorded = new Map<string, unknown>();
    const replay = {
      ...ctx,
      runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        if (key.startsWith("fsd.dispatch.plan:")) return "task_old" as T;
        if (!recorded.has(key)) recorded.set(key, await fn());
        return recorded.get(key) as T;
      }
    } as unknown as BlockContext;
    const collection = await getOrCreateTaskCollection({
      ctx: replay,
      backing: "state",
      state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
      collectionId: "desk"
    });
    await collection.createTask({ id: "task_old", goal: "Rename the greeting" });
    const tools = taskToolsForTurn(async () => collection, rosterOf(["desk.coder", "desk.researcher"]), { dispatches: true })(replay);
    const tool = tools.find((t) => (t as { name?: string }).name === "createTask") as GeneratorTool;
    const out = (await runForTest(tool as never, { goal: "Rename the greeting" } as never, replay)) as { ok: boolean; taskId?: string; error?: string };
    expect(out).toEqual(expect.objectContaining({ ok: true, taskId: "task_old" }));
    // Still one task: the replay found its own row instead of filing a second.
    expect(collection.list()).toHaveLength(1);
  });
});

describe("createTask with an assignee", () => {
  it("files it for the worker named, whatever the board does with a task naming nobody", async () => {
    for (const roster of [rosterOf(["desk.coder", "desk.researcher"]), rosterOf(["desk.coder", "desk.researcher"], { claimsUnassigned: true })]) {
      const { call, filed } = await createTaskOn(roster);
      const out = await call({ goal: "Find the price", assignee: "desk.researcher" });
      expect(out.ok).toBe(true);
      expect(filed).toEqual([expect.objectContaining({ assignee: "desk.researcher" })]);
    }
  });

  it("refuses one off the roster without offering to leave it unset where nothing takes an unassigned task", async () => {
    const strict = await createTaskOn(rosterOf(["desk.coder", "desk.researcher"]));
    const out = await strict.call({ goal: "x", assignee: "desk.nobody" });
    expect(out.error).toMatch(/^unknown_assignee: /);
    expect(out.error).not.toContain("leave assignee unset");
    const floor = await createTaskOn(rosterOf(["desk.coder", "desk.researcher"], { claimsUnassigned: true }));
    expect((await floor.call({ goal: "x", assignee: "desk.nobody" })).error).toContain("leave assignee unset");
  });
});
