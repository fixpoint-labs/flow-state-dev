/**
 * A task's ending as the line under the worker that ran it. A task filed with
 * `resultTo: "conversation"` ends as the worker's bare answer, with no task id
 * on the line: that is a finished task, never one drawn as failed. A
 * `user_approval` stop is an approval entry, answered once it resumes. In a
 * popup, only a `sendMessage` that sent something is a sent step. A sent
 * message is replied once a reply lands, or, for a call, once it is answered.
 * Its popup reads the session the log says it was delivered to.
 */
import { describe, expect, it } from "vitest";
import { destinationOf, exchangeOf, toEntries, toSteps } from "../src/adapter";
import { answerIn } from "../src/components/Popups";

const CODER = "teammates.claude-code";
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

  it("names a filed task's ending by the task's title, read from its row", () => {
    const [entry] = toEntries([row("task_y", "completed"), line("c", "Task \"task_y\" (task_y) completed by teammates.claude-code: Fixed.")], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_y", title: "task_y" });
  });

  it("still draws a named task that errored as failed", () => {
    const [entry] = toEntries([row("task_x", "errored"), line("b", "Claude Code's task (task_x) ended: errored")], new Set([CODER]));
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
      { id: "m2", kind: "tool", tool: "sendMessage", text: "Used sendMessage" },
      { id: "m3", kind: "tool", tool: "sendMessage", text: "Used sendMessage" },
    ]);
  });
});

describe("how a sent message stands", () => {
  const sent = { id: "msg_1", from: "teammates.chief-of-staff", to: "teammates.researcher", text: "Launch date?", at: 1 };
  const reply = { id: "msg_2", from: sent.to, to: sent.from, text: "Nov 12", at: 2, inReplyTo: "msg_1" };

  it("is replied when a message answers it", () => {
    expect(answerIn([sent], "msg_1")).toBe("working");
    expect(answerIn([sent, reply], "msg_1")).toBe("replied");
  });

  it("is replied when it was a call and the call was answered, with no reply message", () => {
    expect(answerIn([{ ...sent, callAnswered: true }], "msg_1")).toBe("replied");
  });

  // The framework's "no answer" is a reply row too: it must not read as an answer.
  it("is no answer when the reply is the framework's no answer", () => {
    expect(answerIn([sent, { ...reply, text: "No answer came back: the turn ended without saying anything.", noAnswer: true }], "msg_1")).toBe("no answer");
  });
});

describe("where a sent message's popup looks", () => {
  const row = (id: string, toSession: string) => ({
    id, from: "teammates.researcher", to: "teammates.chief-of-staff", text: "Nov 12", exchange: "msg_1", inReplyTo: "msg_1",
    fromSession: "sess_researcher", fromFlow: "teammates", toSession, toFlow: "teammates", hop: 1, status: "delivered", at: 2,
  });

  it("reads the session the log says the message landed in, a task's session included", () => {
    expect(destinationOf([row("msg_0", "sess_other"), row("msg_2", "sess_task_7")], "msg_2")).toBe("sess_task_7");
  });

  it("has no answer for a message the log doesn't hold yet", () => {
    expect(destinationOf([row("msg_0", "sess_other")], "msg_2")).toBeUndefined();
  });
});

describe("the turn a message's popup shows", () => {
  const receipt = (id: string, requestId: string) =>
    ({ id, type: "component", component: "workforce:received", status: "completed", requestId, data: { id: "msg_1", text: "Launch date?" } });
  const said = (id: string, requestId: string, text: string) =>
    ({ id, type: "message", role: "assistant", status: "completed", requestId, content: [{ type: "output_text", text }] });

  it("follows the turn that took a message over after its first taker died", () => {
    const items = [receipt("c1", "r1"), receipt("c2", "r2"), said("a2", "r2", "Nov 12")];
    expect(exchangeOf(items, "msg_1").map((s) => s.id)).toEqual(["c2", "a2"]);
  });
});
