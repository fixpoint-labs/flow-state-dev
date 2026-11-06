/**
 * A task's ending as the line under the worker that ran it. A task filed with
 * `resultTo: "conversation"` ends as the worker's bare answer, with no task id
 * on the line: that is a finished task, never one drawn as failed. A
 * `user_approval` stop is an approval entry, answered once it resumes. In a
 * popup, only a `sendMessage` that sent something is a sent step. A sent
 * message is replied once its reply is in the log, waited on or not.
 * Its popup reads the session the log says it was delivered to.
 */
import { describe, expect, it } from "vitest";
import { noticeMetadata, noticeText, type TaskNotice } from "@flow-state-dev/orchestration/tasks";
import { delegateAnswerMetadata } from "@flow-state-dev/workforce/browser";
import { destinationOf, exchangeOf, toBoardTask, toEntries, toSteps, type ConversationEntry } from "../src/adapter";
import { answerIn } from "../src/components/Popups";

const CODER = "teammates.claude-code";
const line = (id: string, text: string, metadata?: Record<string, unknown>) =>
  ({ id, type: "message", role: "assistant", agentName: CODER, status: "completed", requestId: "r1", content: [{ type: "output_text", text }], ...(metadata === undefined ? {} : { metadata }) });
/** A task's ending as workforce emits it: orchestration's words and data on one line. */
const ending = (id: string, taskId: string, patch: Partial<TaskNotice>) => {
  const notice: TaskNotice = { boardId: "conversation", taskId, attempt: 1, ending: "completed", ...patch };
  const task = { goal: taskId, title: taskId, assignee: CODER };
  return line(id, noticeText(notice, task), noticeMetadata(notice, task));
};
const row = (id: string, status: string) =>
  ({ id: `c-${id}`, type: "component", component: "task-change", status: "completed", requestId: "r1", data: { task: { id, status, assignee: CODER, title: id } } });

