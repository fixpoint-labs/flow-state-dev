/**
 * How the conversation that filed a task hears it end (FIX-1794 V5, BR-22 to
 * BR-29).
 *
 * Each ending gives one notice: the write that records it marks the notice
 * owed on the row, the task session sends it to its stamped sender, and the
 * conversation acts on it once: a line, and the coordinator's own turn where
 * its routing has one (judgment, best fit), and a run of the board, with no
 * turn, for an attempt that will be tried again. A notice lost between the ending
 * and its send stays owed on the row, and the next touch of the board sends
 * it. Every leg reads what landed in the conversation after the dust settles,
 * and again after a later touch, so a second copy shows.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

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

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
const until = async (check: () => Promise<boolean> | boolean, ms = 3000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return check();
};

/** The `onTaskSettled` requests a conversation ran. */
const settledRequests = async (host: BoardHost, conv: string) =>
  (await host.requestsOf(conv)).filter((request) => request.actionName === "onTaskSettled");

describe("an attempt that completes (BR-22)", () => {
  it("gives one notice, a line with what came back, and wakes the turn once under best fit: best fit has a turn of its own", async () => {
    const judgment = mockGenerator({
      script: [{ when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Twelve licenses." } }]
    });
    const host = bootBoardHost({ judgment });
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, "alice", conv, { goal: "Count licenses", assignee: "eng.tasker" });
      await host.settled();
      await touch(host, "alice", conv);
      expect(await linesAbout(host, conv, "Count licenses")).toEqual([
        expect.stringMatching(/^Task "Count licenses" \(task_[^)]+\) completed by eng\.tasker: eng\.tasker did: Count licenses$/)
      ]);
      expect(judgment.calls).toHaveLength(1);
      expect((await host.messages(conv)).filter((message) => message.text === "Twelve licenses.")).toHaveLength(1);
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
      // Answered: back in the queue with its answer, as an answer leaves it.
      const parked = (await host.row("alice", filing, filed.taskId!))!;
      const { partition: _p, ...stored } = parked;
      await host.writeRow("alice", filing, { ...(stored as Task), status: "pending", feedback: "eu" });
      await touch(host, "alice", conv);
      await touch(host, "alice", conv);
      const lines = await linesAbout(host, conv, "pick a region [park:Which region?]");
      expect(lines).toEqual([expect.stringContaining("is waiting on a question"), expect.stringContaining("completed by eng.tasker")]);
    } finally {
      await host.dispose();
    }
  });
});

