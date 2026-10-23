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

async function until(check: () => Promise<boolean>, what: string) {
  for (const deadline = Date.now() + 5_000; Date.now() < deadline; await sleep(10)) if (await check()) return;
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
});
