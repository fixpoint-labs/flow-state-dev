/**
 * Filing a task for a delegate, and the check every filing runs (FIX-1794 V3,
 * BR-1 to BR-9 and the task tools' own reassign and cancel contract).
 *
 * Each leg files through the coordinator flow's public actions
 * (`addTask_tasks` and the rest), as an app does; the tool legs file through
 * the coordinator's own turn, scripted. Both reach the same resolver and the
 * same roster, so an answer is the same either way. What a leg asserts is
 * read back from the store, never from the action's own say-so.
 */
import { describe, expect, it } from "vitest";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { mockGenerator } from "@flow-state-dev/testing";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const file = async (host: BoardHost, userId: string, conv: string, input: Record<string, unknown>) => {
  const result = await host.act(userId, conv, "addTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

const list = async (host: BoardHost, userId: string, conv: string) => {
  const result = await host.act(userId, conv, "listTasks_tasks", {});
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return (result.output as { tasks: Array<{ id: string; status: string; assignee?: string; goal: string }> }).tasks;
};

describe("filing a task for one of this conversation's delegates (BR-1, BR-10)", () => {
  it("stores it on this conversation's board, at its owner's scope, and starts it with no drain from anyone", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filed = await file(host, "alice", conv, { goal: "Audit licenses [slow:150]", assignee: "eng.tasker" });
      expect(filed).toMatchObject({ ok: true, taskId: expect.any(String) });
      // The filing returned before the run finished: the row isn't settled yet.
      const filing = await host.filingOf("alice", conv);
      expect((await host.row("alice", filing, filed.taskId!))?.status).not.toBe("completed");

      await host.settled();
      const row = await host.row("alice", filing, filed.taskId!);
      expect(row).toMatchObject({ status: "completed", assignee: "eng.tasker", createdBy: "alice" });
      // Started by the board's own run, in the conversation, as alice.
      expect(host.runs).toHaveLength(1);
      expect(host.runs[0]).toMatchObject({ worker: "eng.tasker", userId: "alice", taskId: filed.taskId });
      const actions = (await host.requestsOf(conv)).map((request) => request.actionName);
      expect(actions).toContain("runTaskBoard");
    } finally {
      await host.dispose();
    }
  });

  it("files through the coordinator's own tool with the same check, and the same answers", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "a1", toolName: "addTask", args: { goal: "Write the notes", assignee: "eng.tasker" } },
            { toolCallId: "a2", toolName: "addTask", args: { goal: "Write more", assignee: "bobs.worker" } }
          ]
        },
        { text: "Filed it." },
        // The notice's turn.
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
      // The tool's answer, as the model read it back.
      const answers = JSON.stringify(judgment.calls[1]!.input).replaceAll("\\", "");
      expect(answers).toContain('unknown_assignee: "bobs.worker" is not on this board');
    } finally {
      await host.dispose();
    }
  });
});

