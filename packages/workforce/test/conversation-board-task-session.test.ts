/**
 * A task's own session (FIX-1794 V7, BR-7 as FIX-1802 replaces it, and BR-16
 * to BR-20) and its start
 * (V4, BR-10a).
 *
 * A filing's board hands the task to the delegate's `work` entry in a new
 * session: a child of the conversation, its owner's, born naming the worker,
 * the task and the conversation. An app finds it with
 * `findWorkerSession({ worker, taskId, filingSessionId })`, within the
 * conversation that filed it and nowhere else.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const file = async (host: BoardHost, userId: string, conv: string, input: Record<string, unknown>) => {
  const result = await host.act(userId, conv, "addTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

describe("the session a task runs in (BR-16, BR-19)", () => {
  it("is a new child of the conversation, its owner's, born naming the worker, the task and the conversation", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "Audit licenses", assignee: "eng.tasker" });
      await host.settled();
      const [run] = host.runs;
      expect(run).toBeDefined();
      expect(run!.sessionId).not.toBe(conv);
      const session = await host.session(run!.sessionId);
      expect(session).toMatchObject({ userId: "alice", parentSessionId: conv, flowKind: "tasker" });
      expect(session.state).toMatchObject({ workerId: "eng.tasker", taskId: filed.taskId, filingSessionId: filing });
      // The row names the run working it.
      expect((await host.row("alice", filing, filed.taskId!))?.run?.sessionId).toBe(run!.sessionId);

      const app = host.client("alice");
      const found = await app.findWorkerSession({ worker: "eng.tasker", taskId: filed.taskId!, filingSessionId: filing });
      expect(found?.id).toBe(run!.sessionId);
      // Found again, never made, by ensure.
      expect((await app.ensureWorkerSession({ worker: "eng.tasker", taskId: filed.taskId!, filingSessionId: filing })).id).toBe(
        run!.sessionId
      );
      // Not within another conversation, not by another user, and not by a lookup that names no task.
      expect(await app.findWorkerSession({ worker: "eng.tasker", taskId: filed.taskId!, filingSessionId: "another~conversation" })).toBeUndefined();
      expect(await app.findWorkerSession({ worker: "eng.tasker", filingSessionId: filing })).toBeUndefined();
      expect(await app.findWorkerSession({ worker: "eng.tasker" })).toBeUndefined();
      expect(
        await host.client("bob").findWorkerSession({ worker: "eng.tasker", taskId: filed.taskId!, filingSessionId: filing })
      ).toBeUndefined();
    } finally {
      await host.dispose();
    }
  });

  it("is one per conversation: two conversations filing for one worker get two sessions, each found in its own", async () => {
    const host = bootBoardHost();
    try {
      const one = await host.conversation("alice", "desk");
      const two = await host.conversation("alice", "desk");
      const a = await file(host, "alice", one, { goal: "in one", assignee: "eng.tasker" });
      const b = await file(host, "alice", two, { goal: "in two", assignee: "eng.tasker" });
      await host.settled();
      const app = host.client("alice");
      const inOne = await app.findWorkerSession({ worker: "eng.tasker", taskId: a.taskId!, filingSessionId: await host.filingOf("alice", one) });
      const inTwo = await app.findWorkerSession({ worker: "eng.tasker", taskId: b.taskId!, filingSessionId: await host.filingOf("alice", two) });
      expect(inOne?.id).toBeDefined();
      expect(inTwo?.id).toBeDefined();
      expect(inOne!.id).not.toBe(inTwo!.id);
      expect((await host.session(inOne!.id)).parentSessionId).toBe(one);
      expect((await host.session(inTwo!.id)).parentSessionId).toBe(two);
    } finally {
      await host.dispose();
    }
  });

  it("is one task: two tasks for one worker in one conversation run in two sessions, each naming its own", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const a = await file(host, "alice", conv, { goal: "first", assignee: "eng.tasker" });
      const b = await file(host, "alice", conv, { goal: "second", assignee: "eng.tasker" });
      await host.settled();
      expect(host.runs.map((run) => run.taskId).sort()).toEqual([a.taskId, b.taskId].sort());
      expect(new Set(host.runs.map((run) => run.sessionId)).size).toBe(2);
      for (const run of host.runs) {
        expect((await host.session(run.sessionId)).state).toMatchObject({ taskId: run.taskId });
      }
    } finally {
      await host.dispose();
    }
  });

  it("isn't where a post to the same worker in the same conversation lands: that goes to its delegate session (BR-19)", async () => {
    const agentAnswer = mockGenerator({ script: [{ when: () => true, then: { text: "Otto's answer." } }] });
    const host = bootBoardHost({ agentAnswer });
    try {
      const conv = await host.conversation("alice", "front");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "Look into refunds", assignee: "otto" });
      await host.settled();
      const app = host.client("alice");
      const taskSession = await app.findWorkerSession({ worker: "otto", taskId: filed.taskId!, filingSessionId: filing });
      expect(taskSession).toBeDefined();
      expect((await host.row("alice", filing, filed.taskId!))?.status).toBe("completed");

      const posted = await host.act("alice", conv, "run", { message: "what's our refund policy?" });
      expect(posted.error, messageOf(posted.error)).toBeUndefined();
      await host.settled();
      const delegateSession = await app.findWorkerSession({ worker: "otto", filingSessionId: filing });
      expect(delegateSession).toBeDefined();
      expect(delegateSession!.id).not.toBe(taskSession!.id);
      expect((await host.session(delegateSession!.id)).state).not.toHaveProperty("taskId");
    } finally {
      await host.dispose();
    }
  });

  it("can't be seeded by a caller: a create naming a taskId is refused with a 400, on every worker flow", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const decoys = [
        { flow: "tasker", workerId: "eng.tasker" },
        { flow: "agent", workerId: "otto" },
        { flow: "coordinator", workerId: "lead" }
      ];
      for (const { flow, workerId } of decoys) {
        const created = await host.create("alice", flow, { state: { workerId, taskId: "t-decoy", filingSessionId: filing } });
        expect(created.status, `${flow}: ${JSON.stringify(created.body)}`).toBe(400);
        expect(JSON.stringify(created.body)).toContain("taskId");
      }
      // Nothing was written, so no lookup finds a decoy.
      const app = host.client("alice");
      expect(await app.findWorkerSession({ worker: "eng.tasker", taskId: "t-decoy", filingSessionId: filing })).toBeUndefined();
    } finally {
      await host.dispose();
    }
  });

  it("is never opened by ensureWorkerSession: a task's session comes from its hand-over (BR-20)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const app = host.client("alice");
      await expect(app.ensureWorkerSession({ worker: "eng.tasker", taskId: "never-filed", filingSessionId: filing })).rejects.toThrow(
        /a task's session is opened when the task is handed over/
      );
      const sessions = await (await host.state.getRuntime()).stores.session.list({ flowKind: "tasker" });
      expect(sessions).toEqual([]);
    } finally {
      await host.dispose();
    }
  });
});

describe("attempts and reassigns (BR-17, BR-18)", () => {
  it("re-enters the same session for a task's second attempt", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filed = await file(host, "alice", conv, { goal: "flaky [fail-until:2]", assignee: "eng.tasker" });
      await host.settled();
      expect(host.runs.map((run) => run.attempt)).toEqual([1, 2]);
      expect(new Set(host.runs.map((run) => run.sessionId)).size).toBe(1);
      expect((await host.row("alice", await host.filingOf("alice", conv), filed.taskId!))?.status).toBe("completed");
    } finally {
      await host.dispose();
    }
  });

  it("opens a new session for the worker a task is reassigned to; the first keeps its history", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "decide [park:which one?]", assignee: "eng.tasker" });
      await host.settled();
      expect((await host.row("alice", filing, filed.taskId!))?.status).toBe("parked");
      const first = host.runs[0]!.sessionId;
      // Answered: the attempt ends and the row waits again, as an answer leaves it.
      const parked = (await host.row("alice", filing, filed.taskId!))!;
      const { partition: _p, ...stored } = parked;
      await host.writeRow("alice", filing, { ...(stored as Task), status: "pending", feedback: "the second" });

      const moved = await host.act("alice", conv, "assignTask_tasks", { taskId: filed.taskId, assignee: "eng.writer" });
      expect(moved.output).toEqual({ ok: true });
      await host.settled();
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.tasker", "eng.writer"]);
      const second = host.runs[1]!.sessionId;
      expect(second).not.toBe(first);
      expect((await host.session(second)).state).toMatchObject({ workerId: "eng.writer", taskId: filed.taskId });
      expect((await host.requestsOf(first)).length).toBeGreaterThan(0);
    } finally {
      await host.dispose();
    }
  });
});

describe("a task session files its pieces (BR-7, as FIX-1802 S6 replaces it)", () => {
  it("gets the task tools on its turn, and its action files on its own board", async () => {
    // `boss` hands a task to `lead`, a coordinator: the task runs lead's own
    // turn, in a session of its own on the coordinator flow. lead's delegate
    // takes tasks, so its task session files: FIX-1802's delegate rule, with
    // the split.
    const judgment = mockGenerator({ script: [{ text: "I'll do it myself." }, { text: "Noted." }] });
    const taskTurnTools: string[][] = [];
    const host = bootBoardHost({
      judgment,
      observeTools: (block, names, input) => {
        const text = JSON.stringify(input);
        // lead's task turn; boss's own turn on the notice of its ending carries the tools.
        if (block === "coordinator-judgment" && text.includes("Ship the release") && !text.includes("completed by")) taskTurnTools.push(names);
      }
    });
    try {
      const conv = await host.conversation("alice", "boss");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "Ship the release", assignee: "lead" });
      await host.settled();
      const app = host.client("alice");
      const taskSession = await app.findWorkerSession({ worker: "lead", taskId: filed.taskId!, filingSessionId: filing });
      expect(taskSession).toBeDefined();
      // lead's turn in the task session was handed the task tools.
      expect(taskTurnTools.length).toBeGreaterThan(0);
      for (const names of taskTurnTools) {
        expect(names.filter((name) => ["addTask", "assignTask", "listTasks", "cancelTask"].includes(name)).sort()).toEqual([
          "addTask",
          "assignTask",
          "cancelTask",
          "listTasks"
        ]);
      }
      const byAction = await host.act("alice", taskSession!.id, "addTask_tasks", { goal: "another piece", assignee: "eng.tasker" });
      expect(byAction.output).toMatchObject({ ok: true });
      await host.settled();
      // The piece is on the task session's own board, not the conversation's.
      const rows = await host.rows("alice");
      const top = rows.find((row) => row.goal === "Ship the release")!;
      const piece = rows.find((row) => row.goal === "another piece")!;
      expect(top.status).toBe("completed");
      expect(piece.partition).not.toBe(top.partition);
    } finally {
      await host.dispose();
    }
  });
});

describe("a filing's start, when its wake is lost (BR-10a)", () => {
  it("leaves the row pending and assigned, which is its start's debt, written by the add; the next touch starts it, once", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      // A row started as usual, for the revision one bare add leaves.
      const bare = await file(host, "alice", conv, { goal: "first, started as usual" });
      await host.settled();
      const lost = await host.loseDispatches("runTaskBoard");
      const filed = await file(host, "alice", conv, { goal: "Audit licenses", assignee: "eng.tasker" });
      expect(filed.ok).toBe(true);
      expect(lost.lost()).toBe(1);
      await host.settled();
      const owed = await host.row("alice", filing, filed.taskId!);
      // The debt is the row itself, pending and assigned: the add wrote it,
      // once, at an add's own revision, so no crash could come between the
      // row and its debt.
      expect(owed).toMatchObject({ status: "pending", assignee: "eng.tasker" });
      expect(owed!.revision).toBe(1);
      expect(host.runs.map((run) => run.taskId)).toEqual([bare.taskId]);

      lost.restore();
      const listed = await host.act("alice", conv, "listTasks_tasks", {});
      expect(listed.error).toBeUndefined();
      await host.settled();
      expect(host.runs.map((run) => run.taskId)).toEqual([bare.taskId, filed.taskId]);
      const started = await host.row("alice", filing, filed.taskId!);
      expect(started?.status).toBe("completed");
      // Touched again, it starts nothing twice.
      await host.act("alice", conv, "listTasks_tasks", {});
      await host.settled();
      expect(host.runs).toHaveLength(2);
    } finally {
      await host.dispose();
    }
  });

  /**
   * A row pending for a delegate, with nothing else on it: what a crash leaves
   * after a retried notice was acted on and before the board run it asked for
   * started, or after an assign committed and before its wake.
   */
  const strandedRow = async (host: BoardHost, conv: string, goal: string, patch: Partial<Task>) => {
    const filing = await host.filingOf("alice", conv);
    const lost = await host.loseDispatches("runTaskBoard");
    const filed = await file(host, "alice", conv, { goal, assignee: "eng.tasker" });
    lost.restore();
    await host.settled();
    const { partition: _p, ...stored } = (await host.row("alice", filing, filed.taskId!))!;
    await host.writeRow("alice", filing, { ...(stored as Task), ...patch, status: "pending", metadata: {} });
    expect(host.runs).toEqual([]);
    return { filing, taskId: filed.taskId! };
  };

  it("starts a retry whose run never started on the next touch: the pending row is the debt (Codex P1)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      // Attempt 1 failed with one left; its notice was acted on and the
      // conversation crashed before the board run it asked for.
      const { filing, taskId } = await strandedRow(host, conv, "flaky [fail-until:2]", { attempts: 1, maxAttempts: 2 });
      await host.act("alice", conv, "listTasks_tasks", {});
      await host.settled();
      expect(host.runs.map((run) => run.attempt)).toEqual([2]);
      expect((await host.row("alice", filing, taskId))?.status).toBe("completed");
      await host.act("alice", conv, "listTasks_tasks", {});
      await host.settled();
      expect(host.runs).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("starts a reassigned row whose wake was lost when the assign is retried, once (Codex P2)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      // The assign to eng.writer committed; the crash came before its wake.
      const { filing, taskId } = await strandedRow(host, conv, "rewrite it", { assignee: "eng.writer" });
      const again = await host.act("alice", conv, "assignTask_tasks", { taskId, assignee: "eng.writer" });
      expect(again.output).toEqual({ ok: true });
      await host.settled();
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.writer"]);
      expect((await host.row("alice", filing, taskId))?.status).toBe("completed");
    } finally {
      await host.dispose();
    }
  });

  it("is started by the next filing of another task, once", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const lost = await host.loseDispatches("runTaskBoard");
      const stranded = await file(host, "alice", conv, { goal: "stranded", assignee: "eng.tasker" });
      expect(lost.lost()).toBe(1);
      await host.settled();
      expect(host.runs).toEqual([]);

      lost.restore();
      const next = await file(host, "alice", conv, { goal: "next", assignee: "eng.tasker" });
      await host.settled();
      expect(host.runs.map((run) => run.taskId).sort()).toEqual([stranded.taskId, next.taskId].sort());
      for (const id of [stranded.taskId!, next.taskId!]) {
        const row = await host.row("alice", filing, id);
        expect(row?.status).toBe("completed");
      }
    } finally {
      await host.dispose();
    }
  });
});
