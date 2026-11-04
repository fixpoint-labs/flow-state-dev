/**
 * What a task's buttons send, and where. Each goes to the board of the
 * conversation that filed the task, through the Inbox client's
 * `board(at)`, on its `"tasks"` collection. Re-run files the task again on
 * another coding worker with its brief kept and a line naming the task it
 * re-runs: sent anywhere else, or without the old brief, the new task runs
 * with no idea what it replaces, and its result never reaches the
 * conversation that asked for the first.
 */
import { describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { createLabAdapter, toBoardTask } from "../src/adapter";

/** A client that takes every board action, answering `answer`, and keeps each one sent. */
function boardClient(answer: Record<string, unknown>) {
  const sent: Array<{ flow: string; action: string; input: Record<string, unknown>; sessionId: string }> = [];
  const client = {
    sessions: {
      get: async (id: string) => ({ id, flowKind: "agent" }),
      requests: async () => sent.map((_, i) => ({ id: `req_${i}`, result: { output: answer } })),
    },
    flow: (flow: string) => ({
      send: async (action: string, input: Record<string, unknown>, { sessionId }: { sessionId: string }) => {
        sent.push({ flow, action, input, sessionId });
        return { id: `req_${sent.length - 1}` };
      },
      request: () => ({ wait: async () => ({ status: "completed" }) }),
    }),
  } as unknown as Client;
  return { client, sent };
}

/** A coding task on Cursor that failed, as the board's read carries it. */
const failedRow = {
  id: "task_1",
  title: "Fix the typo",
  goal: "Fix the typo in the README's first line.",
  context: "Only line 1: leave the rest of the README alone.",
  assignee: "teammates.cursor",
  labels: ["docs"],
  priority: 2,
  status: "errored",
  error: "Cursor isn't set up on this machine.",
};

describe("a task's buttons act on the board of the conversation that filed it", () => {
  it("re-run files the task again on the other worker, the old brief kept and a line naming the old task by title", async () => {
    const { client, sent } = boardClient({ ok: true, taskId: "task_2" });
    const task = toBoardTask(failedRow, () => "cursor");
    const id = await createLabAdapter(client).taskActions("wks_cos").rerun(task, "teammates.claude-code");

    expect(id).toBe("task_2");
    expect(sent).toHaveLength(1);
    const [filed] = sent;
    expect([filed!.flow, filed!.action, filed!.sessionId]).toEqual(["agent", "createTask_tasks", "wks_cos"]);
    // Copied as filed, and only the assignee changed.
    expect(filed!.input).toMatchObject({ goal: failedRow.goal, title: "Fix the typo", labels: ["docs"], priority: 2, assignee: "teammates.claude-code" });
    const context = String(filed!.input.context);
    expect(context.startsWith(`${failedRow.context}\n\n`)).toBe(true);
    expect(context.slice(failedRow.context.length)).toMatch(/"Fix the typo", which failed on Cursor/);
  });

  it("re-run of a task filed with no brief carries just the line naming it", async () => {
    const { client, sent } = boardClient({ ok: true, taskId: "task_2" });
    const { context: _, ...bare } = failedRow;
    await createLabAdapter(client).taskActions("wks_cos").rerun(toBoardTask({ ...bare, status: "cancelled" }), "teammates.codex");
    expect(sent[0]!.input.context).toBe('This re-runs the task "Fix the typo", which was cancelled.');
  });

  it("cancel, steer, release and retry go to the same board's own actions", async () => {
    const { client, sent } = boardClient({ ok: true });
    const actions = createLabAdapter(client).taskActions("wks_cos");
    await actions.cancel("task_1");
    await actions.steer("task_1", "Only line 1.");
    await actions.release("task_1");
    await actions.retry("task_1");
    expect(sent.map(({ action, input, sessionId }) => [action, input, sessionId])).toEqual([
      ["updateTask_tasks", { id: "task_1", status: "cancelled" }, "wks_cos"],
      ["updateTask_tasks", { id: "task_1", message: "Only line 1." }, "wks_cos"],
      ["updateTask_tasks", { id: "task_1", status: "pending" }, "wks_cos"],
      ["retryTask_tasks", { id: "task_1" }, "wks_cos"],
    ]);
  });

  it("a refusal shows as the board's own words", async () => {
    const { client } = boardClient({ ok: false, error: 'already_open: task "Fix the typo" (task_2) is this same work for teammates.claude-code' });
    await expect(createLabAdapter(client).taskActions("wks_cos").rerun(toBoardTask(failedRow), "teammates.claude-code")).rejects.toThrow(/^already_open: /);
  });
});

describe("a task as the popup reads it", () => {
  it("keeps a failed task's error apart from its result, and carries its board status and brief", () => {
    const task = toBoardTask(failedRow);
    expect(task).toMatchObject({ status: "failed", boardStatus: "errored", error: failedRow.error, goal: failedRow.goal, context: failedRow.context, labels: ["docs"], priority: 2 });
    expect(task.result).toBeUndefined();
    const done = toBoardTask({ ...failedRow, status: "completed", error: undefined, output: { answer: "Fixed it." } });
    expect([done.result, done.error]).toEqual(["Fixed it.", undefined]);
  });
});

describe("a task's brief, which the board's list read leaves out", () => {
  it("comes from the conversation's copy of the row, so a re-run keeps it whether the task is open or ended", async () => {
    // The board's `listTasks` read carries no context, labels or priority; the conversation's `task-change` copy does.
    const stored = { ...failedRow, status: "in_progress" };
    const item = {
      id: "task-change:board/task_1",
      requestId: "req_1",
      type: "component",
      component: "task-change",
      ts: 1,
      itemIndex: 0,
      status: "completed",
      data: { collectionId: "tasks", taskId: "task_1", kind: "added", task: stored },
    };
    let listed: Record<string, unknown> = { id: "task_1", title: stored.title, goal: stored.goal, assignee: stored.assignee, status: "in_progress", attempts: 1 };
    const subscriptions: Array<(notice: unknown) => void> = [];
    const client = {
      subscribe: (_topics: unknown, options: { onChange: (notice: unknown) => void }) => (subscriptions.push(options.onChange), { close() {} }),
      sessions: {
        state: async () => ({ at: 1, sessionCreatedAt: 1, items: [item], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async () => ({ id: "wks_cos", flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [listed] }) }),
    } as unknown as Client;
    let tasks: ReturnType<typeof toBoardTask>[] = [];
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    };
    const stop = createLabAdapter(client).watchTasks("wks_cos", (next) => (tasks = next));
    await until(() => tasks[0]?.boardStatus === "in_progress" && subscriptions.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    expect(tasks[0]).toMatchObject({ context: failedRow.context, labels: ["docs"], priority: 2 });

    listed = { ...listed, status: "cancelled", updatedAt: 9 };
    for (const hear of subscriptions) hear({ topic: { scope: "session", id: "wks_cos", resource: "tasks" }, kind: "board" });
    await until(() => tasks[0]?.boardStatus === "cancelled");
    stop();
    expect(tasks[0]).toMatchObject({ boardStatus: "cancelled", context: failedRow.context, labels: ["docs"], priority: 2 });
  });
});
