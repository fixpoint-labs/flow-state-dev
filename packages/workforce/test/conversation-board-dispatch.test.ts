/**
 * Dispatching work on a conversation's board (FIX-1875 V2, V4).
 *
 * A held row is never started by any of the board's start paths: the claim,
 * the drain's exit, a filing's wake, an assign's wake, a touch's wake.
 * `updateTask({ status: "pending" })` releases one, and `createTask` files a
 * new row ready, starting it at once (FIX-2083). Some rows are
 * seeded in the shape an older build stored a recorded row in (`undispatched`,
 * FIX-1875), which the board reads as held (FIX-2080); every leg reads the
 * store, never the action's own say-so.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const act = async (host: BoardHost, conv: string, action: string, input: Record<string, unknown>, userId = "alice") => {
  const result = await host.act(userId, conv, action, input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

/** A row recorded for `assignee` and not dispatched, written as the store holds it. */
function recorded(id: string, assignee: string | undefined, goal = "Audit licenses"): Task {
  return {
    id,
    goal,
    status: "pending",
    attempts: 0,
    maxAttempts: 2,
    ...(assignee === undefined ? {} : { assignee }),
    undispatched: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as Task;
}

describe("a recorded row on a conversation's board (V4)", () => {
  it("is never started by a touch, a filing's wake, an assign's wake or a run of the board", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_recorded", "eng.tasker"));

      // A touch: every action on the board starts what's startable.
      for (let i = 0; i < 5; i += 1) await act(host, conv, "listTasks_tasks", {});
      // A filing that starts its own row, so the board runs and its drain exits.
      const other = await act(host, conv, "createTask_tasks", { goal: "Write the notes", assignee: "eng.tasker" });
      expect(other.ok).toBe(true);
      await host.settled();
      // An assign that names the row's new owner: it moves, and stays held.
      expect(await act(host, conv, "updateTask_tasks", { id: "task_recorded", assignee: "eng.writer" })).toEqual({
        ok: true
      });
      await host.settled();
      for (let i = 0; i < 5; i += 1) await act(host, conv, "listTasks_tasks", {});
      await host.settled();

      const row = await host.row("alice", filing, "task_recorded");
      // The assign's write stored the row as it is read now: held, no mark.
      expect(row).toMatchObject({ status: "held", attempts: 0, assignee: "eng.writer" });
      expect(row).not.toHaveProperty("undispatched");
      expect(host.runs.map((run) => run.taskId)).toEqual([other.taskId]);
    } finally {
      await host.dispose();
    }
  });

  it("a row stored before the mark existed, assigned and pending, still starts on the next touch (BR-5)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const { undispatched: _drop, ...old } = recorded("task_old", "eng.tasker");
      await host.writeRow("alice", filing, old as Task);
      await act(host, conv, "listTasks_tasks", {});
      await host.settled();
      expect(await host.row("alice", filing, "task_old")).toMatchObject({ status: "completed" });
    } finally {
      await host.dispose();
    }
  });
});

describe("createTask held and updateTask on a conversation's board (FIX-1875 S7, V5, FIX-2081)", () => {
  it("createTask_tasks held files a row for a delegate, and 20 touches of the board start nothing (BR-1, BR-27)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const filed = await act(host, conv, "createTask_tasks", { held: true, goal: "Audit licenses", assignee: "eng.tasker" });
      expect(filed).toMatchObject({ ok: true, status: "held" });
      for (let i = 0; i < 20; i += 1) {
        await act(host, conv, "listTasks_tasks", {});
        await host.settled();
      }
      expect(await host.row("alice", filing, filed.taskId!)).toMatchObject({
        status: "held",
        attempts: 0,
        assignee: "eng.tasker"
      });
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("an unassigned held createTask_tasks takes the only delegate and is still held (BR-2)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await act(host, conv, "createTask_tasks", { held: true, goal: "Audit licenses" });
      await host.settled();
      expect(await host.row("alice", filing, filed.taskId!)).toMatchObject({
        status: "held",
        assignee: "eng.tasker"
      });
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("updateTask({ assignee }) on a ready, unclaimed row moves it and starts it, as before (BR-4)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      // Ready (no mark) with nobody to run it: flow code filed it unassigned.
      const { undispatched: _drop, ...ready } = recorded("task_ready", undefined);
      await host.writeRow("alice", filing, ready as Task);
      await act(host, conv, "listTasks_tasks", {});
      await host.settled();
      expect(host.runs).toEqual([]);
      await act(host, conv, "updateTask_tasks", { id: "task_ready", assignee: "eng.writer" });
      await host.settled();
      expect(await host.row("alice", filing, "task_ready")).toMatchObject({ status: "completed", assignee: "eng.writer" });
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.writer"]);
    } finally {
      await host.dispose();
    }
  });

  it("an assign and then a release of a held row: the assigned owner runs it, once (BR-25)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const filed = await act(host, conv, "createTask_tasks", { held: true, goal: "Audit licenses", assignee: "eng.tasker" });
      await act(host, conv, "updateTask_tasks", { id: filed.taskId!, assignee: "eng.writer" });
      await act(host, conv, "updateTask_tasks", { id: filed.taskId!, status: "pending" });
      await host.settled();
      expect(await host.row("alice", filing, filed.taskId!)).toMatchObject({ status: "completed", assignee: "eng.writer" });
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.writer"]);
    } finally {
      await host.dispose();
    }
  });

  it("a cancel of a held row ends it with no run", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const filed = await act(host, conv, "createTask_tasks", { held: true, goal: "Audit licenses", assignee: "eng.tasker" });
      expect(await act(host, conv, "updateTask_tasks", { id: filed.taskId!, status: "cancelled" })).toEqual({ ok: true });
      await host.settled();
      expect(await host.row("alice", filing, filed.taskId!)).toMatchObject({ status: "cancelled", attempts: 0 });
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });
});

