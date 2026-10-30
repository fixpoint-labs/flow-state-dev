/**
 * A coding task's run shows while it runs. The run links itself to its row on
 * its own session, so the conversation that filed the task hears of the link
 * only when the task ends; until then the popup would show nothing, and then
 * every step at once. While a running row names no run, `watchTasks` reads the
 * board until it does.
 */
import { describe, expect, it } from "vitest";
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
