/**
 * A task's ending as the line under the worker that ran it. A task filed with
 * `resultTo: "conversation"` ends as the worker's bare answer, with no task id
 * on the line: that is a finished task, never one drawn as failed. A
 * `user_approval` stop is an approval entry, answered once it resumes. In a
 * popup, only a `sendMessage` that sent something is a sent step.
 */
import { describe, expect, it } from "vitest";
import { toEntries, toSteps } from "../src/adapter";

const CODER = "teammates.coder";
const line = (id: string, text: string) =>
  ({ id, type: "message", role: "assistant", agentName: CODER, status: "completed", requestId: "r1", content: [{ type: "output_text", text }] });
const row = (id: string, status: string) =>
  ({ id: `c-${id}`, type: "component", component: "task-change", status: "completed", requestId: "r1", data: { task: { id, status, assignee: CODER, title: id } } });

describe("a task's ending in the conversation", () => {
  it("draws a conversation-result answer, which names no task, as the answer and not as failed", () => {
    const [entry] = toEntries([line("a", "The README typo is fixed.")], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", from: CODER, text: "The README typo is fixed." });
    expect(entry).not.toHaveProperty("failed");
  });

  it("still draws a named task that errored as failed", () => {
    const [entry] = toEntries([row("task_x", "errored"), line("b", "coder's task (task_x) ended: errored")], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_x", failed: true });
  });
});

describe("a worker waiting for your yes", () => {
  it("draws a user_approval stop as an approval entry, and its resume as the answer", () => {
    const stop = { id: "s1", type: "suspension", reason: "user_approval", status: "completed", requestId: "r1", suspensionId: "sus_1", message: "Publish the draft?" };
    const [open] = toEntries([stop], new Set([CODER]));
    expect(open).toMatchObject({ kind: "approval", requestId: "r1", suspensionId: "sus_1", text: "Publish the draft?" });
    expect(open).not.toHaveProperty("resolution");
    const resume = { id: "s2", type: "suspension_resume", status: "completed", requestId: "r1", suspensionId: "sus_1", resolution: "approved" };
    const [answered] = toEntries([stop, resume], new Set([CODER]));
    expect(answered).toMatchObject({ kind: "approval", resolution: "approved" });
  });
});

describe("a session's steps in a popup", () => {
  const send = (id: string, args: Record<string, unknown>, output: Record<string, unknown>) =>
    ({ id, type: "tool_output", status: "completed", requestId: "r1", toolCall: { name: "sendMessage", arguments: JSON.stringify(args) }, output });

  it("draws a message that went out as sent, to its recipient", () => {
    expect(toSteps([send("m1", { to: "teammates.writer", text: "Draft it." }, { sent: "msg_1" })])).toEqual([
      { id: "m1", kind: "sent", text: "Draft it.", to: "teammates.writer" },
    ]);
  });

  it("draws a wait-again and a refused call as tool steps, never as messages sent", () => {
    const waitAgain = send("m2", { callId: "msg_1" }, { callId: "msg_1", answered: false });
    const refused = send("m3", { to: "teammates.writer" }, { ok: false, error: "missing_message: Nothing was sent." });
    expect(toSteps([waitAgain, refused])).toEqual([
      { id: "m2", kind: "tool", text: "sendMessage" },
      { id: "m3", kind: "tool", text: "sendMessage" },
    ]);
  });
});
