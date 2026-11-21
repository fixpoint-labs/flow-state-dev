// FIX-2848 D1.
/**
 * A task's result line (`workforce:result`) says no more than the board's
 * ending message beside it. The message is what the board already lets the
 * browser see of a task's output (a summary, cut short); a line that read the
 * output itself would put the whole of it on the client stream.
 */
import { describe, expect, it } from "vitest";
import { resultLineOf } from "../src/conversation-board/result-line";

const task = { goal: "Look up the fact", assignee: "eng.tasker" };

describe("a task's result line", () => {
  it("says the ending's message, never the task's full output", () => {
    const said = "eng.tasker finished: Look up the fact. The fact is…";
    const completed = resultLineOf({ taskId: "t1", ending: "completed", output: { answer: "secret ".repeat(400) } }, task, said);
    expect(completed?.text).toBe(said);
    const errored = resultLineOf({ taskId: "t1", ending: "errored", error: "stack ".repeat(400) }, task, said);
    expect(errored?.text).toBe(said);
  });
});