describe("an assignee this conversation can't hand a task to", () => {
  it("is refused with one answer, naming the worker, whether it's off the list, Bob's, or nobody's; nothing stored (BR-2)", async () => {
    const host = bootBoardHost();
    try {
      expect((await host.hire("bob", { id: "bob.helper", flow: "tasker", instructions: "Bob's." })).error).toBeUndefined();
      const conv = await host.conversation("alice", "desk");
      for (const name of ["eng.writer", "bob.helper", "nobody.here"]) {
        const refused = await file(host, "alice", conv, { goal: "do it", assignee: name });
        expect(refused.ok).toBe(false);
        expect(refused.error).toMatch(new RegExp(`^unknown_assignee: "${name.replace(".", "\\.")}" is not on this board's team`));
      }
      expect(await host.rows("alice")).toEqual([]);
      expect(await host.rows("bob")).toEqual([]);
      expect(host.runs).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("is refused, naming why, when it's on the list but can't take a task now: fired, or on a flow that takes none (BR-3)", async () => {
    const host = bootBoardHost();
    try {
      expect((await host.hire("alice", { id: "my.tasker", flow: "tasker", instructions: "Mine." })).error).toBeUndefined();
      const conv = await host.conversation("alice", "mixed");
      expect((await host.act("alice", conv, "addDelegate", { worker: "my.tasker" })).error).toBeUndefined();
      expect((await host.fire("alice", "my.tasker")).error).toBeUndefined();

      const fired = await file(host, "alice", conv, { goal: "do it", assignee: "my.tasker" });
      expect(fired).toMatchObject({ ok: false, error: expect.stringContaining('my.tasker: No worker "my.tasker" on your roster') });
      const postsOnly = await file(host, "alice", conv, { goal: "do it", assignee: "eng.helper" });
      expect(postsOnly).toMatchObject({ ok: false, error: expect.stringContaining("which takes no task") });
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("is refused at hand-over when the delegate was fired after the filing, and the conversation hears it failed (BR-3)", async () => {
    const host = bootBoardHost();
    try {
      expect((await host.hire("alice", { id: "my.tasker", flow: "tasker", instructions: "Mine." })).error).toBeUndefined();
      const conv = await host.conversation("alice", "desk");
      expect((await host.act("alice", conv, "addDelegate", { worker: "my.tasker" })).error).toBeUndefined();
      // The second task waits on the first, so its hand-over comes after the fire.
      const first = await file(host, "alice", conv, { goal: "first [slow:100]", assignee: "eng.tasker" });
      const second = await file(host, "alice", conv, { goal: "second", assignee: "my.tasker", deps: [first.taskId] });
      expect(second.ok).toBe(true);
      expect((await host.fire("alice", "my.tasker")).error).toBeUndefined();
      await host.settled();
      // The next touch of the board starts what's owed: the hand-over refuses it.
      await list(host, "alice", conv);
      await host.settled();
      const filing = await host.filingOf("alice", conv);
      expect(await host.row("alice", filing, second.taskId!)).toMatchObject({
        status: "errored",
        error: expect.stringContaining('wasn\'t handed to "my.tasker"')
      });
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.tasker"]);
      const lines = (await host.messages(conv)).map((message) => message.text);
      expect(lines.filter((line) => line.includes("second") && line.includes("failed for good"))).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("is refused, saying a workstream takes posts, not tasks, when its record carries a target (BR-4)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      // A record with a target, as FIX-1793's workstreams will write it: no
      // action writes one yet, so the test writes the conversation's state.
      // Beside it a delegate that takes a task, so the conversation files
      // (FIX-1802 D1) and the roster is what refuses.
      const stored = await host.session(conv);
      const store = (await host.state.getRuntime()).stores.session;
      await store.set(
        conv,
        {
          ...stored,
          state: { ...stored.state, delegates: [{ worker: "eng.tasker", target: "ws-billing" }, { worker: "eng.writer" }] },
          version: stored.version + 1,
          updatedAt: Date.now()
        } as never,
        "any"
      );
      const refused = await file(host, "alice", conv, { goal: "do it", assignee: "eng.tasker" });
      expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("a workstream takes posts, not tasks") });
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("is accepted on the next call once it's added mid-conversation (T1)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      expect((await file(host, "alice", conv, { goal: "x", assignee: "eng.writer" })).ok).toBe(false);
      expect((await host.act("alice", conv, "addDelegate", { worker: "eng.writer" })).error).toBeUndefined();
      expect((await file(host, "alice", conv, { goal: "x", assignee: "eng.writer" })).ok).toBe(true);
      await host.settled();
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.writer"]);
    } finally {
      await host.dispose();
    }
  });
});

describe("a task filed with no assignee", () => {
  it("goes to the conversation's only delegate (BR-5)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filed = await file(host, "alice", conv, { goal: "anything" });
      await host.settled();
      expect(await host.row("alice", await host.filingOf("alice", conv), filed.taskId!)).toMatchObject({
        assignee: "eng.tasker",
        status: "completed"
      });
    } finally {
      await host.dispose();
    }
  });

  it("waits, pending and unassigned, with several delegates, until assignTask hands it out (BR-6)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filed = await file(host, "alice", conv, { goal: "pick someone" });
      expect(filed).toEqual({ ok: true, taskId: expect.any(String) });
      await host.settled();
      expect(await list(host, "alice", conv)).toEqual([
        expect.objectContaining({ id: filed.taskId, status: "pending", goal: "pick someone" })
      ]);
      expect((await list(host, "alice", conv))[0]!.assignee).toBeUndefined();
      expect(host.runs).toEqual([]);

      expect((await host.act("alice", conv, "assignTask_tasks", { taskId: filed.taskId, assignee: "eng.writer" })).output).toEqual({
        ok: true
      });
      await host.settled();
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.writer"]);
    } finally {
      await host.dispose();
    }
  });
});

describe("what a filing can't name (BR-8)", () => {
  it("ignores a board, a partition or an owner on the input, and can't forge or clear a marker", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filed = await file(host, "alice", conv, {
        goal: "mine",
        board: "elsewhere",
        partition: "someone-else",
        owner: "bob",
        metadata: { "noticeOwed:1:completed": { attempt: 1, ending: "completed" }, note: "kept" }
      });
      expect(filed.ok).toBe(true);
      const rows = await host.rows("alice");
      expect(rows).toHaveLength(1);
      const filing = await host.filingOf("alice", conv);
      const row = await host.row("alice", filing, filed.taskId!);
      expect(row?.metadata).toEqual({ note: "kept" });
      // No start was owed, so nothing ran: the row has no assignee.
      await host.settled();
      expect(host.runs).toEqual([]);
      // An update can't reach a marker either.
      await host.act("alice", conv, "updateTask_tasks", {
        taskId: filed.taskId,
        patch: { metadata: { "noticeOwed:1:errored": { attempt: 1, ending: "errored" }, extra: 1 } }
      });
      expect((await host.row("alice", filing, filed.taskId!))?.metadata).toEqual({ note: "kept", extra: 1 });
    } finally {
      await host.dispose();
    }
  });
});

