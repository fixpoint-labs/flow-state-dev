// FIX-2286; FIX-2623.
// FIX-2286 D2.
/**
 * Watching a conversation's task board stores nothing.
 *
 * An app watches the board through the `listTasks_tasks` session view,
 * `client.view(taskListViewRef(flow, "tasks"), ...)`, instead of running the
 * action of the same name. The view must answer the rows the action lists,
 * keyed by task id, add no request however often it is called, reach only a
 * conversation its caller owns, and never run the board's pass:
 * a row whose start was lost waits for an action, not a look. Every
 * assertion on what was stored reads the store, not the view's own answer.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const LIST = "listTasks_tasks";

/** Every request in the store, read from the store itself. */
const requestCount = async (host: BoardHost) => (await (await host.state.getRuntime()).stores.request.list({})).length;

/** `userId`'s client over the host's router, in process. */
function clientOf(host: BoardHost, userId: string) {
  const inProcess = createInProcessFetch(host.state);
  return createClient({
    userId,
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-user", userId);
      return inProcess(input, { ...init, headers });
    }
  });
}

const file = async (host: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await host.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: true; taskId: string };
};

const board = taskListViewRef("coordinator", "tasks");
const view = (host: BoardHost, userId: string, conv: string) => clientOf(host, userId).view(board, {}, { sessionId: conv });
const read = async (host: BoardHost, userId: string, conv: string) => ({ tasks: (await view(host, userId, conv)).value });

describe("the conversation board's listTasks view", () => {
  it("is named as the action is", () => {
    expect(board).toMatchObject({ flow: "coordinator", view: LIST });
  });

  it("answers the rows the action lists, keyed by task id, and adds no request however often it's called", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, conv, { goal: "Audit licenses", assignee: "eng.tasker" });
      await file(host, conv, { goal: "Draft the notes", assignee: "eng.tasker", held: true });
      await host.settled();

      const requestsBefore = (await requestCount(host));
      const rowsBefore = JSON.stringify(await host.rows("alice"));
      const answers = [];
      for (let i = 0; i < 10; i += 1) answers.push(await view(host, "alice", conv));
      expect((await requestCount(host))).toBe(requestsBefore);
      expect(JSON.stringify(await host.rows("alice"))).toBe(rowsBefore);

      const acted = await host.act("alice", conv, LIST, {});
      expect(acted.error, messageOf(acted.error)).toBeUndefined();
      const listed = (acted.output as { ok: true; tasks: Array<{ id: string }> }).tasks;
      expect(answers[0]!.value).toEqual(listed);
      expect(answers[0]!.keys).toEqual(listed.map((task) => task.id));
      expect(answers[0]!.value.map((task) => task.status).sort()).toEqual(["completed", "held"]);
      expect(new Set(answers.map((answer) => JSON.stringify(answer.value))).size).toBe(1);
    } finally {
      await host.dispose();
    }
  });

  it("answers another user as for a conversation that doesn't exist", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, conv, { goal: "Audit licenses", assignee: "eng.tasker", held: true });
      await expect(read(host, "bob", conv)).rejects.toMatchObject({ status: 404 });
      // The control: the same call as alice is answered.
      expect((await read(host, "alice", conv)).tasks).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  // FIX-2286 D2.
  it("never runs the board's pass: a task whose start was lost waits for an action, not a look", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const held = await file(host, conv, { goal: "Audit licenses", assignee: "eng.tasker", held: true });
      await host.settled();
      // Released by a write that sent no wake: the row is startable, and owed a pass.
      const filing = await host.filingOf("alice", conv);
      const { partition: _partition, ...row } = (await host.row("alice", filing, held.taskId))!;
      await host.writeRow("alice", filing, { ...(row as Task), status: "pending" } as Task);

      const requestsBefore = (await requestCount(host));
      expect((await read(host, "alice", conv)).tasks).toEqual([expect.objectContaining({ id: held.taskId, status: "pending" })]);
      await host.settled();
      expect((await requestCount(host))).toBe(requestsBefore);
      expect((await host.row("alice", filing, held.taskId))?.status).toBe("pending");

      // The action's touch does run it.
      expect((await host.act("alice", conv, LIST, {})).error).toBeUndefined();
      await host.settled();
      expect((await host.row("alice", filing, held.taskId))?.status).toBe("completed");
    } finally {
      await host.dispose();
    }
  });
});
