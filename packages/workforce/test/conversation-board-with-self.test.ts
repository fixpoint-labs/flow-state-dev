/**
 * A turn's roster (`withSelf`) is the board's roster plus the worker itself.
 * Everything the board's roster says about a task with no assignee carries
 * through it: a roster whose board claims a task naming nobody
 * (`claimsUnassigned`) must not turn strict once a turn wraps it, or
 * `createTask` would refuse a task the board would have run.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { AssigneeRoster, Task, TaskCollectionRef, TaskInit } from "@flow-state-dev/orchestration";
import { taskToolsForTurn } from "@flow-state-dev/orchestration/internal";
import { runForTest } from "@flow-state-dev/testing";
import { withSelf } from "../src/conversation-board/board";

const ctx = {
  _blockIdentity: { blockName: "createTask", blockInstanceId: "req_1:root/step[0]/tool[createTask][0%3Ac1]:0" },
  emit: { data: () => undefined },
  session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
  request: { identity: { type: "request", id: "req_1" }, state: {} }
} as unknown as BlockContext;

/** A board that keeps what it is handed, and reads it back. */
function recordingBoard(): { board: TaskCollectionRef; filed: TaskInit[] } {
  const filed: TaskInit[] = [];
  const tasks = new Map<string, Task>();
  const board = {
    collectionId: "desk",
    get: (id: string) => tasks.get(id),
    list: () => [...tasks.values()],
    createTask: async (init: TaskInit) => {
      filed.push(init);
      const task = { id: `task_${filed.length}`, status: "pending", ...init } as unknown as Task;
      tasks.set(task.id, task);
      return task;
    }
  } as unknown as TaskCollectionRef;
  return { board, filed };
}

describe("a turn's roster", () => {
  it("files a task with no assignee unassigned when the board's roster says its default worker claims one", async () => {
    const roster: AssigneeRoster = {
      has: (name) => name === "eng.coder" || name === "eng.writer",
      describe: () => "eng.coder, eng.writer",
      soleAssignee: () => undefined,
      claimsUnassigned: true
    };
    const { board, filed } = recordingBoard();
    const tools = taskToolsForTurn(async () => board, withSelf(roster, "desk"))(ctx);
    const create = tools.find((tool) => (tool as { name?: string }).name === "createTask") as GeneratorTool;
    const out = (await runForTest(create as never, { goal: "Anything" } as never, ctx)) as { ok: boolean; error?: string };
    expect(out.error).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(filed).toHaveLength(1);
    expect(filed[0]).not.toHaveProperty("assignee");
  });
});