describe("starting work on a conversation's board (BR-8 to BR-11, BR-24)", () => {
  it("starts a recorded row on its release, once, with one completed notice", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_recorded", "eng.tasker"));

      expect(await act(host, conv, "updateTask_tasks", { id: "task_recorded", status: "pending" })).toEqual({ ok: true });
      await host.settled();
      const row = await host.row("alice", filing, "task_recorded");
      expect(row).toMatchObject({ status: "completed", assignee: "eng.tasker" });
      expect(row?.undispatched).toBeUndefined();
      expect(host.runs.filter((run) => run.taskId === "task_recorded")).toHaveLength(1);

      // Again: it has finished, so it is refused, and nothing runs.
      const again = await act(host, conv, "updateTask_tasks", { id: "task_recorded", status: "pending" });
      expect(again).toMatchObject({ ok: false });
      await host.settled();
      expect(host.runs.filter((run) => run.taskId === "task_recorded")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("gives a recorded row its owner in the release's own call (BR-9)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_recorded", undefined));
      await act(host, conv, "updateTask_tasks", { id: "task_recorded", assignee: "eng.tasker", status: "pending" });
      await host.settled();
      expect(await host.row("alice", filing, "task_recorded")).toMatchObject({ status: "completed", assignee: "eng.tasker" });
    } finally {
      await host.dispose();
    }
  });

  it("files a new row ready and starts it once (BR-8)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filed = await act(host, conv, "createTask_tasks", { goal: "Draft the release note", assignee: "eng.tasker" });
      expect(filed).toMatchObject({ ok: true, taskId: expect.any(String) });
      await host.settled();
      const filing = await host.filingOf("alice", conv);
      const row = await host.row("alice", filing, filed.taskId!);
      expect(row).toMatchObject({ status: "completed", assignee: "eng.tasker" });
      expect(row?.undispatched).toBeUndefined();
      expect(host.runs.filter((run) => run.taskId === filed.taskId)).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("answers task_not_found for a row on another conversation's board, and leaves it as it was (BR-11)", async () => {
    const host = bootBoardHost();
    try {
      const mine = await host.conversation("alice", "desk");
      const other = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", mine);
      await host.writeRow("alice", filing, recorded("task_recorded", "eng.tasker"));
      const before = await host.row("alice", filing, "task_recorded");

      expect(await act(host, other, "updateTask_tasks", { id: "task_recorded", status: "pending" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^task_not_found/)
      });
      await host.settled();
      expect(await host.row("alice", filing, "task_recorded")).toEqual(before);
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("starts nothing that has no owner to start with: a row filed or released with none waits, unassigned (BR-24)", async () => {
    const host = bootBoardHost();
    try {
      // Two delegates take tasks here, so neither is the default.
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_nobody", undefined));

      const filed = await act(host, conv, "createTask_tasks", { goal: "Do it" });
      expect(filed).toMatchObject({ ok: true });
      expect(await act(host, conv, "updateTask_tasks", { id: "task_nobody", status: "pending" })).toEqual({ ok: true });
      await host.settled();
      for (const id of [filed.taskId!, "task_nobody"]) {
        const row = await host.row("alice", filing, id);
        expect(row?.status).toBe("pending");
        expect(row?.assignee).toBeUndefined();
      }
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("runs the same checks held or ready: an assignee off the team is refused the same way (BR-14)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const viaAdd = await act(host, conv, "createTask_tasks", { held: true, goal: "x", assignee: "nobody.here" });
      const viaReady = await act(host, conv, "createTask_tasks", { goal: "x", assignee: "nobody.here" });
      expect(viaReady).toEqual(viaAdd);
      expect(viaReady.ok).toBe(false);
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("refuses a wait, which is getTask's since FIX-2082, read before the schema would drop it, and files nothing (BR-18, BR-20)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      for (const input of [
        { goal: "x", assignee: "eng.tasker", wait: true },
        { goal: "x", assignee: "eng.tasker", timeoutMs: 60_000 }
      ]) {
        expect(await act(host, conv, "createTask_tasks", input)).toMatchObject({
          ok: false,
          error: expect.stringMatching(/^create_task_does_not_wait: /)
        });
      }
      await host.settled();
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("is a tool on the coordinator's own turn, and a filing from it starts the row", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "d1", toolName: "createTask", args: { goal: "Write the notes", assignee: "eng.tasker" } }] },
        { text: "Handed it over." },
        { text: "It's done." }
      ]
    });
    const host = bootBoardHost({ judgment });
    try {
      const conv = await host.conversation("alice", "lead");
      const turn = await host.act("alice", conv, "respond", { message: "get the notes written" });
      expect(turn.error, messageOf(turn.error)).toBeUndefined();
      await host.settled();
      const rows = await host.rows("alice");
      expect(rows.map((row) => [row.goal, row.assignee, row.status])).toEqual([["Write the notes", "eng.tasker", "completed"]]);
      expect(host.runs).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});

describe("retryTask on a conversation's board (FIX-2383)", () => {
  it("starts a cancelled task again as the same row, with no other touch of the board", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const filed = await act(host, conv, "createTask_tasks", { held: true, goal: "Audit licenses", assignee: "eng.tasker" });
      await act(host, conv, "updateTask_tasks", { id: filed.taskId!, status: "cancelled" });
      await host.settled();
      expect(host.runs).toEqual([]);

      expect(await act(host, conv, "retryTask_tasks", { id: filed.taskId! })).toEqual({ ok: true });
      await host.settled();
      expect(await host.row("alice", filing, filed.taskId!)).toMatchObject({ status: "completed", attempts: 1, assignee: "eng.tasker" });
      expect(host.runs.map((run) => run.taskId)).toEqual([filed.taskId]);
    } finally {
      await host.dispose();
    }
  });

  it("lets the row running in the session recover after its worker died, ahead of a retried row waiting on it", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const base = (id: string, createdAt: number) =>
        ({ ...recorded(id, "eng.tasker", id), undispatched: undefined, session: "ongoing", attempts: 1, startedAt: createdAt, createdAt, updatedAt: createdAt }) as Task;
      // A runs in the delegate's ongoing session; its worker died, so its lease lapsed.
      await host.writeRow("alice", filing, { ...base("task_running", 1000), status: "in_progress", claimedBy: "conversation-tasks", leaseUntil: Date.now() - 1_000 } as Task);
      // B ran once in the same session before, and was cancelled.
      await host.writeRow("alice", filing, { ...base("task_retried", 2000), status: "cancelled", completedAt: 2000 } as Task);

      expect(await act(host, conv, "retryTask_tasks", { id: "task_retried" })).toEqual({ ok: true });
      await host.settled();
      expect(host.runs.map((run) => /task_(running|retried)/.exec(run.message)?.[0])).toEqual(["task_running", "task_retried"]);
      expect(await host.row("alice", filing, "task_running")).toMatchObject({ status: "completed" });
      expect(await host.row("alice", filing, "task_retried")).toMatchObject({ status: "completed", attempts: 2 });
    } finally {
      await host.dispose();
    }
  });

  it("runs two retried tasks of one ongoing session in turn, neither waiting on the other forever", async () => {
    let release!: () => void;
    const busy = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = bootBoardHost({ holds: new Map([["busy", busy]]) });
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      // Two rows that each ran once in the delegate's ongoing session, and were cancelled.
      const ran = (id: string, createdAt: number): Task =>
        ({ ...recorded(id, "eng.tasker", id), undispatched: undefined, session: "ongoing", status: "cancelled", attempts: 1, startedAt: createdAt, completedAt: createdAt, createdAt, updatedAt: createdAt }) as Task;
      await host.writeRow("alice", filing, ran("task_first", 1000));
      await host.writeRow("alice", filing, ran("task_second", 2000));
      // A third row holds the session while both are retried.
      const busyTask = await act(host, conv, "createTask_tasks", { goal: "[hold:busy] task_busy", assignee: "eng.tasker", session: "ongoing" });
      for (let i = 0; i < 200 && (await host.row("alice", filing, busyTask.taskId!))?.status !== "in_progress"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(await host.row("alice", filing, busyTask.taskId!)).toMatchObject({ status: "in_progress" });

      expect(await act(host, conv, "retryTask_tasks", { id: "task_second" })).toEqual({ ok: true });
      expect(await act(host, conv, "retryTask_tasks", { id: "task_first" })).toEqual({ ok: true });
      release();
      await host.settled();
      // Both started rows waited on the one session: the earlier-filed one runs first, then the other.
      expect(host.runs.map((run) => /task_(busy|first|second)/.exec(run.message)?.[0])).toEqual(["task_busy", "task_first", "task_second"]);
      expect(await host.row("alice", filing, "task_first")).toMatchObject({ status: "completed", attempts: 2 });
      expect(await host.row("alice", filing, "task_second")).toMatchObject({ status: "completed", attempts: 2 });
    } finally {
      await host.dispose();
    }
  });
});
