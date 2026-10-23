/**
 * A steer to a task that waits on the work it filed (FIX-2113). The steer's
 * own turn runs at once, and the turn that answers after the work ends (the
 * notice's) is a later request in the same session: it reads the steer only
 * from the session's history, so the steer turn's take must leave it there.
 *
 * The host is the conversation board's (`./conversation-board-harness`):
 * `otto` on the built-in `agent` flow, with `eng.tasker` as its delegate, and
 * a scripted model. What each model call was sent is read off the mock.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";
import type { WorkerManifest } from "../src/manifest";

const workers = (): WorkerManifest[] => [
  ...boardWorkers({ otto: { delegates: ["eng.tasker"] } }),
  { id: "chief", declared: { flow: "coordinator", delegates: ["otto"] }, body: "Hand the work to otto.", skills: [] }
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Everything one model call was sent, as one string. */
const sentText = (input: unknown) => JSON.stringify(input).replaceAll("\\n", "\n").replaceAll('\\"', '"');

async function until(check: () => Promise<boolean>, what: string, ms = 5_000) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(10)) if (await check()) return;
  throw new Error(`timed out waiting for ${what}`);
}

describe("a steer while the task waits on the work it filed", () => {
  it("reaches the turn that answers after the work ends, and is taken once", async () => {
    const STEER = "Also use the word ember.";
    let release!: () => void;
    const holds = new Map([["research", new Promise<void>((resolve) => (release = resolve))]]);
    const agentAnswer = mockGenerator({
      script: [
        // The task's turn (one model call, two steps) files the research and ends: the task waits on it.
        { toolCalls: [{ toolCallId: "c1", toolName: "createTask", args: { goal: "[hold:research] Find the fact", assignee: "eng.tasker" } }] },
        { text: "Filed the research; waiting on it." },
        // The steer's turn.
        { text: "Noted: I'll use the word ember." },
        // The research's notice wakes the turn whose answer is the task's result.
        { text: "The post, with the fact and the word ember." }
      ]
    });
    const h = bootBoardHost({
      standard: workers(),
      agentAnswer,
      holds,
      judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await h.act("alice", conv, "createTask_tasks", { goal: "Write the post", assignee: "otto" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const taskId = (filed.output as { taskId: string }).taskId;
      const row = async () => (await h.row("alice", filing, taskId)) as Task | undefined;
      await until(async () => (await row())?.waitingOn === "filed", "the task to wait on its research");

      const steered = await h.act("alice", conv, "updateTask_tasks", { id: taskId, message: STEER });
      expect(steered.output).toEqual({ ok: true });
      await until(async () => agentAnswer.calls.length === 2, "the steer's turn");
      release();
      await h.settled();

      const done = (await row())!;
      expect(done).toMatchObject({ status: "completed", attempts: 1, output: "The post, with the fact and the word ember." });
      // Taken once, by the steer's turn, whose message carried it.
      expect(done.steers).toEqual([expect.objectContaining({ message: STEER, takenBy: 1, takenIn: expect.stringMatching(/^turn:/) })]);
      expect(sentText(agentAnswer.calls[1]!.input)).toContain(STEER);
      // The notice's turn, a later request in the session, was sent the steer
      // too: before it, the steer turn's take left it nowhere a later turn reads.
      const last = sentText(agentAnswer.calls[2]!.input);
      expect(last).toContain("completed by eng.tasker");
      expect(last).toContain(STEER);
    } finally {
      await h.dispose();
    }
  }, 20_000);

  it("runs one turn of the task at a time: the research's turn waits while the steer's turn waits on its own step", async () => {
    let release!: () => void;
    const holds = new Map([["research", new Promise<void>((resolve) => (release = resolve))]]);
    /** The last user message one model call was sent: what that turn is answering. */
    const lastUser = (input: unknown) => {
      const s = sentText(input);
      return s.slice(s.lastIndexOf('"role":"user"'));
    };
    const once = (flag: { done: boolean }, test: (i: unknown) => boolean) => (i: unknown) => {
      if (flag.done || !test(i)) return false;
      flag.done = true;
      return true;
    };
    const filedResearch = { done: false };
    const steerStep = { done: false };
    const noticeStep = { done: false };
    const ANSWERING = "The steps you filed for yourself have ended";
    const agentAnswer = mockGenerator({
      script: [
        { when: (i) => lastUser(i).includes(ANSWERING), then: { text: "The post, after the check." } },
        { when: (i) => lastUser(i).includes("You are working a step you filed for yourself"), then: { text: "checked" } },
        { when: (i) => lastUser(i).includes("[step]"), then: { text: "checked in its own session" } },
        // The steer's turn files a step in a session of its own: its request waits on it.
        {
          when: once(steerStep, (i) => lastUser(i).includes("You were sent the messages below")),
          then: { toolCalls: [{ toolCallId: "s1", toolName: "createTask", args: { goal: "[step] Check the draft", assignee: "otto", session: "new" } }] }
        },
        { when: (i) => lastUser(i).includes("You were sent the messages below"), then: { text: "Waiting on the check." } },
        // The research's turn files one too.
        {
          when: once(noticeStep, (i) => lastUser(i).includes("completed by eng.tasker")),
          then: { toolCalls: [{ toolCallId: "s2", toolName: "createTask", args: { goal: "[step] Check the fact", assignee: "otto", session: "new" } }] }
        },
        { when: (i) => lastUser(i).includes("completed by eng.tasker"), then: { text: "Waiting on the fact check." } },
        {
          when: once(filedResearch, (i) => lastUser(i).includes("Write the post")),
          then: { toolCalls: [{ toolCallId: "c1", toolName: "createTask", args: { goal: "[hold:research] Find the fact", assignee: "eng.tasker" } }] }
        },
        { when: (i) => lastUser(i).includes("Write the post"), then: { text: "Waiting on research." } }
      ]
    });
    // When each model call was sent, and what it answers. The steer's step
    // takes 9 s, long enough that the turned-away notice's next resend backs
    // off past the moment the steer's turn answers.
    const sentAt: Array<{ at: number; asked: string }> = [];
    let holdStep = false;
    const h = bootBoardHost({
      standard: workers(),
      agentAnswer,
      holds,
      observeTools: (_block, _names, input) => {
        const asked = lastUser(input);
        sentAt.push({ at: Date.now(), asked });
        if (asked.includes("[step] Check the draft") && !asked.includes(ANSWERING)) holdStep = true;
      },
      afterModelCall: async () => {
        if (!holdStep) return;
        holdStep = false;
        await sleep(9_000);
      },
      durable: true,
      judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await h.act("alice", conv, "createTask_tasks", { goal: "Write the post", assignee: "otto" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const taskId = (filed.output as { taskId: string }).taskId;
      const row = async () => (await h.row("alice", filing, taskId)) as Task | undefined;
      await until(async () => (await row())?.waitingOn === "filed", "the task to wait on its research");
      expect((await h.act("alice", conv, "updateTask_tasks", { id: taskId, message: "Also use the word ember." })).output).toEqual({ ok: true });
      await until(async () => steerStep.done, "the steer's turn to file its step");
      // The research ends while the steer's turn waits on its step.
      release();
      // Done well before a lease (120 s) could free a stalled task.
      await until(async () => (await row())?.status === "completed", "the task to complete", 20_000);
      await h.settled();

      const asked = agentAnswer.calls.map((c) => lastUser(c.input));
      const at = (words: string, from = 0) => asked.findIndex((text, i) => i >= from && text.includes(words));
      const steerTurn = at("You were sent the messages below");
      const steerAnswer = at(ANSWERING, steerTurn);
      const researchTurn = at("completed by eng.tasker");
      // The research's turn ran only once the steer's turn had answered after its step.
      expect(steerAnswer, JSON.stringify(asked)).toBeGreaterThan(steerTurn);
      expect(researchTurn, JSON.stringify(asked)).toBeGreaterThan(steerAnswer);
      // At once: the steer's turn sends it on as it answers, not at the notice's next resend.
      const answered = sentAt.find((call) => call.asked.includes(ANSWERING))!.at;
      const heard = sentAt.find((call) => call.asked.includes("completed by eng.tasker"))!.at;
      expect(heard - answered).toBeLessThan(2_500);
      // And it read the steer, from the session.
      expect(sentText(agentAnswer.calls[researchTurn]!.input)).toContain("Also use the word ember.");
      // Its own step was worked, and its answer is the task's result.
      expect(at(ANSWERING, researchTurn)).toBeGreaterThan(researchTurn);
      expect((await row())).toMatchObject({ status: "completed", attempts: 1, output: "The post, after the check." });
    } finally {
      await h.dispose();
    }
  }, 40_000);
});