describe("a notice that arrives mid-reply (BR-27)", () => {
  /** The filing reply files "Count licenses" and says so; the notice's turn answers it. */
  const script = (...more: Array<{ when: (input: unknown) => boolean; then: { text: string } }>) =>
    mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "addTask", args: { goal: "Count licenses", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Twelve licenses." } },
        ...more
      ]
    });

  type Held = { host: BoardHost; conv: string; replyId: string };

  /**
   * A person's message, sent through the host as an app sends it, whose reply
   * files the task and is then held open (after its model call, so `addTask`
   * has run) until the task's notice has been dispatched to the conversation,
   * for a further half second in which the notice could land, and then for as
   * long as `during` takes. `seen` says what happened while it was held.
   */
  const replyHeldOpen = async (judgment: ReturnType<typeof script>, during: (held: Held) => Promise<void>) => {
    let calls = 0;
    const held: Held = { host: undefined as never, conv: "", replyId: "" };
    const seen = { noticeArrivedMidReply: false, landedMidReply: true };
    held.host = bootBoardHost({
      judgment,
      afterModelCall: async (blockName) => {
        if (blockName !== "coordinator-judgment" || ++calls !== 1) return;
        seen.noticeArrivedMidReply = await until(async () => (await settledRequests(held.host, held.conv)).length > 0);
        seen.landedMidReply = await until(
          async () => (await linesAbout(held.host, held.conv, "Count licenses")).length > 0,
          500
        );
        await during(held);
      }
    });
    try {
      held.conv = await held.host.conversation("alice", "lead");
      held.replyId = await held.host.post("alice", held.conv, "run", { message: "count our licenses" });
    } catch (error) {
      await held.host.dispose();
      throw error;
    }
    return { ...held, seen };
  };

  /** The text of each message in a conversation. */
  const texts = async (host: BoardHost, conv: string) => (await host.messages(conv)).map((message) => message.text);

  it("waits for the reply to end, then runs once", async () => {
    const judgment = script();
    const { host, conv, seen } = await replyHeldOpen(judgment, async () => {});
    try {
      await host.settled();
      expect(seen.noticeArrivedMidReply).toBe(true);
      expect(seen.landedMidReply).toBe(false);
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
      expect(judgment.calls).toHaveLength(2);
      const replies = await texts(host, conv);
      expect(replies.filter((text) => text === "Filed.")).toHaveLength(1);
      expect(replies.filter((text) => text === "Twelve licenses.")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("never makes the person's own next message wait: it starts mid-reply, and the notice waits for both", async () => {
    const judgment = script({
      when: (input) => JSON.stringify(input).includes("and our seats"),
      then: { text: "Forty seats." }
    });
    let nextStartedMidReply = false;
    let landedMidReply = true;
    const { host, conv, seen } = await replyHeldOpen(judgment, async ({ host, conv }) => {
      await host.post("alice", conv, "run", { message: "and our seats?" });
      nextStartedMidReply = await until(() =>
        judgment.calls.some((call) => JSON.stringify(call.input).includes("and our seats"))
      );
      landedMidReply = (await linesAbout(host, conv, "Count licenses")).length > 0;
    });
    try {
      await host.settled();
      expect(seen.noticeArrivedMidReply).toBe(true);
      expect(seen.landedMidReply).toBe(false);
      expect(nextStartedMidReply).toBe(true);
      expect(landedMidReply).toBe(false);
      const replies = await texts(host, conv);
      expect(replies.filter((text) => text === "Forty seats.")).toHaveLength(1);
      expect(replies.filter((text) => text === "Twelve licenses.")).toHaveLength(1);
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("waits the same way when the board replays it, after the task session's send was lost", async () => {
    const judgment = script();
    let calls = 0;
    let conv = "";
    const seen = { replayedMidReply: false, landedMidReply: true };
    const host: BoardHost = bootBoardHost({
      judgment,
      afterModelCall: async (blockName) => {
        if (blockName !== "coordinator-judgment" || ++calls !== 1) return;
        // The task's own send is lost; touching the board mid-reply sends what the row still owes.
        await until(async () => (await host.rows("alice")).some((row) => row.status === "completed"));
        await until(() => lost.lost() > 0);
        lost.restore();
        expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
        seen.replayedMidReply = await until(async () => (await settledRequests(host, conv)).length > 0);
        seen.landedMidReply = await until(async () => (await linesAbout(host, conv, "Count licenses")).length > 0, 500);
      }
    });
    const lost = await host.loseDispatches("onTaskSettled");
    try {
      conv = await host.conversation("alice", "lead");
      await host.post("alice", conv, "run", { message: "count our licenses" });
      await host.settled();
      expect(seen.replayedMidReply).toBe(true);
      expect(seen.landedMidReply).toBe(false);
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
      expect((await texts(host, conv)).filter((text) => text === "Twelve licenses.")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("waits the same way for a round's reply, the coordinator's turn over its delegates' answers", async () => {
    // Call 2 is the round's reply: it files the task, and is held open until the notice arrives.
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "eng.helper" } }] },
        { text: "Handed." },
        { toolCalls: [{ toolCallId: "a1", toolName: "addTask", args: { goal: "Count licenses", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Twelve licenses." } }
      ]
    });
    let calls = 0;
    let conv = "";
    const seen = { noticeArrivedMidReply: false, landedMidReply: true };
    const host: BoardHost = bootBoardHost({
      standard: boardWorkers({ mixed: { rounds: 1 } }),
      judgment,
      afterModelCall: async (blockName) => {
        if (blockName !== "coordinator-judgment" || ++calls !== 2) return;
        seen.noticeArrivedMidReply = await until(async () => (await settledRequests(host, conv)).length > 0);
        seen.landedMidReply = await until(async () => (await linesAbout(host, conv, "Count licenses")).length > 0, 500);
      }
    });
    try {
      conv = await host.conversation("alice", "mixed");
      await host.post("alice", conv, "run", { message: "who's on call?" });
      await host.settled();
      expect((await host.requestsOf(conv)).some((request) => request.actionName === "routeOn")).toBe(true);
      expect(seen.noticeArrivedMidReply).toBe(true);
      expect(seen.landedMidReply).toBe(false);
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
      expect((await texts(host, conv)).filter((text) => text === "Twelve licenses.")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("still runs when the reply fails", async () => {
    const { host, conv, replyId, seen } = await replyHeldOpen(script(), async () => {
      throw new Error("the model connection dropped");
    });
    try {
      await host.settled();
      expect(seen.noticeArrivedMidReply).toBe(true);
      expect(seen.landedMidReply).toBe(false);
      const reply = (await host.requestsOf(conv)).find((request) => request.id === replyId);
      expect(reply?.status).toBe("failed");
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
      expect((await texts(host, conv)).filter((text) => text === "Twelve licenses.")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("still runs when the reply is cancelled", async () => {
    const { host, conv, replyId, seen } = await replyHeldOpen(script(), async ({ host, replyId }) => {
      await host.abort("alice", replyId);
    });
    try {
      await host.settled();
      expect(seen.noticeArrivedMidReply).toBe(true);
      expect(seen.landedMidReply).toBe(false);
      const reply = (await host.requestsOf(conv)).find((request) => request.id === replyId);
      expect(reply?.status).toBe("aborted");
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
      expect((await texts(host, conv)).filter((text) => text === "Twelve licenses.")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});

describe("a delegate's answer that arrives mid-reply", () => {
  it("lands as it always has, without waiting for the reply: only a task's notice waits", async () => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "eng.helper" } }] }, { text: "Handed." }]
    });
    let calls = 0;
    let conv = "";
    let landedMidReply = false;
    const host: BoardHost = bootBoardHost({
      judgment,
      afterModelCall: async (blockName) => {
        if (blockName !== "coordinator-judgment" || ++calls !== 1) return;
        landedMidReply = await until(async () =>
          (await host.messages(conv)).some((message) => message.text.startsWith("eng.helper heard:"))
        );
      }
    });
    try {
      conv = await host.conversation("alice", "mixed");
      await host.post("alice", conv, "run", { message: "who's on call?" });
      await host.settled();
      expect(landedMidReply).toBe(true);
      const texts = (await host.messages(conv)).map((message) => message.text);
      expect(texts.filter((text) => text.startsWith("eng.helper heard:"))).toHaveLength(1);
      expect(texts.filter((text) => text === "Handed.")).toHaveLength(1);
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
      // The task as filed is the session's first message; then the refusal, said here.
      expect(said).toEqual([
        "outlives it [slow:150]",
        expect.stringMatching(/^The conversation that filed task "outlives it \[slow:150\]" couldn't be told it completed/)
      ]);
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
