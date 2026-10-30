/**
 * A finished task's result reaches the filer as the result of the task it
 * filed, never as the user's turn, and whole (FIX-2345).
 *
 * A lead worker in the Teammates lab filed a task for its researcher; the
 * ending woke its turn with orchestration's `noticeText` as the message: a
 * user-role turn, its output summary cut at 500 characters with "…". The
 * model took it for something the user pasted, and worked from the cut text.
 *
 * Each leg reads the model's own input for the turn the ending woke, and checks
 * the two things the model got wrong there: no user-role message carries the
 * result, and the result it reads (a `getTask` call and its result, for the
 * task's id) holds the whole output, past where the line is cut. The line
 * under the delegate's name stays the short line.
 */
import { describe, expect, it } from "vitest";
import { isTerminalStatus } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

type ModelMessage = { role: string; content: unknown };

/** A goal long enough that its worker's output (`eng.tasker did: <goal>`) is cut in the line, ending in `tail`. */
const longGoal = (tail: string) => `Track worktree paths ${"x".repeat(700)} ${tail}`;

const textOf = (content: unknown): string => (typeof content === "string" ? content : JSON.stringify(content));

/** The `getTask` reads in a model call: each call's id and input, with the result it got. */
function getTaskReads(messages: readonly ModelMessage[]) {
  const parts = messages.flatMap((message) => (Array.isArray(message.content) ? (message.content as any[]) : []));
  const calls = parts.filter((part) => part.type === "tool-call" && part.toolName === "getTask");
  return calls.map((call) => ({
    input: call.input as { id: string },
    result: parts.find((part) => part.type === "tool-result" && part.toolCallId === call.toolCallId)?.output?.value as
      | { ok: boolean; task: { id: string; status: string; output?: unknown; outputCut?: true } }
      | undefined
  }));
}

/** Check one model call heard task `taskId` end with `tail` at the end of its output, as a getTask read and not a user turn. */
function expectReadAsTaskResult(messages: readonly ModelMessage[], taskId: string, tail: string) {
  // Never the user's words: no user-role message carries the result.
  const userTexts = messages.filter((message) => message.role === "user").map((message) => textOf(message.content));
  expect(userTexts.filter((text) => text.includes(taskId) || text.includes(tail))).toEqual([]);
  // The result of the task it filed, linked by id, whole: past where the line is cut.
  const reads = getTaskReads(messages).filter((read) => read.input.id === taskId);
  expect(reads).toHaveLength(1);
  expect(reads[0]!.result).toMatchObject({ ok: true, task: { id: taskId, status: "completed" } });
  expect(reads[0]!.result!.task.outputCut).toBeUndefined();
  expect(String(reads[0]!.result!.task.output)).toMatch(new RegExp(`${tail}$`));
}

const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({ id, declared, body, skills: [] });

describe("a turn a task's ending wakes reads the result as its getTask read (FIX-2345)", () => {
  it("the coordinator's judgment turn: the ending is the task's result, whole, and the line stays short", async () => {
    const tail = `END-${Math.random().toString(36).slice(2, 8)}`;
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "createTask", args: { goal: longGoal(tail), title: "Track worktree paths", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: () => true, then: { text: "Here is what the researcher found." } }
      ]
    });
    const host = bootBoardHost({ judgment });
    try {
      const conv = await host.conversation("alice", "lead");
      expect((await host.act("alice", conv, "respond", { message: "track the worktree paths" })).error).toBeUndefined();
      await host.settled();
      expect(judgment.calls).toHaveLength(2);
      const [row] = await host.rows("alice");
      expectReadAsTaskResult(judgment.calls[1]!.input as ModelMessage[], row!.id, tail);
      // The line the user sees under the delegate's name is the short one.
      const line = (await host.messages(conv)).find((message) => message.agentName === "eng.tasker")!;
      expect(line.text).toMatch(/^Task "Track worktree paths" \(task_[^)]+\) completed by eng\.tasker: /);
      expect(line.text.endsWith("…")).toBe(true);
    } finally {
      await host.dispose();
    }
  });

  it("the agent flow's turn, as the Teammates lab's lead runs: the same read", async () => {
    const tail = `END-${Math.random().toString(36).slice(2, 8)}`;
    let filed = false;
    const agentAnswer = mockGenerator({
      script: [
        { when: () => filed, then: { text: "Here is what the researcher found." } },
        {
          when: () => {
            filed = true;
            return true;
          },
          then: { toolCalls: [{ toolCallId: "call-file", toolName: "createTask", args: { goal: longGoal(tail), title: "Track worktree paths", assignee: "eng.tasker" } }] }
        }
      ]
    });
    const host: BoardHost = bootBoardHost({
      standard: [...boardWorkers(), worker("ana", { delegates: ["eng.tasker"] }, "You hand work to eng.tasker.")],
      agentAnswer
    });
    try {
      const created = await host.create("alice", "agent", { state: { workerId: "ana" } });
      const session = created.body.session!.id;
      await host.post("alice", session, "respond", { message: "track the worktree paths" }, "agent");
      await host.settled(20_000);
      const [row] = await host.rows("alice");
      expect(isTerminalStatus(row!.status)).toBe(true);
      const woken = (await host.requestsOf(session)).find((request) => request.actionName === "onTaskSettled")!;
      expect(woken.status, messageOf((woken as { error?: unknown }).error)).toBe("completed");
      // The last model call is the woken turn's.
      expectReadAsTaskResult(agentAnswer.calls.at(-1)!.input as ModelMessage[], row!.id, tail);
    } finally {
      await host.dispose();
    }
  });
});