describe("reassign and cancel: the task tools' own contract on this board", () => {
  it("declines a reassign of a running task, lands a cancel of one, and declines its worker's late result (no notice)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filed = await file(host, "alice", conv, { goal: "long one [slow:300]", assignee: "eng.tasker" });
      const filing = await host.filingOf("alice", conv);
      // Wait for the run to hold it.
      for (let i = 0; i < 100 && host.runs.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      const moved = await host.act("alice", conv, "assignTask_tasks", { taskId: filed.taskId, assignee: "eng.writer" });
      expect(moved.output).toMatchObject({ ok: false, error: expect.stringContaining("immutable-assignee") });
      expect((await host.act("alice", conv, "cancelTask_tasks", { taskId: filed.taskId })).output).toEqual({ ok: true });
      await host.settled();
      const row = await host.row("alice", filing, filed.taskId!);
      expect(row).toMatchObject({ status: "cancelled", assignee: "eng.tasker" });
      expect(row?.output).toBeUndefined();
      // A cancel owes no notice (BR-29).
      expect((await host.messages(conv)).filter((m) => m.text.includes("long one"))).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("answers writes to a finished task with the tools' codes, and a failed task is filed again with addTask (leg e)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filed = await file(host, "alice", conv, { goal: "doomed [fail]", assignee: "eng.tasker" });
      await host.settled();
      const filing = await host.filingOf("alice", conv);
      expect((await host.row("alice", filing, filed.taskId!))?.status).toBe("errored");
      const write = async (action: string, input: Record<string, unknown>) => {
        const result = await host.act("alice", conv, `${action}_tasks`, { taskId: filed.taskId, ...input });
        expect(result.error, messageOf(result.error)).toBeUndefined();
        return JSON.stringify(result.output);
      };
      expect(await write("assignTask", { assignee: "eng.tasker" })).toMatch(/"error":"terminal_task_write_declined/);
      expect(await write("cancelTask", {})).toMatch(/"error":"terminal_task_write_declined/);
      expect(await write("completeTask", { output: 1 })).toMatch(/"error":"illegal_status_transition/);
      expect(await write("blockTask", {})).toMatch(/"error":"illegal_status_transition/);

      const again = await file(host, "alice", conv, { goal: "doomed, again", assignee: "eng.tasker" });
      await host.settled();
      expect((await host.row("alice", filing, again.taskId!))?.status).toBe("completed");
      // A completed task refuses a failure the same way.
      const failed = await host.act("alice", conv, "failTask_tasks", { taskId: again.taskId, error: "x" });
      expect(JSON.stringify(failed.output)).toMatch(/"error":"illegal_status_transition/);
    } finally {
      await host.dispose();
    }
  });
});

describe("each conversation's board is its own", () => {
  it("lists only its own tasks, in two conversations of one user and in another user's (BR-11, BR-13)", async () => {
    const host = bootBoardHost();
    try {
      const one = await host.conversation("alice", "pm");
      const two = await host.conversation("alice", "pm");
      const bobs = await host.conversation("bob", "pm");
      const a = await file(host, "alice", one, { goal: "in one" });
      const b = await file(host, "alice", two, { goal: "in two" });
      await file(host, "bob", bobs, { goal: "bob's" });
      expect((await list(host, "alice", one)).map((task) => task.id)).toEqual([a.taskId]);
      expect((await list(host, "alice", two)).map((task) => task.id)).toEqual([b.taskId]);
      expect((await list(host, "bob", bobs)).map((task) => task.goal)).toEqual(["bob's"]);
      // Bob can't act on Alice's conversation at all (BR-12).
      await expect(host.act("bob", one, "listTasks_tasks", {})).rejects.toThrow(/belongs to another user/);
      await expect(host.act("bob", one, "addTask_tasks", { goal: "sneak in" })).rejects.toThrow(/belongs to another user/);
      expect((await list(host, "alice", one)).map((task) => task.id)).toEqual([a.taskId]);
    } finally {
      await host.dispose();
    }
  });

  it("loads only its own rows: no request of a conversation reads another's from the store (BP-033)", async () => {
    const host = bootBoardHost();
    try {
      const one = await host.conversation("alice", "desk");
      const two = await host.conversation("alice", "desk");
      await file(host, "alice", one, { goal: "in one", assignee: "eng.tasker" });
      await host.settled();
      await list(host, "alice", two);
      expect((await host.act("alice", two, "run", { message: "anything new?" })).error).toBeUndefined();
      await host.settled();
      const own = `tasks/${encodeUserSegment(await host.filingOf("alice", two))}/`;
      const loads = (await host.requestsOf(two))
        .flatMap((request) => (request as unknown as { items?: Array<{ resourceLoads?: unknown[] }> }).items ?? [])
        .flatMap((item) => (item.resourceLoads ?? []) as Array<{ storageKey: string }>)
        .filter((load) => load.storageKey.startsWith("tasks"));
      expect(loads.length).toBeGreaterThan(0);
      expect(loads.filter((load) => load.storageKey !== own)).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("starts empty for a conversation deleted and created again under the same id (BR-14)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm", "talk-1");
      await file(host, "alice", conv, { goal: "before" });
      await (await host.state.getRuntime()).stores.session.delete(conv);
      expect(await host.conversation("alice", "pm", "talk-1")).toBe(conv);
      expect(await list(host, "alice", conv)).toEqual([]);
      // The old row stays in the store, unread.
      expect((await host.rows("alice")).map((row) => row.goal)).toEqual(["before"]);
    } finally {
      await host.dispose();
    }
  });
});
