/**
 * A line in a task's session (FIX-2086). The host is the conversation board's
 * (`./conversation-board-harness`): scripted models, and what each call was
 * sent is read off the mock.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import type { GeneratorModel } from "@flow-state-dev/core/types";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import type { WorkerManifest } from "../src/manifest";

const workers = (): WorkerManifest[] => [
  ...boardWorkers(),
  { id: "chief", declared: { flow: "coordinator", delegates: ["otto"] }, body: "Hand the work to otto.", skills: [] }
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Everything one model call was sent, system prompt included, as one string. */
const sentText = (input: unknown) => JSON.stringify(input).replaceAll("\\n", "\n").replaceAll('\\"', '"');

/** A gate on otto's model calls: hold the n-th call open after it answers, until released. */
function gate(holdCall: number) {
  let calls = 0;
  let release!: () => void;
  let reached!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const atHold = new Promise<void>((resolve) => (reached = resolve));
  return {
    after: async (block: string | undefined) => {
      if (block === undefined || !block.startsWith("agent-answer")) return;
      calls += 1;
      if (calls !== holdCall) return;
      reached();
      await released;
    },
    atHold,
    release
  };
}

function host(script: MockGeneratorScriptEntry[], afterModelCall?: (block: string | undefined) => Promise<void>) {
  const agentAnswer = mockGenerator({ script });
  const h = bootBoardHost({
    standard: workers(),
    agentAnswer,
    judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }),
    ...(afterModelCall === undefined ? {} : { afterModelCall })
  });
  return Object.assign(h, { agentAnswer });
}

const file = async (h: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await h.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string };
};

const heardEndings = async (h: BoardHost, conv: string) =>
  (await h.requestsOf(conv)).filter((r) => r.actionName === "onTaskSettled").length;

/** Wait until `taskId` has a run in a session, and answer the row. */
async function running(h: BoardHost, filing: string, taskId: string): Promise<Task> {
  for (let i = 0; i < 500; i += 1) {
    const row = (await h.row("alice", filing, taskId)) as Task | undefined;
    if (row?.run?.sessionId !== undefined && row.status === "in_progress") return row;
    await sleep(10);
  }
  throw new Error(`task ${taskId} never started`);
}

describe("a line in a finished task's session", () => {
  it("is talk: the worker answers from the session, and the task, its output and its attempts don't change", async () => {
    const h = host([
      { when: (input) => sentText(input).includes("Which licence"), then: { text: "It was KESTREL-41." } },
      { when: () => true, then: { text: "I found licence KESTREL-41 is GPL." } }
    ]);
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "Audit the licences", assignee: "otto" });
      await h.settled();
      const done = (await h.row("alice", filing, filed.taskId!)) as Task;
      expect(done.status).toBe("completed");
      const before = JSON.stringify(done);

      const said = await h.act("alice", done.run!.sessionId, "respond", { message: "Which licence was the problem?" }, "agent");
      await h.settled();

      expect(said.error, messageOf(said.error)).toBeUndefined();
      expect(said.output).not.toHaveProperty("steered");
      expect(JSON.stringify(await h.row("alice", filing, filed.taskId!))).toBe(before);
      expect(h.agentAnswer.calls).toHaveLength(2);
      expect(await heardEndings(h, conv)).toBe(1);
    } finally {
      await h.dispose();
    }
  });
});

