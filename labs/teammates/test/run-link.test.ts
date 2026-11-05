/**
 * A coding task's run shows while it runs. The run links itself to its row on
 * its own session, so the conversation's own stream hears of the link only
 * when the task ends; until then the popup would show nothing, and then every
 * step at once. The link is a board change (FIX-2429): `watchTasks` reads the
 * board on each notice of the conversation's board, and on a timer only where
 * push can miss a change (`client.subscribe` owns that timer).
 */
import { describe, expect, it, vi } from "vitest";
import type { Client, SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";
import { createLabAdapter, type BoardTask } from "../src/adapter";

/** `client.subscribe`, faked: each subscription is kept so a case can deliver its notices. */
function fakeSubscribe() {
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  const subscribe = (topics: readonly WireTopic[], options: SubscribeOptions) => {
    const entry = { topics, options, closed: false };
    subscriptions.push(entry);
    return { close: () => void (entry.closed = true) };
  };
  const hear = (notice: WireNotice | null) => {
    for (const s of subscriptions) if (!s.closed) s.options.onChange(notice);
  };
  return { subscribe, subscriptions, hear };
}

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

/** A client whose conversation holds `item`, and whose board read names the run once `started`. */
function clientWith(item: ReturnType<typeof filed>, started = () => true) {
  const reads: string[] = [];
  const push = fakeSubscribe();
  const client = {
    subscribe: push.subscribe,
    sessions: {
      state: async () => ({ at: 1, sessionCreatedAt: 1, items: [item], pagination: { hasMore: false, nextOffset: 1 } }),
      stream: () => ({ close() {} }),
      get: async () => ({ id: "wks_1", flowKind: "agent" }),
    },
    flow: (flow: string) => ({
      read: async (action: string) => {
        reads.push(`${flow}.${action}`);
        return { ok: true, tasks: [{ ...item.data.task, ...(started() ? { run: { sessionId: "dsx_run", requestId: "req_run", attempt: 1 } } : {}) }] };
      },
    }),
  } as unknown as Client;
  return { client, reads, push };
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

  it("subscribes the conversation's board and plan ledgers, narrowed, with today's pace for where push can miss a change", async () => {
    const { client, push } = clientWith(filed("in_progress"));
    const stop = createLabAdapter(client).watchTasks("wks_1", () => {});
    await until(() => push.subscriptions.length > 0);
    stop();
    expect(push.subscriptions[0]!.topics).toEqual([
      { scope: "session", id: "wks_1", resource: "tasks" },
      { scope: "session", id: "wks_1", resource: "plan" },
    ]);
    expect(push.subscriptions[0]!.options.pollIntervalMs).toBe(1_500);
    expect(push.subscriptions[0]!.closed).toBe(true);
  });

  it("names the run when its link's board notice arrives, and reads the board for nothing else", async () => {
    let started = false;
    const { client, reads, push } = clientWith(filed("in_progress"), () => started);
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => reads.length === 1);
    // No timer of its own: with no notice, the board is read once.
    await new Promise((r) => setTimeout(r, 1_700));
    expect(reads).toHaveLength(1);
    expect(tasks[0]?.runSessionId).toBeUndefined();
    started = true;
    push.hear({ topic: { scope: "session", id: "wks_1", resource: "tasks" }, kind: "board" });
    await until(() => tasks[0]?.runSessionId !== undefined);
    stop();
    expect(tasks[0]?.runSessionId).toBe("dsx_run");
    expect(reads).toHaveLength(2);
  });

  it("takes the board read over the conversation's copy when the read is as new or newer", async () => {
    // The read names when the row was last written, as the conversation's copy does: the newer copy wins, a tie the read.
    const item = filed("in_progress");
    const stamped = { ...item, data: { ...item.data, task: { ...item.data.task, updatedAt: 1 } } };
    const push = fakeSubscribe();
    let linked = false;
    const client = {
      subscribe: push.subscribe,
      sessions: {
        state: async () => ({ at: 1, sessionCreatedAt: 1, items: [stamped], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async () => ({ id: "wks_1", flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [{ ...item.data.task, updatedAt: linked ? 3 : 1, ...(linked ? { run: { sessionId: "dsx_run", requestId: "req_run", attempt: 1 } } : {}) }] }) }),
    } as unknown as Client;
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => tasks.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    linked = true;
    push.hear({ topic: { scope: "session", id: "wks_1", resource: "tasks" }, kind: "board" });
    await until(() => tasks[0]?.runSessionId !== undefined);
    stop();
    expect(tasks[0]?.runSessionId).toBe("dsx_run");
  });

  it("shows a task that settled in its own session as the board reads it, newer than the conversation's copy", async () => {
    const item = filed("in_progress");
    const push = fakeSubscribe();
    let status = "in_progress";
    const client = {
      subscribe: push.subscribe,
      sessions: {
        state: async () => ({ at: 1, sessionCreatedAt: 1, items: [item], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async () => ({ id: "wks_1", flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [{ ...item.data.task, status, updatedAt: status === "completed" ? 5 : 1 }] }) }),
    } as unknown as Client;
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => tasks.length > 0);
    status = "completed";
    push.hear({ topic: { scope: "session", id: "wks_1", resource: "tasks" }, kind: "board" });
    await until(() => tasks[0]?.status === "done");
    stop();
    expect(tasks[0]?.status).toBe("done");
  });
});

