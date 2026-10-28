/**
 * A task's midway question, told to the worker that filed it (FIX-2241).
 *
 * When a task asks a question midway, its worker's session sends the filer one
 * message per question, in the session that filed the task, under an id
 * derived from the task and the question. The message is the server's: it
 * costs the exchange no budget, so a spent one never keeps a question from its
 * filer. The Inbox item the hold opens stays the one stop; the message only
 * tells, and the filer may answer it with `updateTask`.
 */
import { describe, expect, it } from "vitest";
import type { RowHold, Task } from "@flow-state-dev/orchestration/tasks";
import { bootBoardHost, messageOf, ORG, type BoardHost } from "./conversation-board-harness";
import { WORKER_MESSAGES_PATTERN } from "../src/messages/message-log";
import { MAX_MESSAGE_CHARS } from "../src/messages/log-row";
import { midwayQuestionMessageId, midwayQuestionText } from "../src/messages/midway-question";

const file = async (host: BoardHost, conv: string, goal: string) => {
  const result = await host.act("alice", conv, "createTask_tasks", { goal, assignee: "eng.tasker" });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return (result.output as { taskId: string }).taskId;
};

/** Every message row in alice's log, from the store. */
async function logRows(host: BoardHost) {
  const runtime = await host.state.getRuntime();
  const prefix = WORKER_MESSAGES_PATTERN.replace("*", "");
  const entries = await runtime.stores.resourceState.getByPrefix("user", `alice:~org:${ORG}`, prefix);
  return Object.values(entries).map((value) => value.state as Record<string, any>);
}

/** The task's open questions, as its row holds them. */
const questionsOf = async (host: BoardHost, conv: string, taskId: string) => {
  const row = (await host.row("alice", await host.filingOf("alice", conv), taskId))!;
  return row.holds!.filter((hold) => hold.source.kind === "row");
};

/** The messages from the task's worker that landed in the filing conversation. */
const told = async (host: BoardHost, conv: string) =>
  (await host.messages(conv)).filter((message) => message.text.startsWith("From eng.tasker:")).map((message) => message.text);

describe("a task's midway question", () => {
  it("reaches its filer as one message naming the task and the question, and a later touch sends no second", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "lead");
      const taskId = await file(host, conv, "pick a region [ask:Which region?]");
      await host.settled();
      const [question] = await questionsOf(host, conv, taskId);
      expect(await told(host, conv)).toEqual([
        `From eng.tasker: Your task "pick a region [ask:Which region?]" (${taskId}) asks: "Which region?"\n` +
          `Answer it with updateTask({ id: "${taskId}", question: "${question!.id}", message }), or leave it to the user, who sees it in their Inbox.`
      ]);
      // Touched again, the board sends nothing more: one row, under the question's own id.
      expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
      await host.settled();
      expect(await told(host, conv)).toHaveLength(1);
      const rows = (await logRows(host)).filter((row) => row.from === "eng.tasker");
      expect(rows.map((row) => [row.id, row.to])).toEqual([[midwayQuestionMessageId(taskId, question!.id), "lead"]]);
    } finally {
      await host.dispose();
    }
  });

  it("reaches its filer when the exchange's budget is spent: the server's message pays nothing", async () => {
    // One send per request: a second question that paid would be refused.
    const host = bootBoardHost({ hire: { messages: { perTurn: 1 } } });
    try {
      const conv = await host.conversation("alice", "lead");
      const taskId = await file(host, conv, "plan a trip [ask:Which region?|Which month?]");
      await host.settled();
      const questions = await questionsOf(host, conv, taskId);
      expect(questions).toHaveLength(2);
      expect(await told(host, conv)).toEqual([
        expect.stringContaining('asks: "Which region?"'),
        expect.stringContaining('asks: "Which month?"')
      ]);
      const rows = (await logRows(host)).filter((row) => row.from === "eng.tasker");
      expect(rows.map((row) => row.id).sort()).toEqual(questions.map((hold) => midwayQuestionMessageId(taskId, hold.id)).sort());
    } finally {
      await host.dispose();
    }
  });
});

describe("the text a question is told in", () => {
  const question = (prompt: string) => ({ kind: "question" as const, prompt });
  const hold = (prompt: string) => ({ id: "hold_1", ask: question(prompt) }) as unknown as RowHold;
  const row = (fields: Partial<Task> = {}) => ({ id: "task_1", goal: "pick a region", ...fields }) as Task;

  it("tells a routed task's filer the user answers it, not how to answer it: the question is the user's alone", () => {
    const routed = midwayQuestionText(row({ targetSessionId: "dsx_ws" }), hold("Which region?"));
    expect(routed).toBe(`Your task "pick a region" (task_1) asks: "Which region?"\nThe user answers it from their Inbox; it isn't yours to answer.`);
    expect(routed).not.toContain("updateTask");
  });

  it("names the task by its title when it has one", () => {
    expect(midwayQuestionText(row({ title: "Region" }), hold("Which region?"))).toMatch(/^Your task "Region" \(task_1\)/);
  });

  it("shortens a long question so the whole message, with how to answer it, fits one message", () => {
    const text = midwayQuestionText(row(), hold("x".repeat(MAX_MESSAGE_CHARS)));
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(text).toContain('question: "hold_1"');
  });

  it("shortens a long task goal too, so a long goal never pushes the question out of the message", () => {
    const text = midwayQuestionText(row({ goal: "g".repeat(8000) }), hold("Which region?"));
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(text).toContain('asks: "Which region?"');
    expect(text).toContain('question: "hold_1"');
  });
});
