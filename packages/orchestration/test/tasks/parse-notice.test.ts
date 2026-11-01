/**
 * A notice's line, read back as data (FIX-2378): `noticeMetadata` is what the
 * line's message item carries, and `parseNotice` reads it. An app reads which
 * task ended and how from the item, so a change to `noticeText`'s words can't
 * break it. A line stored before the item carried the data is read off its
 * words, by the parser that sits beside the function that writes them.
 */
import { describe, expect, it } from "vitest";
import {
  NOTICE_ITEM_KEY,
  noticeMetadata,
  noticeText,
  parseNotice,
  type TaskNotice
} from "../../src/tasks/notice/task-notice";

const task = { goal: "Count licenses", title: "License count", assignee: "eng.tasker" };

const notice = (patch: Partial<TaskNotice>): TaskNotice => ({
  boardId: "conversation",
  taskId: "task_abc",
  attempt: 1,
  ending: "completed",
  ...patch
});

/** A message item as the conversation stores the line: its words, and the data beside them when emitted with it. */
const item = (text: string, metadata?: Record<string, unknown>) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
  ...(metadata !== undefined ? { metadata } : {})
});

describe("a notice's line carries its notice as data", () => {
  it.each<[string, Partial<TaskNotice>, Record<string, unknown>]>([
    ["a completion, with what came back", { ending: "completed", output: { licenses: 12 } }, { detail: '{"licenses":12}' }],
    ["a final failure, with its error", { ending: "errored", error: "no network" }, { detail: "no network" }],
    ["a failure that runs again", { ending: "retried", attempt: 2, error: "flaky" }, { attempt: 2, detail: "flaky" }],
    ["a cancel, naming what it cancelled", { ending: "cancelled", cancelled: ["task_b", "task_c"] }, { cancelled: ["task_b", "task_c"] }]
  ])("%s", (_label, patch, expected) => {
    const n = notice(patch);
    const parsed = parseNotice(item(noticeText(n, task), noticeMetadata(n, task)));
    expect(parsed).toEqual({
      boardId: "conversation",
      taskId: "task_abc",
      attempt: 1,
      ending: n.ending,
      title: "License count",
      ...expected
    });
  });

  it("is read off the data, not the words: a line whose wording changed still names its task and ending", () => {
    const n = notice({ ending: "errored", error: "no network" });
    const reworded = item("License count didn't make it (no network).", noticeMetadata(n, task));
    expect(parseNotice(reworded)).toMatchObject({ taskId: "task_abc", ending: "errored", detail: "no network" });
  });

  it("names a row with no title by its goal", () => {
    const n = notice({});
    expect(noticeMetadata(n, { goal: "Count licenses" })[NOTICE_ITEM_KEY].title).toBe("Count licenses");
  });
});

describe("a line stored before its item carried the data is read off its words", () => {
  it.each<[string, Partial<TaskNotice>, Record<string, unknown>]>([
    ["a completion", { ending: "completed", output: "12 licenses" }, { detail: "12 licenses" }],
    ["a final failure", { ending: "errored", error: "no network" }, { detail: "no network" }],
    [
      "a final failure that cancelled its dependents",
      { ending: "errored", error: "no network", cancelled: ["task_b"] },
      { detail: "no network", cancelled: ["task_b"] }
    ],
    ["a failure that runs again", { ending: "retried", error: "flaky" }, { detail: "flaky" }],
    ["a cancel", { ending: "cancelled" }, {}],
    ["a cancel that cancelled its dependents", { ending: "cancelled", cancelled: ["task_b", "task_c"] }, { cancelled: ["task_b", "task_c"] }]
  ])("%s, exactly as noticeText wrote it", (_label, patch, expected) => {
    const n = notice(patch);
    expect(parseNotice(item(noticeText(n, task)))).toEqual({ taskId: "task_abc", ending: n.ending, title: "License count", ...expected });
  });

  it("is not a notice when the words aren't a notice's", () => {
    expect(parseNotice(item("Here's the license count: 12."))).toBeUndefined();
  });
});

describe("only a notice's line is a notice", () => {
  it("a user's message quoting a notice's words is not one", () => {
    const words = noticeText(notice({}), task);
    expect(parseNotice({ ...item(words), role: "user" })).toBeUndefined();
  });

  it("another item type is not one", () => {
    expect(parseNotice({ type: "tool_output", metadata: noticeMetadata(notice({}), task) })).toBeUndefined();
  });

  it("a line marked as something else is not read as a notice, even when it quotes one", () => {
    // A delegate's answer that repeats an older task's ending names the task it answered in its own
    // data; reading its words would tie it to the quoted task instead.
    const quoted = noticeText(notice({ taskId: "task_old" }), task);
    expect(parseNotice(item(quoted, { delegateAnswer: { worker: "otto", taskId: "task_new" } }))).toBeUndefined();
  });

  it("malformed data is not a notice, and is not read as its words instead", () => {
    const words = noticeText(notice({}), task);
    expect(parseNotice(item(words, { [NOTICE_ITEM_KEY]: { taskId: "task_abc" } }))).toBeUndefined();
  });
});