describe("what a task's runs spent, as the board read folds it", () => {
  it("keeps the harness and model the read reports: its `spend` is already a folded view", async () => {
    const item = filed("completed");
    const push = fakeSubscribe();
    const client = {
      subscribe: push.subscribe,
      sessions: {
        state: async () => ({ at: 1, sessionCreatedAt: 1, items: [item], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async () => ({ id: "wks_1", flowKind: "agent" }),
      },
      flow: () => ({
        read: async () => ({
          ok: true,
          tasks: [{ ...item.data.task, spend: { harness: "codex", model: "gpt-5.5-codex", inputTokens: 10, outputTokens: 5, costUsd: null, unreported: false, live: false } }],
        }),
      }),
    } as unknown as Client;
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => tasks[0]?.model !== undefined);
    stop();
    expect(tasks[0]).toMatchObject({ harness: "Codex", model: "gpt-5.5-codex" });
  });
});

describe("a hold answered in the run's session", () => {
  it("leaves the card once the board read stops listing it, though the conversation's older copy still holds it", async () => {
    const run = { sessionId: "dsx_run", requestId: "req_run", attempt: 1 };
    const hold = { id: "susp-1", actor: "user", openedAt: 2, source: { kind: "suspension", requestId: "req_run", suspensionId: "susp-1" }, ask: { kind: "review", prompt: "1 commit on b" } };
    const conversation = filed("in_progress");
    // The conversation's copy caught the row while the review was open.
    const held = { ...conversation, data: { ...conversation.data, task: { ...conversation.data.task, run, updatedAt: 2, holds: [hold] } } };
    const push = fakeSubscribe();
    let answered = false;
    const client = {
      subscribe: push.subscribe,
      sessions: {
        state: async (id: string) => ({ at: 1, sessionCreatedAt: 1, items: id === "dsx_run" ? [] : [held], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async (id: string) => (id === "dsx_run" ? { id, flowKind: "teammates-coder" } : { id, flowKind: "agent" }),
      },
      // `listTasks` lists a row's open holds, and leaves `holds` out once none is open.
      flow: () => ({ read: async () => ({ ok: true, tasks: [{ ...conversation.data.task, run, updatedAt: answered ? 3 : 2, ...(answered ? {} : { holds: [hold] }) }] }) }),
    } as unknown as Client;
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await until(() => tasks[0]?.waiting !== undefined);
    answered = true;
    push.hear({ topic: { scope: "session", id: "wks_1", resource: "tasks" }, kind: "board" });
    await until(() => tasks[0]?.waiting === undefined);
    stop();
    expect(tasks[0]?.waiting).toBeUndefined();
  });
});

describe("a row the run's feed and the board read both carry", () => {
  /**
   * The conversation's copy names the run, so the run's own session is followed and supplies a
   * copy of the row (updatedAt 5). The board read is whatever `board()` answers then.
   */
  function twoSources(board: () => Record<string, unknown>) {
    const run = { sessionId: "dsx_run", requestId: "req_run", attempt: 1 };
    const conversation = filed("in_progress");
    const linked = { ...conversation, data: { ...conversation.data, task: { ...conversation.data.task, run, updatedAt: 2 } } };
    const fromRun = { ...linked, id: "task-change:board/task_1@run", requestId: "req_run", ts: 5, data: { ...linked.data, kind: "progress_reported", task: { ...linked.data.task, updatedAt: 5 } } };
    const push = fakeSubscribe();
    const client = {
      subscribe: push.subscribe,
      sessions: {
        state: async (id: string) => ({ at: 1, sessionCreatedAt: 1, items: id === "dsx_run" ? [fromRun] : [linked], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async (id: string) => ({ id, flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [{ ...linked.data.task, ...board() }] }) }),
    } as unknown as Client;
    return { client, push };
  }
  const notice = { topic: { scope: "session" as const, id: "wks_1", resource: "tasks" }, kind: "board" as const };

  it("shows a spend the board read reports after the run's copy arrived", async () => {
    let spend: unknown = null;
    const { client, push } = twoSources(() => ({ updatedAt: 5, spend }));
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await new Promise((r) => setTimeout(r, 100));
    spend = { harness: "codex", model: "gpt-5.5-codex", inputTokens: 10, outputTokens: 5, costUsd: null, unreported: false, live: true };
    push.hear(notice);
    await until(() => tasks[0]?.model !== undefined);
    stop();
    expect(tasks[0]).toMatchObject({ harness: "Codex", model: "gpt-5.5-codex" });
  });

  it("shows a completion the board read reports while the run's copy still says running", async () => {
    let done = false;
    const { client, push } = twoSources(() => (done ? { status: "completed", updatedAt: 9 } : { updatedAt: 5 }));
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next));
    await new Promise((r) => setTimeout(r, 100));
    done = true;
    push.hear(notice);
    await until(() => tasks[0]?.status === "done");
    stop();
    expect(tasks[0]?.status).toBe("done");
  });
});

describe("a board read still in flight when the watch stops", () => {
  it("shows nothing and follows no run once it lands", async () => {
    const item = filed("in_progress");
    const push = fakeSubscribe();
    const opened: string[] = [];
    let land!: () => void;
    const client = {
      subscribe: push.subscribe,
      sessions: {
        state: async () => ({ at: 1, sessionCreatedAt: 1, items: [item], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: (id: string) => {
          opened.push(id);
          return { close() {} };
        },
        get: async () => ({ id: "wks_1", flowKind: "agent" }),
      },
      flow: () => ({
        read: () =>
          new Promise((resolve) => {
            land = () => resolve({ ok: true, tasks: [{ ...item.data.task, run: { sessionId: "dsx_run", requestId: "req_run", attempt: 1 } }] });
          }),
      }),
    } as unknown as Client;
    const calls: BoardTask[][] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => calls.push(next));
    await until(() => land !== undefined && calls.length > 0);
    const before = calls.length;
    stop();
    land();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(before);
    expect(opened).not.toContain("dsx_run");
  });
});

describe("a coding task's hold, while it runs", () => {
  /**
   * The run writes its row on its own session: its link, and the review it stops for. The
   * conversation's copy still says only that the task is running. The write sends a board notice,
   * and the board's read lists the open hold, as `listTasks` does.
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
      subscribe: fakeSubscribe().subscribe,
      sessions: {
        state: async (id: string) => ({ at: 1, sessionCreatedAt: 1, items: id === "dsx_run" ? [held] : [conversation], pagination: { hasMore: false, nextOffset: 1 } }),
        stream: () => ({ close() {} }),
        get: async (id: string) => (id === "dsx_run" ? { id, flowKind: "teammates-coder" } : { id, flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [{ ...held.data.task }] }) }),
    } as unknown as Client;
  }

  it("is read from the board, which the run's write reaches from its own session", async () => {
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
      subscribe: fakeSubscribe().subscribe,
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
    // The run writes its ending in its own session; the conversation hears of it too.
    pushTo.get("dsx_run")!({ item: ended });
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

describe("the board read's freshness", () => {
  it("says stale while the board's read fails, keeping the last rows, and fresh once one succeeds", async () => {
    let failing = false;
    const { client, push } = clientWith(filed("in_progress"));
    const flow = (client as unknown as { flow: (f: string) => { read: (a: string) => Promise<unknown> } }).flow;
    (client as unknown as { flow: unknown }).flow = (name: string) => ({
      read: async (action: string) => {
        if (failing) throw new Error("the board is down");
        return flow(name).read(action);
      },
    });
    let tasks: BoardTask[] = [];
    const stale: boolean[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_1", (next) => (tasks = next), (next) => stale.push(next));
    await until(() => tasks.length === 1);
    expect(stale).toEqual([]);

    failing = true;
    push.hear({ kind: "resource" } as WireNotice);
    await until(() => stale.length === 1);
    expect(stale).toEqual([true]);
    expect(tasks).toHaveLength(1);

    failing = false;
    push.hear({ kind: "resource" } as WireNotice);
    await until(() => stale.length === 2);
    stop();
    expect(stale).toEqual([true, false]);
  });
});