describe("a task's ending in the conversation", () => {
  it("draws a conversation-result answer, which names no task, as the answer and not as failed", () => {
    const [entry] = toEntries([line("a", "The README typo is fixed.")], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", from: CODER, text: "The README typo is fixed." });
    expect(entry).not.toHaveProperty("failed");
  });

  it("names a filed task's ending by the task's title, read from its row", () => {
    const [entry] = toEntries([row("task_y", "completed"), ending("c", "task_y", { output: "Fixed." })], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_y", title: "task_y" });
  });

  it("still draws a named task that errored as failed", () => {
    const [entry] = toEntries([row("task_x", "errored"), ending("b", "task_x", { ending: "errored", error: "timed out" })], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_x", failed: true });
  });

  it("names its task from the line's data, so a line whose words changed still links to it", () => {
    const [entry] = toEntries([row("task_y", "completed"), line("c", "Fixed it.", noticeMetadata({ boardId: "conversation", taskId: "task_y", attempt: 1, ending: "completed" }, { goal: "task_y" }))], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_y", title: "task_y" });
  });

  it("links a marked answer to the task it answered, never drawn as failed, even when its words quote another task", () => {
    const quoted = noticeText({ boardId: "conversation", taskId: "task_old", attempt: 1, ending: "errored", error: "x" }, { goal: "old" });
    const [entry] = toEntries([row("task_a", "completed"), line("e", quoted, delegateAnswerMetadata({ worker: CODER, taskId: "task_a" }))], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_a", from: CODER });
    expect(entry).not.toHaveProperty("failed");
  });

  // FIX-2349: a task Chief of Staff cancelled read "failed" while its run was still going.
  it("draws a cancelled task as cancelled, never as failed", () => {
    expect(toBoardTask({ id: "task_c", status: "cancelled", assignee: CODER, title: "Misc bug fix" }).status).toBe("cancelled");
    const [entry] = toEntries([row("task_c", "cancelled"), ending("d", "task_c", { ending: "cancelled" })], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_c", cancelled: true });
    expect(entry).not.toHaveProperty("failed");
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

  it("draws a waited send as sent, and a refused send as a tool step, never as a message sent", () => {
    const waited = send("m2", { to: "teammates.writer", text: "Draft it?", wait: true }, { status: "answered", sent: "msg_2", reply: "Done." });
    const refused = send("m3", { to: "teammates.writer", text: "Hi." }, { ok: false, error: "no_worker: Nothing was sent." });
    expect(toSteps([waited, refused])).toEqual([
      { id: "m2", kind: "sent", text: "Draft it?", to: "teammates.writer" },
      { id: "m3", kind: "tool", tool: "sendMessage", text: "Message teammates.writer", state: "error", requestId: "r1" },
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

  it("is replied when a waited send took the answer as its result: the answer is still a row in the log", () => {
    expect(answerIn([{ ...sent, replyRequested: true }, reply], "msg_1")).toBe("replied");
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

// A worker's tool steps show in the conversation during its turn, not only in a popup.
describe("a worker's tool steps in its conversation", () => {
  const call = (id: string, name: string, args: Record<string, unknown>, status: string, output?: unknown, requestId = "r1") =>
    ({ id, type: "tool_output", status, requestId, toolCall: { name, arguments: JSON.stringify(args) }, ...(output === undefined ? {} : { output }) });
  const read = (id: string, path: string, status = "completed", requestId = "r1") =>
    call(id, "readProjectSource", { path }, status, status === "completed" ? { kind: "read", status: "ok", path, content: "x" } : undefined, requestId);
  const steps = (entries: ConversationEntry[]) => entries.filter((e): e is Extract<ConversationEntry, { kind: "steps" }> => e.kind === "steps");

  it("shows the run open while a step runs, naming the file in flight", () => {
    const [run] = steps(toEntries([read("t1", "docs/launch.md"), read("t2", "src/config/release.ts", "in_progress")], new Set()));
    expect(run).toMatchObject({ state: "running", open: true, label: "Read src/config/release.ts…" });
    expect(run!.steps.map((s) => s.text)).toEqual(["Read docs/launch.md", "Read src/config/release.ts"]);
  });

  it("folds the run once its steps are done, summed up in the registry's words", () => {
    const grep = call("t3", "grepProjectSource", { pattern: "LAUNCH" }, "completed", { kind: "grep", matches: [{ path: "a", line: 1, text: "x" }] });
    const [run] = steps(toEntries([read("t1", "docs/launch.md"), read("t2", "src/release.ts"), grep], new Set()));
    expect(run).toMatchObject({ state: "completed", open: false });
    expect(run!.label).toBe("Read 2 files and searched the code");
  });

  it("says a refused read failed, in words, and the run with it", () => {
    const refused = call("t1", "readProjectSource", { path: "secret.md" }, "completed", { kind: "refused", reason: "no-project", message: "No project." });
    const [run] = steps(toEntries([refused], new Set()));
    expect(run).toMatchObject({ state: "error", open: false, label: "Read secret.md (failed)" });
  });

  it("starts a new run for a new turn, and for a call after a line the worker wrote", () => {
    const said = { id: "a1", type: "message", role: "assistant", status: "completed", requestId: "r1", content: [{ type: "output_text", text: "Looking." }] };
    const entries = toEntries([read("t1", "a.md"), said, read("t2", "b.md"), read("t3", "c.md", "completed", "r2")], new Set());
    expect(entries.map((e) => e.kind)).toEqual(["steps", "assistant", "steps", "steps"]);
  });

  it("says a step its turn left running failed once the turn is over, so a crashed turn's run doesn't stay open", () => {
    const items = [read("t1", "a.md"), read("t2", "b.md", "in_progress")];
    expect(steps(toEntries(items, new Set()))[0]).toMatchObject({ state: "running", open: true });
    expect(steps(toEntries(items, new Set(), ["r1"]))[0]).toMatchObject({ state: "error", open: false, label: "Read 2 files (1 failed)" });
  });

  it("keeps a message sent and a task filed as their own lines, never as steps", () => {
    const sent = call("s1", "sendMessage", { to: "teammates.writer", text: "Draft it." }, "completed", { sent: "msg_1" });
    const filed = call("c1", "createTask", { title: "Draft the post", assignee: "teammates.writer" }, "completed", { ok: true, taskId: "task_1" });
    expect(toEntries([sent, filed], new Set()).map((e) => e.kind)).toEqual(["sent", "task"]);
  });
});