describe("a line in an open task's session", () => {
  it("steers the task, runs no reply of its own, and a steer after the last model call gets one more turn before it settles", async () => {
    const hold = gate(1);
    const h = host([{ when: () => true, then: { text: "first draft" } }], hold.after);
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "Write the release note", assignee: "otto" });
      const row = await running(h, filing, filed.taskId!);
      // Otto's one model call has answered; its request has not ended.
      await hold.atHold;

      const line = await h.act("alice", row.run!.sessionId, "respond", { message: "Mention the new flag too." }, "agent");
      expect(line.error, messageOf(line.error)).toBeUndefined();
      expect(line.output).toEqual({ steered: filed.taskId });
      // No turn of its own: the line wrote a steer and nothing else ran.
      expect(h.agentAnswer.calls).toHaveLength(1);

      hold.release();
      await h.settled();

      const done = (await h.row("alice", filing, filed.taskId!)) as Task;
      expect(done).toMatchObject({ status: "completed", attempts: 1 });
      expect(done.steers).toEqual([expect.objectContaining({ message: "Mention the new flag too.", from: "user", by: "alice", takenBy: 1 })]);
      // One more turn, on the same attempt, with the steer as its message, before the one ending.
      expect(h.agentAnswer.calls).toHaveLength(2);
      expect(sentText(h.agentAnswer.calls[1]!.input)).toContain("Mention the new flag too.");
      expect(await heardEndings(h, conv)).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("reaches the running request before its next model call, with no stop and no attempt used", async () => {
    // Otto's turn as a step model: step one checkpoints and holds until the
    // line has landed; step two answers. The generator re-reads its context
    // between them.
    const steps: string[] = [];
    let release!: () => void;
    let reached!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const atHold = new Promise<void>((resolve) => (reached = resolve));
    const agentModel: GeneratorModel = {
      modelId: "steered-agent",
      async generate() {
        throw new Error("driven step by step");
      },
      async generateStep(options) {
        steps.push(JSON.stringify(options));
        const tools = (options.messages as Array<{ role: string }>).filter((m) => m.role === "tool");
        if (tools.length === 0) {
          reached();
          await released;
          return { toolCalls: [{ toolCallId: "c1", toolName: "reportProgress", args: { statusNote: "Halfway" } }], finishReason: "tool-calls" };
        }
        return { text: "the note, with the flag", finishReason: "stop" };
      }
    };
    const h = Object.assign(
      bootBoardHost({ standard: workers(), agentModel, judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }) }),
      {}
    );
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "Write the release note", assignee: "otto" });
      const row = await running(h, filing, filed.taskId!);
      await atHold;

      const line = await h.act("alice", row.run!.sessionId, "respond", { message: "Mention the new flag too." }, "agent");
      expect(line.output).toEqual({ steered: filed.taskId });
      release();
      await h.settled();

      expect(steps).toHaveLength(2);
      // Not in the call before it; in the next one.
      expect(steps[0]).not.toContain("Mention the new flag too.");
      expect(steps[1]).toContain("Mention the new flag too.");
      const done = (await h.row("alice", filing, filed.taskId!)) as Task;
      expect(done).toMatchObject({ status: "completed", attempts: 1, output: "the note, with the flag" });
      expect(done.steers).toEqual([expect.objectContaining({ takenBy: 1, takenIn: expect.stringMatching(/^step:/) })]);
      expect(await heardEndings(h, conv)).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("steers the task running in the session, not a follow-up queued behind it", async () => {
    const hold = gate(1);
    const h = host([{ when: () => true, then: { text: "the note" } }], hold.after);
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "Write the release note", assignee: "otto" });
      const row = await running(h, filing, filed.taskId!);
      await hold.atHold;
      // A follow-up filed now waits for the running task, in the same session.
      const followUp = await file(h, conv, { goal: "Then a tweet about it", followUpOf: filed.taskId });
      expect(followUp.ok).toBe(true);

      const line = await h.act("alice", row.run!.sessionId, "respond", { message: "Mention the new flag too." }, "agent");

      expect(line.output).toEqual({ steered: filed.taskId });
      hold.release();
      await h.settled();
      const first = (await h.row("alice", filing, filed.taskId!)) as Task;
      const second = (await h.row("alice", filing, followUp.taskId!)) as Task;
      expect(first.steers).toEqual([expect.objectContaining({ message: "Mention the new flag too." })]);
      expect(second.steers ?? []).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("is a turn, as before, in a worker's own conversation that works no task", async () => {
    const h = host([{ when: () => true, then: { text: "hello back" } }]);
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "otto" } });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      const said = await h.act("alice", created.body.session!.id, "respond", { message: "hello" }, "agent");
      expect(said.error, messageOf(said.error)).toBeUndefined();
      expect(said.output).not.toHaveProperty("steered");
      expect(h.agentAnswer.calls).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});
