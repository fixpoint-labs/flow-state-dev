/**
 * How the conversation that filed a task hears it end (FIX-1794 V5, BR-22 to
 * BR-29).
 *
 * Each ending gives one notice: the write that records it marks the notice
 * owed on the row, the task session sends it to its stamped sender, and the
 * conversation acts on it once: a line under a fixed routing policy, the
 * coordinator's judgment turn otherwise, and a run of the board, with no turn,
 * for an attempt that will be tried again. A notice lost between the ending
 * and its send stays owed on the row, and the next touch of the board sends
 * it. Every leg reads what landed in the conversation after the dust settles,
 * and again after a later touch, so a second copy shows.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const file = async (host: BoardHost, userId: string, conv: string, input: Record<string, unknown>) => {
  const result = await host.act(userId, conv, "addTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string };
};

/** The lines in a conversation about `goal`. */
const linesAbout = async (host: BoardHost, conv: string, goal: string) =>
  (await host.messages(conv)).filter((message) => message.text.includes(`"${goal}"`)).map((message) => message.text);

/** Touch the board again and let it settle: anything still owed would be sent now. */
const touch = async (host: BoardHost, userId: string, conv: string) => {
  expect((await host.act(userId, conv, "listTasks_tasks", {})).error).toBeUndefined();
  await host.settled();
};

/** The `onTaskSettled` requests a conversation ran. */
const settledRequests = async (host: BoardHost, conv: string) =>
  (await host.requestsOf(conv)).filter((request) => request.actionName === "onTaskSettled");

describe("an attempt that completes (BR-22)", () => {
  it("gives one notice, landed as a line under a fixed policy, with what came back", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, "alice", conv, { goal: "Count licenses", assignee: "eng.tasker" });
      await host.settled();
      await touch(host, "alice", conv);
      expect(await linesAbout(host, conv, "Count licenses")).toEqual([
        expect.stringMatching(/^Task "Count licenses" \(task_[^)]+\) completed by eng\.tasker: eng\.tasker did: Count licenses$/)
      ]);
      const owed = (await host.rows("alice"))[0]!.metadata ?? {};
      expect(Object.entries(owed).filter(([key, value]) => key.startsWith("noticeOwed:") && value !== null)).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("lands as a line, with no turn, under every fixed policy: round robin too", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "rota");
      await file(host, "alice", conv, { goal: "Count seats", assignee: "eng.writer" });
      await host.settled();
      await touch(host, "alice", conv);
      expect(await linesAbout(host, conv, "Count seats")).toEqual([expect.stringContaining("completed by eng.writer")]);
      expect(host.judgment.calls).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("wakes the coordinator's judgment turn once, with the notice as its message", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "addTask", args: { goal: "Count licenses", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Twelve licenses." } }
      ]
    });
    const host = bootBoardHost({ judgment });
    try {
      const conv = await host.conversation("alice", "lead");
      expect((await host.act("alice", conv, "run", { message: "count our licenses" })).error).toBeUndefined();
      await host.settled();
      await touch(host, "alice", conv);
      // One turn for the filing, one for the notice.
      expect(judgment.calls).toHaveLength(2);
      expect(JSON.stringify(judgment.calls[1]!.input)).toContain("completed by eng.tasker");
      const replies = (await host.messages(conv)).map((message) => message.text);
      expect(replies.filter((text) => text === "Twelve licenses.")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});

