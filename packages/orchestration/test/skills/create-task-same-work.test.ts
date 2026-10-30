/**
 * `createTask` files one task for one piece of work (FIX-2350): a second
 * filing of the same goal for the same worker, while the first is still open,
 * is refused and names the open task by its title, so one ask can't start two
 * runs. Work that differs, another worker, or a task that has ended files as
 * before. A replay of the call that filed the row still answers with its own
 * row (`create-task-starts-work.test.ts` pins that).
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
} from "../../src/tasks";
import {
  taskToolsForTurn,
  type AssigneeRoster,
} from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

function boardCtx(): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } },
  } as unknown as BlockContext;
}

const board = () =>
  getOrCreateTaskCollection({
    ctx: boardCtx(),
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "desk",
  });

const roster: AssigneeRoster = {
  has: (name) =>
    name === "teammates.claude-code" || name === "teammates.cursor",
  describe: () => "teammates.claude-code, teammates.cursor",
};

function createTool(
  collection: TaskCollectionRef,
  dispatches: boolean,
): GeneratorTool {
  const tools = taskToolsForTurn(async () => collection, roster, {
    dispatches,
  })({});
  const found = tools.find(
    (t) => (t as { name?: string }).name === "createTask",
  );
  if (found === undefined) throw new Error("createTask is not offered");
  return found;
}

type Result = { ok: boolean; taskId?: string; error?: string };
const run = (t: GeneratorTool, input: Record<string, unknown>) =>
  runForTest(t as never, input as never, boardCtx()) as Promise<Result>;

const FIX = {
  title: "Misc bug fix",
  goal: "Fix the typo in README.md: 'Relay keps' should read 'Relay keeps'.",
  assignee: "teammates.claude-code",
};

describe("one piece of work makes one task", () => {
  for (const dispatches of [true, false]) {
    const where = dispatches
      ? "a board that dispatches"
      : "a board a drain runs";

    it(`refuses a second filing of the same work for the same worker while the first is open, naming it by title, on ${where}`, async () => {
      // What Jake saw: one ask ("give the task to Claude") filed twice in one turn.
      const collection = await board();
      const tool = createTool(collection, dispatches);
      const first = await run(tool, FIX);
      expect(first.ok).toBe(true);

      // The same goal, with its spacing and case changed, as a retried call may send it.
      const second = await run(tool, {
        ...FIX,
        goal: `  ${FIX.goal.toUpperCase()} `,
      });
      expect(second.ok).toBe(false);
      expect(second.error).toMatch(/^already_open: /);
      expect(second.error).toContain('"Misc bug fix"');
      expect(collection.list()).toHaveLength(1);
    });

    it(`files one task for two calls of the same work sent together in one step, on ${where}`, async () => {
      // A generator runs a step's sibling tool calls at once: the check and the filing must not interleave.
      const collection = await board();
      const tool = createTool(collection, dispatches);
      const results = await Promise.all([run(tool, FIX), run(tool, FIX)]);
      expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
      expect(collection.list()).toHaveLength(1);
    });

    it(`files the same work again once the first task has ended, on ${where}`, async () => {
      const collection = await board();
      const tool = createTool(collection, dispatches);
      const first = await run(tool, FIX);
      await collection.cancel(first.taskId!, "replaced");
      expect((await run(tool, FIX)).ok).toBe(true);
      expect(collection.list()).toHaveLength(2);
    });
  }

  it("files the same work for another worker: a switch of coding agent is one new task", async () => {
    const collection = await board();
    const tool = createTool(collection, true);
    expect((await run(tool, { ...FIX, assignee: "teammates.cursor" })).ok).toBe(
      true,
    );
    expect((await run(tool, FIX)).ok).toBe(true);
    expect(collection.list().map((t) => t.assignee)).toEqual([
      "teammates.cursor",
      "teammates.claude-code",
    ]);
  });

  it("refuses the same work filed twice with no assignee, when the roster's one worker takes both", async () => {
    const collection = await board();
    const sole: AssigneeRoster = { ...roster, soleAssignee: () => "teammates.claude-code" };
    const tools = taskToolsForTurn(async () => collection, sole, { dispatches: true })({});
    const tool = tools.find((t) => (t as { name?: string }).name === "createTask")!;
    const { assignee: _assignee, ...unassigned } = FIX;
    // The board's own write fills the sole worker in, as a conversation board does.
    const first = await run(tool, unassigned);
    await collection.setAssignee?.(first.taskId!, "teammates.claude-code");
    const second = await run(tool, unassigned);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/^already_open: /);
  });

  it("files different work for the same worker", async () => {
    const collection = await board();
    const tool = createTool(collection, true);
    expect((await run(tool, FIX)).ok).toBe(true);
    expect(
      (
        await run(tool, {
          ...FIX,
          title: "Changelog",
          goal: "Add a changelog line for the typo fix.",
        })
      ).ok,
    ).toBe(true);
    expect(collection.list()).toHaveLength(2);
  });
});
