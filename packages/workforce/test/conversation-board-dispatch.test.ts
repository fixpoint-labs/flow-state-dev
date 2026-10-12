/**
 * Dispatching work on a conversation's board (FIX-1875 V2, V4).
 *
 * A row recorded but not dispatched (`undispatched`) is never started by any
 * of the board's start paths: the claim, the drain's exit, a filing's wake,
 * an assign's wake, a touch's wake. `dispatchTask` is the one way to start
 * one, and to file a new row ready. Rows are seeded in the stored shape, as a
 * recording `addTask` will write them, and every leg reads the store, never
 * the action's own say-so.
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
      const other = await act(host, conv, "addTask_tasks", { goal: "Write the notes", assignee: "eng.tasker" });
      expect(other.ok).toBe(true);
      await host.settled();
      // An assign that names the row's new owner: it moves, and stays recorded.
      expect(await act(host, conv, "assignTask_tasks", { taskId: "task_recorded", assignee: "eng.writer" })).toEqual({
        ok: true
      });
      await host.settled();
      for (let i = 0; i < 5; i += 1) await act(host, conv, "listTasks_tasks", {});
      await host.settled();

      const row = await host.row("alice", filing, "task_recorded");
      expect(row).toMatchObject({ status: "pending", attempts: 0, undispatched: true, assignee: "eng.writer" });
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

describe("dispatchTask on a conversation's board (BR-8 to BR-13, BR-24)", () => {
  it("starts a recorded row by its id, once, with one completed notice", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_recorded", "eng.tasker"));

      expect(await act(host, conv, "dispatchTask_tasks", { taskId: "task_recorded" })).toEqual({
        ok: true,
        taskId: "task_recorded"
      });
      await host.settled();
      const row = await host.row("alice", filing, "task_recorded");
      expect(row).toMatchObject({ status: "completed", assignee: "eng.tasker" });
      expect(row?.undispatched).toBeUndefined();
      expect(host.runs.filter((run) => run.taskId === "task_recorded")).toHaveLength(1);

      // Again: it is no longer recorded, so it is refused, naming why, and nothing runs.
      const again = await act(host, conv, "dispatchTask_tasks", { taskId: "task_recorded" });
      expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/^task_not_dispatchable: .*completed/) });
      await host.settled();
      expect(host.runs.filter((run) => run.taskId === "task_recorded")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("gives a recorded row its owner in the same write, when the call names one (BR-9)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_recorded", undefined));
      await act(host, conv, "dispatchTask_tasks", { taskId: "task_recorded", assignee: "eng.tasker" });
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
      const filed = await act(host, conv, "dispatchTask_tasks", { goal: "Draft the release note", assignee: "eng.tasker" });
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

      expect(await act(host, other, "dispatchTask_tasks", { taskId: "task_recorded" })).toMatchObject({
        ok: false,
        error: "task_not_found"
      });
      await host.settled();
      expect(await host.row("alice", filing, "task_recorded")).toEqual(before);
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("refuses, writing nothing, when there is no owner to start it with (BR-24)", async () => {
    const host = bootBoardHost();
    try {
      // Two delegates take tasks here, so neither is the default.
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_nobody", undefined));

      expect(await act(host, conv, "dispatchTask_tasks", { goal: "Do it" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^assignee_required: /)
      });
      expect(await act(host, conv, "dispatchTask_tasks", { taskId: "task_nobody" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^assignee_required: /)
      });
      await host.settled();
      expect((await host.rows("alice")).map((row) => row.id)).toEqual(["task_nobody"]);
      expect(await host.row("alice", filing, "task_nobody")).toMatchObject({ undispatched: true });
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("refuses none, or more than one, of goal and taskId, and new-row fields beside taskId, before writing (BR-12, BR-13)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      await host.writeRow("alice", filing, recorded("task_recorded", "eng.tasker"));
      const refusals: Array<[Record<string, unknown>, RegExp]> = [
        [{}, /^dispatch_target_required: /],
        [{ goal: "x", taskId: "task_recorded" }, /^dispatch_target_ambiguous: /],
        [{ taskId: "task_recorded", deps: ["a"] }, /^dispatch_ref_takes_no_task_fields: .*deps/],
        [{ taskId: "task_recorded", input: { a: 1 } }, /^dispatch_ref_takes_no_task_fields: .*input/],
        [{ taskId: "task_recorded", followUpOf: "t" }, /^dispatch_ref_takes_no_task_fields: .*followUpOf/],
        [{ post: true }, /^post_unavailable: /]
      ];
      for (const [input, error] of refusals) {
        expect(await act(host, conv, "dispatchTask_tasks", input), JSON.stringify(input)).toMatchObject({
          ok: false,
          error: expect.stringMatching(error)
        });
      }
      await host.settled();
      expect(await host.row("alice", filing, "task_recorded")).toMatchObject({ undispatched: true, status: "pending" });
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("runs addTask's own checks, with addTask's answers: an assignee off the team is refused the same way (BR-14)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const viaAdd = await act(host, conv, "addTask_tasks", { goal: "x", assignee: "nobody.here" });
      const viaDispatch = await act(host, conv, "dispatchTask_tasks", { goal: "x", assignee: "nobody.here" });
      expect(viaDispatch).toEqual(viaAdd);
      expect(viaDispatch.ok).toBe(false);
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("refuses a wait the action can't hold, read before the schema would drop it, and files nothing (BR-18, BR-20)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      for (const input of [
        { goal: "x", assignee: "eng.tasker", wait: true },
        { goal: "x", assignee: "eng.tasker", timeoutMs: 60_000 }
      ]) {
        expect(await act(host, conv, "dispatchTask_tasks", input)).toMatchObject({
          ok: false,
          error: expect.stringMatching(/^wait_unavailable: /)
        });
      }
      await host.settled();
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("is a tool on the coordinator's own turn, and a dispatch from it starts the row", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "d1", toolName: "dispatchTask", args: { goal: "Write the notes", assignee: "eng.tasker" } }] },
        { text: "Handed it over." },
        { text: "It's done." }
      ]
    });
    const host = bootBoardHost({ judgment });
    try {
      const conv = await host.conversation("alice", "lead");
      const turn = await host.act("alice", conv, "run", { message: "get the notes written" });
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