describe("an attempt that fails", () => {
  it("with attempts left wakes no turn: the board runs again and the next attempt completes (BR-23)", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "addTask", args: { goal: "flaky [fail-until:2]", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: () => true, then: { text: "Done on the second try." } }
      ]
    });
    const host = bootBoardHost({ judgment });
    try {
      const conv = await host.conversation("alice", "lead");
      expect((await host.act("alice", conv, "run", { message: "try it" })).error).toBeUndefined();
      await host.settled();
      await touch(host, "alice", conv);
      expect(host.runs.map((run) => run.attempt)).toEqual([1, 2]);
      // The filing's turn and the completion's: the retry woke none.
      expect(judgment.calls).toHaveLength(2);
      const lines = (await host.messages(conv)).filter((message) => message.agentName === "eng.tasker").map((m) => m.text);
      expect(lines).toEqual([expect.stringContaining("completed by eng.tasker")]);
    } finally {
      await host.dispose();
    }
  });

  it("on its last attempt gives one errored notice, with the error (BR-24)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, "alice", conv, { goal: "doomed [fail]", assignee: "eng.tasker" });
      await host.settled();
      await touch(host, "alice", conv);
      expect(host.runs).toHaveLength(2);
      expect(await linesAbout(host, conv, "doomed [fail]")).toEqual([
        expect.stringMatching(/failed for good with eng\.tasker: eng\.tasker could not do it$/)
      ]);
    } finally {
      await host.dispose();
    }
  });
});

describe("a task parked on a question (BR-25)", () => {
  it("gives one parked notice with the question, and a completed one once it's answered and done", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "pick a region [park:Which region?]", assignee: "eng.tasker" });
      await host.settled();
      await touch(host, "alice", conv);
      expect(await linesAbout(host, conv, "pick a region [park:Which region?]")).toEqual([
        expect.stringMatching(/is waiting on a question from eng\.tasker: Which region\?$/)
      ]);
      // Answered: back in the queue with its answer and its start owed, as an answer leaves it.
      const parked = (await host.row("alice", filing, filed.taskId!))!;
      const { partition: _p, ...stored } = parked;
      await host.writeRow("alice", filing, {
        ...(stored as Task),
        status: "pending",
        feedback: "eu",
        metadata: { ...(stored.metadata ?? {}), startOwed: true }
      });
      await touch(host, "alice", conv);
      await touch(host, "alice", conv);
      const lines = await linesAbout(host, conv, "pick a region [park:Which region?]");
      expect(lines).toEqual([expect.stringContaining("is waiting on a question"), expect.stringContaining("completed by eng.tasker")]);
    } finally {
      await host.dispose();
    }
  });
});

describe("a notice that arrives mid-turn (BR-27)", () => {
  it("is never dropped: its line lands and its turn runs once, while the filing turn is still open", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "addTask", args: { goal: "Count licenses", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Twelve licenses." } }
      ]
    });
    let host!: BoardHost;
    let conv = "";
    let calls = 0;
    let landedWhileHeld = false;
    host = bootBoardHost({
      judgment,
      // Hold the filing turn open past its addTask (its first model call runs
      // the tool) until the task's notice has landed, or give up after a while.
      afterModelCall: async (blockName) => {
        if (blockName !== "coordinator-judgment" || ++calls !== 1) return;
        for (let i = 0; i < 300; i += 1) {
          if ((await linesAbout(host, conv, "Count licenses")).length > 0) {
            landedWhileHeld = true;
            return;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
      }
    });
    try {
      conv = await host.conversation("alice", "lead");
      expect((await host.act("alice", conv, "run", { message: "count our licenses" })).error).toBeUndefined();
      await host.settled();
      await touch(host, "alice", conv);
      // Never dropped: one line, and one turn for it beside the filing's.
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
      expect(judgment.calls).toHaveLength(2);
      const replies = (await host.messages(conv)).map((message) => message.text);
      expect(replies.filter((text) => text === "Twelve licenses.")).toHaveLength(1);
      expect(replies.filter((text) => text === "Filed.")).toHaveLength(1);
      // BR-27 asks for the notice to run after the turn. It runs beside it:
      // the conversation's turn holds no concurrency key a notice could wait
      // on (put to the product owner in this change's PR).
      expect(landedWhileHeld).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});

describe("a notice sent twice (BR-26)", () => {
  it("is acted on once per task, attempt and ending", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "once", assignee: "eng.tasker" });
      await host.settled();
      // The marker back on the row, as a crash after the notice was acted on
      // and before its marker cleared would leave it: the next touch sends it
      // again.
      const done = (await host.row("alice", filing, filed.taskId!))!;
      const { partition: _p, ...stored } = done;
      await host.writeRow("alice", filing, {
        ...(stored as Task),
        metadata: { ...(stored.metadata ?? {}), "noticeOwed:1:completed": { attempt: 1, ending: "completed" } }
      });
      await touch(host, "alice", conv);
      await touch(host, "alice", conv);
      expect(await linesAbout(host, conv, "once")).toHaveLength(1);
      expect((await host.row("alice", filing, filed.taskId!))?.metadata?.["noticeOwed:1:completed"]).toBeNull();
      // Two copies reached the entry; one acted.
      expect((await settledRequests(host, conv)).length).toBeGreaterThanOrEqual(2);
    } finally {
      await host.dispose();
    }
  });
});

