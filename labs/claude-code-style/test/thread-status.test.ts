/**
 * A thread's status line once its task has settled. The board keeps a
 * task's last progress note after it settles, and a harness run's notes are
 * its tool calls, so a settled card that showed the note read as whatever
 * the run happened to do last: a failed push the agent then retried, as
 * `Failed · Bash: git push …`. A settled line says how the task ended: why
 * it failed, from the board's error, and never a running note.
 */
import { describe, expect, it } from "vitest";
import type { TaskRow } from "../src/adapter";
import { rowNote, statusLine } from "../src/components/ThreadStatus";

/** The note a harness run leaves on the row: its last tool call. */
const LAST_TOOL_CALL = "Bash: git push -u origin feat/claude-code-style-sheet";

const taskRow = (patch: Partial<TaskRow>): TaskRow => ({
  id: "t",
  title: "Align task info to flyout popup",
  goal: "g",
  status: "errored",
  statusNote: LAST_TOOL_CALL,
  ...patch,
});

describe("statusLine on a settled task", () => {
  it("says why a failed task failed, not its last tool call", () => {
    const line = statusLine(taskRow({ error: "The run's checks failed: typecheck" }));
    expect(line).toBe("Failed · The run's checks failed: typecheck");
  });

  it("reads only the error's first line, so a card stays one line", () => {
    const line = statusLine(taskRow({ error: "\nRun ended errored:\n  at harness (run.ts:12)\n" }));
    expect(line).toBe("Failed · Run ended errored:");
  });

  it("says only Failed when the board recorded no error, never the last tool call", () => {
    expect(statusLine(taskRow({}))).toBe("Failed");
  });

  it("drops the last tool call from a resolved or cancelled task", () => {
    expect(statusLine(taskRow({ status: "completed" }))).toBe("Resolved");
    expect(statusLine(taskRow({ status: "cancelled" }))).toBe("Cancelled");
  });

  it("still shows the latest note while the task works", () => {
    expect(statusLine(taskRow({ status: "in_progress" }))).toBe(`Working · ${LAST_TOOL_CALL}`);
  });
});

describe("rowNote on a settled task", () => {
  it("leaves a resolved row's note empty, never its last tool call", () => {
    expect(rowNote(taskRow({ status: "completed" }))).toBe("");
  });

  it("says why a failed row failed", () => {
    expect(rowNote(taskRow({ error: "Push declined by a pre-receive hook" }))).toBe("Failed · Push declined by a pre-receive hook");
  });

  it("still shows the latest note while the task works", () => {
    expect(rowNote(taskRow({ status: "in_progress" }))).toBe(LAST_TOOL_CALL);
  });
});
