/**
 * A coding task's run shows while it runs. The run links itself to its row on
 * its own session, so the conversation that filed the task hears of the link
 * only when the task ends; until then the popup would show nothing, and then
 * every step at once. While a running row names no run, `watchTasks` reads the
 * board until it does.
 */
import { describe, expect, it, vi } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { createLabAdapter, type BoardTask } from "../src/adapter";

/** The conversation's one item: the board's row as filed, with no run yet. */
const filed = (status: string) => ({
  id: "task-change:board/task_1",
  requestId: "req_1",
  type: "component",
  component: "task-change",
  ts: 1,
  itemIndex: 0,
  status: "completed",
  data: { collectionId: "board", taskId: "task_1", kind: "added", task: { id: "task_1", title: "Fix the typo", status, assignee: "teammates.cursor" } },
});

/** A client whose conversation holds `item`, and whose board read names the run once it has started. */
function clientWith(item: ReturnType<typeof filed>) {
  const reads: string[] = [];
  const client = {
    sessions: {
      state: async () => ({ at: 1, sessionCreatedAt: 1, items: [item], pagination: { hasMore: false, nextOffset: 1 } }),
      stream: () => ({ close() {} }),
      get: async () => ({ id: "wks_1", flowKind: "agent" }),
    },
    flow: (flow: string) => ({
      read: async (action: string) => {
        reads.push(`${flow}.${action}`);
        return { ok: true, tasks: [{ ...item.data.task, run: { sessionId: "dsx_run", requestId: "req_run", attempt: 1 } }] };
      },
    }),
  } as unknown as Client;
  return { client, reads };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe("a coding task's run, while it runs", () => {
  it("is named on the task as soon as the board says it started, not when the task ends", async () => {
    const { client, reads } = clientWith(filed("in_progress"));
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => tasks[0]?.runSessionId !== undefined);
    stop();
    expect(tasks[0]?.runSessionId).toBe("dsx_run");
    expect(reads).toContain("agent.listTasks_tasks");
  });

  it("reads no board for a task that has ended: its row already says all there is", async () => {
    const { client, reads } = clientWith(filed("completed"));
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => tasks.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(tasks[0]?.status).toBe("done");
    expect(reads).toEqual([]);
  });
});

describe("a coding task's hold, while it runs", () => {
  /**
   * The run writes its row on its own session: its link, and the review it stops for. The
   * conversation's copy still says only that the task is running, so read alone, nothing waits
   * on you and the popup has no review to answer.
   */
  function clientWithRunRow() {
    const conversation = filed("in_progress");
    const run = { sessionId: "dsx_run", requestId: "req_run", attempt: 1 };
    const held = {
      ...conversation,
      id: "task-change:board/task_1@run",
      requestId: "req_run",
      ts: 2,
      data: {
        ...conversation.data,
        kind: "asked",
        task: {
          ...conversation.data.task,
          run,
          updatedAt: 2,
          holds: [{ id: "susp-1", actor: "user", openedAt: 2, source: { kind: "suspension", requestId: "req_run", suspensionId: "susp-1" }, ask: { kind: "review", prompt: "1 commit on b" } }],
        },
      },
    };
    return {
      sessions: {
        state: async (id: string) => ({ at: 1, sessionCreatedAt: 1, items: id === "dsx_run" ? [held] : [conversation], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async (id: string) => (id === "dsx_run" ? { id, flowKind: "teammates-coder" } : { id, flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [{ ...conversation.data.task, run }] }) }),
    } as unknown as Client;
  }

  it("is read from the run's own session, where the run writes it", async () => {
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(clientWithRunRow()).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => tasks[0]?.waiting !== undefined);
    stop();
    expect(tasks[0]?.waiting).toEqual({ kind: "review", prompt: "1 commit on b", unanswerable: null });
  });

  it("follows no run for a task that has ended, and lets go of a run once its task ends", async () => {
    // The sidebar watches every worker's board: each ended task's run would otherwise hold a stream open for good.
    const opened: string[] = [];
    const closed: string[] = [];
    const pushTo = new Map<string, (event: { item: unknown }) => void>();
    const conversation = filed("in_progress");
    const old = { ...conversation, id: "task-change:board/task_2", data: { ...conversation.data, taskId: "task_2", task: { id: "task_2", title: "Old task", status: "completed", assignee: "teammates.cursor", run: { sessionId: "dsx_old", requestId: "req_old", attempt: 1 } } } };
    const running = { ...conversation, data: { ...conversation.data, task: { ...conversation.data.task, run: { sessionId: "dsx_run", requestId: "req_run", attempt: 1 }, updatedAt: 1 } } };
    const ended = { ...running, id: "task-change:board/task_1@end", ts: 3, itemIndex: 2, data: { ...running.data, kind: "completed", task: { ...running.data.task, status: "completed", updatedAt: 3 } } };
    const client = {
      sessions: {
        state: async (id: string) => ({ at: 1, sessionCreatedAt: 1, items: id === "wks_1" ? [old, running] : [running], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: (id: string, options: { onItem: (event: { item: unknown }) => void }) => {
          opened.push(id);
          pushTo.set(id, options.onItem);
          return { close: () => closed.push(id) };
        },
        get: async (id: string) => ({ id, flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [] }) }),
    } as unknown as Client;
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => opened.includes("dsx_run") && pushTo.has("wks_1"));
    expect(opened).not.toContain("dsx_old");
    expect(closed).not.toContain("dsx_run");
    pushTo.get("wks_1")!({ item: ended });
    await until(() => tasks.find((t) => t.id === "task_1")?.status === "done");
    expect(tasks.find((t) => t.id === "task_1")?.status).toBe("done");
    expect(closed).toContain("dsx_run");
    stop();
  });

  it("a second watch of the same board, once the run's feed has loaded, reads it too", async () => {
    // The popup opens while the conversation still watches: the run's feed answers the second watch at once.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = createLabAdapter(clientWithRunRow());
    let first: BoardTask[] = [];
    const stopFirst = adapter.watchTasks("wks_1", (next) => (first = next));
    await until(() => first[0]?.waiting !== undefined);
    let second: BoardTask[] = [];
    const stopSecond = adapter.watchTasks("wks_1", (next) => (second = next));
    await until(() => second[0]?.waiting !== undefined);
    stopFirst();
    stopSecond();
    expect(second[0]?.waiting?.kind).toBe("review");
    // Following the run once per watch, not again from inside its own first answer.
    expect(errors.mock.calls.flat().some((e) => e instanceof RangeError)).toBe(false);
    errors.mockRestore();
  });
});