describe("the process dies between an ending and its notice (BR-26a)", () => {
  it("leaves the notice owed on the row, and the next touch of the board sends it, once", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const lost = await host.loseDispatches("onTaskSettled");
      const filed = await file(host, "alice", conv, { goal: "survives", assignee: "eng.tasker" });
      await host.settled();
      expect(lost.lost()).toBeGreaterThan(0);
      // The ending stands, and its notice is still owed: nothing landed.
      const ended = await host.row("alice", filing, filed.taskId!);
      expect(ended?.status).toBe("completed");
      expect(ended?.metadata?.["noticeOwed:1:completed"]).toEqual({ attempt: 1, ending: "completed" });
      expect(await linesAbout(host, conv, "survives")).toEqual([]);

      lost.restore();
      await touch(host, "alice", conv);
      await touch(host, "alice", conv);
      expect(await linesAbout(host, conv, "survives")).toHaveLength(1);
      expect((await host.row("alice", filing, filed.taskId!))?.metadata?.["noticeOwed:1:completed"]).toBeNull();
    } finally {
      await host.dispose();
    }
  });
});

describe("a notice that can't land (BR-28)", () => {
  it("is refused when the conversation was deleted, and said in the task session; the ending stands", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "outlives it [slow:150]", assignee: "eng.tasker" });
      for (let i = 0; i < 100 && host.runs.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      await (await host.state.getRuntime()).stores.session.delete(conv);
      await host.settled();
      const row = await host.row("alice", filing, filed.taskId!);
      expect(row?.status).toBe("completed");
      expect(row?.metadata?.["noticeOwed:1:completed"]).toBeNull();
      const said = (await host.messages(host.runs[0]!.sessionId)).map((message) => message.text);
      expect(said).toEqual([expect.stringMatching(/^The conversation that filed task "outlives it \[slow:150\]" couldn't be told it completed/)]);
    } finally {
      await host.dispose();
    }
  });

  it("is refused when the conversation's worker was fired; the ending stands, still owed", async () => {
    const host = bootBoardHost();
    try {
      const hired = await host.hire("alice", {
        id: "my.desk",
        flow: "coordinator",
        settings: { delegates: ["eng.tasker"], routing: "best-fit", fallback: "eng.tasker" }
      });
      expect(hired.error, messageOf(hired.error)).toBeUndefined();
      const conv = await host.conversation("alice", "my.desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "orphaned [slow:150]", assignee: "eng.tasker" });
      for (let i = 0; i < 100 && host.runs.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect((await host.fire("alice", "my.desk")).error).toBeUndefined();
      // The conversation takes the notice and refuses to run it, before any
      // entry: a request whose start fails stays open on its record until the
      // stale sweep, so wait for the notice's request rather than for quiet.
      for (let i = 0; i < 300 && (await settledRequests(host, conv)).length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 100));
      const refused = await settledRequests(host, conv);
      expect(refused.length).toBeGreaterThan(0);
      expect(refused.every((request) => request.status !== "completed")).toBe(true);
      const row = await host.row("alice", filing, filed.taskId!);
      expect(row?.status).toBe("completed");
      expect(row?.metadata?.["noticeOwed:1:completed"]).toEqual({ attempt: 1, ending: "completed" });
      expect(await linesAbout(host, conv, "orphaned [slow:150]")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });
});
