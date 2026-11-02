/**
 * A task's line in the main thread is read off the data the package puts on
 * its item, never off its words. Workforce emits a task's ending with
 * orchestration's `noticeText` words and `noticeMetadata` data, and a
 * delegate's answer with `delegateAnswerMetadata`; the thread draws each as a
 * result. A line whose words change still reads; a line whose words look like
 * a notice but carry other data does not.
 */
import { describe, expect, it } from "vitest";
import { noticeMetadata, noticeText, type TaskNotice } from "@flow-state-dev/orchestration/tasks";
import { delegateAnswerMetadata } from "@flow-state-dev/workforce/browser";
import { entriesOf, type Item } from "../src/adapter";

const task = { goal: "Review the theme toggle", title: "Theme review", assignee: "desk.reviewer" };
const notice = (patch: Partial<TaskNotice>): TaskNotice => ({
  boardId: "conversation",
  taskId: "task_7",
  attempt: 1,
  ending: "completed",
  output: "The toggle keeps its choice.",
  ...patch,
});
const said = (id: string, text: string, metadata?: Record<string, unknown>, agentName = "desk.reviewer"): Item => ({
  id,
  type: "message",
  role: "assistant",
  requestId: "r2",
  agentName,
  content: [{ type: "output_text", text }],
  ...(metadata === undefined ? {} : { metadata }),
});
const line = (patch: Partial<TaskNotice>) => said("i1", noticeText(notice(patch), task), noticeMetadata(notice(patch), task));

describe("a task's ending in the main thread", () => {
  it("is a result naming its task, title and ending, for each ending the thread draws", () => {
    expect(entriesOf([line({})])[0]).toMatchObject({ kind: "result", taskId: "task_7", title: "Theme review", status: "completed", summary: "The toggle keeps its choice." });
    expect(entriesOf([line({ ending: "errored", error: "timed out" })])[0]).toMatchObject({ kind: "result", status: "errored", summary: "timed out" });
    expect(entriesOf([line({ ending: "cancelled" })])[0]).toMatchObject({ kind: "result", status: "cancelled" });
  });

  it("still reads when the words change: the item's data names the task", () => {
    const [entry] = entriesOf([said("i1", "Theme review is finished.", noticeMetadata(notice({}), task))]);
    expect(entry).toMatchObject({ kind: "result", taskId: "task_7", status: "completed" });
  });

  it("reads a line stored before lines carried data off its words", () => {
    const [entry] = entriesOf([said("i1", noticeText(notice({}), task))]);
    expect(entry).toMatchObject({ kind: "result", taskId: "task_7", title: "Theme review" });
  });

  it("a failure that runs again is not an ending", () => {
    expect(entriesOf([line({ ending: "retried", error: "flaky" })])[0]).toMatchObject({ kind: "assistant" });
  });
});

describe("a delegate's answer that landed in the conversation as written", () => {
  it("is a result under the worker that answered, naming the task it answered", () => {
    const [entry] = entriesOf([said("i1", "Ship it.", delegateAnswerMetadata({ worker: "desk.reviewer", taskId: "task_7" }), "otto")]);
    expect(entry).toMatchObject({ kind: "result", taskId: "task_7", title: "Answer from reviewer", summary: "Ship it." });
  });

  it("is never read as the older task its words quote", () => {
    const quoted = noticeText(notice({ taskId: "task_old" }), task);
    const [entry] = entriesOf([said("i1", quoted, delegateAnswerMetadata({ worker: "desk.reviewer", taskId: "task_7" }))]);
    expect(entry).toMatchObject({ kind: "result", taskId: "task_7", title: "Answer from reviewer" });
  });

  it("is the session's own words when nothing marks it, whatever its author's name", () => {
    expect(entriesOf([said("i1", "Ship it.", undefined, "desk.reviewer")])[0]).toMatchObject({ kind: "assistant" });
  });
});
