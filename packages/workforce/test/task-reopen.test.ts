/**
 * A person's message on a finished task reopens it (FIX-1764).
 *
 * The task's own session still holds its context, so a person who writes
 * there after the task finished is picking it up again: the line stays in the
 * session, the task goes back on the conversation's board and reads in
 * progress, and its next attempt runs in the same session, where the worker
 * answers from everything the session holds. The conversation that filed it
 * hears the new ending, as it heard the first.
 *
 * The host is the conversation board's (`./conversation-board-harness`): a
 * coordinator conversation filing for `otto`, an `agent` worker, whose model
 * is scripted. What each model call was SENT is read off the mock's calls.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import { REOPENED_TURN } from "../src/conversation-board/task-entry";
import type { WorkerManifest } from "../src/manifest";

const workers = (): WorkerManifest[] => [
  ...boardWorkers(),
  { id: "chief", declared: { flow: "coordinator", delegates: ["otto"] }, body: "Hand the work to otto.", skills: [] }
];

/** Every non-system message one model call was sent, as text. */
function sent(messages: unknown): Array<{ role: string; text: string }> {
  return (messages as Array<{ role: string; content: unknown }>)
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      text:
        typeof m.content === "string"
          ? m.content
          : (m.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("")
    }));
}

function host(agentScript: MockGeneratorScriptEntry[]) {
  const agentAnswer = mockGenerator({ script: agentScript });
  const h = bootBoardHost({
    standard: workers(),
    agentAnswer,
    judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] })
  });
  return Object.assign(h, { agentAnswer });
}

const file = async (h: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await h.act("alice", conv, "dispatchTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string };
};

/** File a task for otto in a fresh conversation and wait for it to finish. */
async function finishedTask(h: BoardHost, goal: string) {
  const conv = await h.conversation("alice", "chief");
  const filing = await h.filingOf("alice", conv);
  const filed = await file(h, conv, { goal, assignee: "otto" });
  await h.settled();
  const row = (await h.row("alice", filing, filed.taskId!)) as Task;
  expect(row.status).toBe("completed");
  return { conv, filing, row };
}

const heardEndings = async (h: BoardHost, conv: string) =>
  (await h.requestsOf(conv)).filter((r) => r.actionName === "onTaskSettled").length;

describe("a person's message on a finished task", () => {
  it("puts the task back in progress, runs it again in its own session, and the conversation hears it end again", async () => {
    const h = host([{ when: () => true, then: { text: "done" } }]);
    try {
      const { conv, filing, row } = await finishedTask(h, "Write the release note");
      const session = row.run!.sessionId;
      expect(await heardEndings(h, conv)).toBe(1);

      const message = await h.act("alice", session, "run", { message: "Mention the new flag too." }, "agent");
      expect(message.error, messageOf(message.error)).toBeUndefined();
      expect(message.output).toEqual({ reopened: row.id });
      // Back on the board, not finished: no longer DONE.
      const reopened = (await h.row("alice", filing, row.id)) as Task;
      expect(["pending", "in_progress"]).toContain(reopened.status);

      await h.settled();
      const done = (await h.row("alice", filing, row.id)) as Task;
      expect(done).toMatchObject({ status: "completed", attempts: 2, reopened: true });
      // Same task session: the line, and the turn that answered it, are on the task.
      expect(done.run!.sessionId).toBe(session);
      expect(await heardEndings(h, conv)).toBe(2);
    } finally {
      await h.dispose();
    }
  });

  it("hands the reopened turn the person's message once, then points at it", async () => {
    const h = host([{ when: () => true, then: { text: "done" } }]);
    try {
      const { row } = await finishedTask(h, "Write the release note");
      await h.act("alice", row.run!.sessionId, "run", { message: "Mention the new flag too." }, "agent");
      await h.settled();

      // Two model calls: the task, then the reopened attempt. The person's
      // message never ran a turn of its own.
      expect(h.agentAnswer.calls).toHaveLength(2);
      const messages = sent(h.agentAnswer.calls[1]!.input);
      const line = messages.findIndex((m) => m.role === "user" && m.text === "Mention the new flag too.");
      const pointer = messages.findIndex((m) => m.role === "user" && m.text === REOPENED_TURN);
      expect(line, JSON.stringify(messages)).toBeGreaterThanOrEqual(0);
      expect(pointer).toBe(line + 1);
      expect(messages.filter((m) => m.text.includes("Mention the new flag too."))).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("reopens the latest follow-up, not the task it follows", async () => {
    const h = host([{ when: () => true, then: { text: "done" } }]);
    try {
      const { conv, filing, row } = await finishedTask(h, "Draft the plan");
      const followUp = await file(h, conv, { goal: "Now open the PR", followUpOf: row.id });
      await h.settled();
      expect((await h.row("alice", filing, followUp.taskId!))?.status).toBe("completed");

      await h.act("alice", row.run!.sessionId, "run", { message: "Use a draft PR." }, "agent");
      await h.settled();
      expect((await h.row("alice", filing, followUp.taskId!)) as Task).toMatchObject({ status: "completed", attempts: 2 });
      expect((await h.row("alice", filing, row.id)) as Task).toMatchObject({ status: "completed", attempts: 1 });
    } finally {
      await h.dispose();
    }
  });

  it("is a turn, as before, in a worker's own conversation that works no task", async () => {
    const h = host([{ when: () => true, then: { text: "hello back" } }]);
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "otto" } });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      const own = created.body.session!.id;
      const said = await h.act("alice", own, "run", { message: "hello" }, "agent");
      expect(said.error, messageOf(said.error)).toBeUndefined();
      expect(said.output).not.toHaveProperty("reopened");
      expect(h.agentAnswer.calls).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});
