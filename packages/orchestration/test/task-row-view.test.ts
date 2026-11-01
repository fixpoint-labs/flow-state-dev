/**
 * The task-row view (`taskRowView`, FIX-2379): the one status and *waiting on
 * you* vocabulary every workforce app reads a row through.
 *
 * The bug it exists to remove is a row that waits on the user reading as
 * running (or held) because a screen mapped the stored status alone. So the
 * cases that matter are a non-terminal row with an open user hold, in each
 * status, and the same row once the hold is answered. The control at the end
 * runs those cases through the status-only mapping a lab shipped, and they fail.
 */
import { describe, expect, it } from "vitest";
import { inboxItems, taskRowView, type TaskViewRow } from "../src/inbox";
import type { TaskHold } from "../src/tasks";

const BOARD = "s_desk.tasks";

const question = (id = "q1", prompt = "Which region?"): TaskHold => ({
  id,
  actor: "user",
  openedAt: 200,
  source: { kind: "row", closedBy: [{ by: "answer" }] },
  ask: { kind: "question", prompt },
});

const stop = (requestId: string, suspensionId: string, openedAt = 100): TaskHold => ({
  id: suspensionId,
  actor: "user",
  openedAt,
  source: { kind: "suspension", requestId, suspensionId },
  ask: { kind: "review", prompt: "Review the run's changes", title: "Review" },
});

const row = (over: Partial<TaskViewRow> = {}): TaskViewRow => ({
  board: BOARD,
  id: "t1",
  title: "Fix the export",
  goal: "Fix the export button",
  assignee: "desk.coder",
  status: "in_progress",
  ...over,
});

describe("taskRowView: one display state per row", () => {
  it.each([
    ["pending", "queued"],
    ["held", "held"],
    ["in_progress", "running"],
    ["completed", "done"],
    ["errored", "failed"],
    ["cancelled", "cancelled"],
  ] as const)("a %s row with nothing waiting reads %s", (status, state) => {
    expect(taskRowView(row({ status })).state).toBe(state);
  });

  it("reads a legacy blocked row as held, the same as the board", () => {
    const view = taskRowView(row({ status: "blocked" }));
    expect(view).toMatchObject({ status: "held", state: "held" });
  });

  it("keeps a stored word it doesn't know on status, and reads it queued, never hidden", () => {
    expect(taskRowView(row({ status: "paused" }))).toMatchObject({ status: "paused", state: "queued" });
  });
});

describe("taskRowView: a row that waits on the user says so, whatever its status", () => {
  it.each(["in_progress", "held", "pending"] as const)("a %s row holding a question reads waiting, with the question", (status) => {
    const view = taskRowView(row({ status, holds: [question()] }));
    expect(view.state).toBe("waiting");
    expect(view.hold?.ask).toMatchObject({ kind: "question", prompt: "Which region?" });
  });

  it("goes back to its status once the question is answered", () => {
    const answered = { holds: [question()], steers: [{ id: "st1", answers: "q1" }] };
    expect(taskRowView(row({ status: "in_progress", ...answered })).state).toBe("running");
    expect(taskRowView(row({ status: "held", ...answered })).state).toBe("held");
  });

  it("does not wait on the user for a system hold", () => {
    const system: TaskHold = { ...question(), actor: "system" };
    expect(taskRowView(row({ holds: [system] }))).toMatchObject({ state: "running", hold: null });
  });

  it("is terminal on a terminal row, whatever a stale hold says", () => {
    const view = taskRowView(row({ status: "completed", holds: [question()] }));
    expect(view).toMatchObject({ state: "done", hold: null, holds: [] });
  });

  it("names the oldest open hold, and lists them all oldest first", () => {
    const view = taskRowView(row({ run: { sessionId: "run_t1", requestId: "req_t1" }, holds: [question(), stop("req_t1", "sus_1", 100)] }));
    expect(view.hold?.ask).toMatchObject({ kind: "review", title: "Review" });
    expect(view.holds.map((hold) => hold.id)).toEqual(["sus_1", "q1"]);
  });

  it("without the Inbox's holds, says it can't be answered from here", () => {
    expect(taskRowView(row({ holds: [question()] })).hold?.answerable).toBe(false);
  });

  it("takes the Inbox item's holds when given: a stop found in the open run before the row records it", () => {
    const r = row({ run: { sessionId: "run_t1", requestId: "req_t1" }, holds: [], holder: { sessionId: "s_desk", action: "updateTask_tasks" } });
    const [item] = inboxItems({
      rows: [r],
      suspensions: [{ sessionId: "run_t1", flowId: "coder", requestId: "req_t1", suspensionId: "sus_9", kind: "review", prompt: "Look?", since: 300, detail: { branch: "fix/export" } }],
      flowOf: () => "coder",
    });
    expect(taskRowView(r).state).toBe("running");
    const view = taskRowView(r, item!.holds);
    expect(view.state).toBe("waiting");
    expect(view.hold).toMatchObject({ ask: { kind: "review", prompt: "Look?" }, answerable: true, detail: { branch: "fix/export" } });
  });
});

describe("taskRowView: what else a screen draws", () => {
  it("carries spend, harness, model and times", () => {
    const spend = {
      requests: [
        {
          requestId: "req_t1",
          settled: [{ source: "claude-code", kind: "harness", inputTokens: 10, outputTokens: 5, runs: 1 }],
          live: null,
          harness: "claude-code",
          harnessModel: "opus",
          model: null,
        },
      ],
    };
    const view = taskRowView(row({ status: "completed", spend: spend as never, createdAt: 1, updatedAt: 4, startedAt: 2, completedAt: 3, error: null, statusNote: "done" }));
    expect(view).toMatchObject({ harness: "claude-code", model: "opus", spend: { inputTokens: 10, outputTokens: 5, live: false }, statusNote: "done" });
    expect(view.times).toEqual({ createdAt: 1, updatedAt: 4, startedAt: 2, completedAt: 3 });
  });

  it("keeps the spend listTasks already folded, rather than folding it again to nothing", () => {
    const published = { harness: "codex", model: "gpt", inputTokens: 7, outputTokens: 3, unreported: false, live: true };
    expect(taskRowView(row({ spend: published })).spend).toEqual(published);
    expect(taskRowView(row({ spend: published }))).toMatchObject({ harness: "codex", model: "gpt" });
  });

  it("reads a malformed stored spend as none, never a throw", () => {
    expect(taskRowView(row({ spend: { requests: "nope" } as never })).spend).toBeNull();
  });

  it("titles a row by its title, else its goal, else its id", () => {
    expect(taskRowView(row({ title: null })).title).toBe("Fix the export button");
    expect(taskRowView(row({ title: null, goal: null })).title).toBe("t1");
  });
});

describe("control: the status-only mapping fails the waiting cases", () => {
  // The mapping the Teammates lab shipped: every status but the terminal three reads running.
  const statusOnly = (r: TaskViewRow) =>
    r.status === "completed" ? "done" : r.status === "errored" ? "failed" : r.status === "cancelled" ? "cancelled" : "running";

  it.each(["in_progress", "held"] as const)("a %s row holding a question is not waiting under it", (status) => {
    const r = row({ status, holds: [question()] });
    expect(statusOnly(r)).not.toBe("waiting");
    expect(taskRowView(r).state).toBe("waiting");
  });
});
