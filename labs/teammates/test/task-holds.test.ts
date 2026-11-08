/**
 * What a coding task waits on you for, as the adapter reads it from the
 * board's row. A run's question or review only reaches the popup through
 * this read, and an answer goes where the hold says: a question to the
 * board's `updateTask` on the conversation that filed it, a run's review to
 * the run's own flow. Read wrong, the popup either shows nothing to answer or
 * sends the answer somewhere that refuses it, and the task waits forever.
 */
import { describe, expect, it } from "vitest";
import { holdsOfTasks, reviewOf, toBoardTask } from "../src/adapter";

const CONVERSATION = "sess-lead";
const RUN = "sess-run";

/** A coding task's row as the board's stream carries it, holding `holds`. */
const row = (holds: unknown[], status = "in_progress") => ({
  id: "task_1",
  title: "Fix the README typo",
  assignee: "teammates.cursor",
  status,
  run: { sessionId: RUN, requestId: "req-run" },
  holds,
});

const question = {
  id: "q1",
  actor: "user",
  openedAt: 1,
  source: { kind: "task", closedBy: [{ by: "answer" }] },
  ask: { kind: "question", prompt: "Only line 1, or every typo?" },
};
const review = {
  id: "susp-1",
  actor: "user",
  openedAt: 2,
  source: { kind: "suspension", requestId: "req-run", suspensionId: "susp-1" },
  ask: { kind: "review", prompt: "1 commit on b" },
};

const flowOf = (id: string) => ({ [CONVERSATION]: "agent", [RUN]: "teammates-coder" })[id];

describe("a task waits on you while its row holds a question or a review", () => {
  it("a question: answered on the conversation's board, through its updateTask", () => {
    const holds = holdsOfTasks(CONVERSATION, [row([question])], flowOf).get("task_1")!;
    expect(holds.map((h) => [h.ask.kind, h.source])).toEqual([
      ["question", { kind: "task", flowId: "agent", sessionId: CONVERSATION, action: "updateTask_tasks", taskId: "task_1" }],
    ]);
    expect(toBoardTask(row([question]), undefined, holds).waiting).toEqual({ kind: "question", prompt: "Only line 1, or every typo?", unanswerable: null, holdId: "q1" });
  });

  it("a review: answered on the run's own flow, at its stop", () => {
    const holds = holdsOfTasks(CONVERSATION, [row([review])], flowOf).get("task_1")!;
    expect(holds[0]!.source).toEqual({ kind: "suspension", flowId: "teammates-coder", sessionId: RUN, requestId: "req-run", suspensionId: "susp-1" });
    expect(toBoardTask(row([review]), undefined, holds).waiting).toMatchObject({ kind: "review", unanswerable: null });
  });

  it("a review whose run's flow isn't known yet still shows, and says it can't be answered yet", () => {
    const holds = holdsOfTasks(CONVERSATION, [row([review])], () => undefined).get("task_1")!;
    expect(toBoardTask(row([review]), undefined, holds).waiting?.unanswerable).toEqual(expect.any(String));
  });

  it("control: a row with no hold, or one that ended, waits on nothing", () => {
    expect(toBoardTask(row([]), undefined, []).waiting).toBeUndefined();
    expect(toBoardTask(row([review], "completed")).waiting).toBeUndefined();
  });
});

describe("a run's review is read from its latest review stop", () => {
  const stop = (commits: number) => ({ type: "suspension", kind: "review", data: { branch: "b", commits, subjects: ["Fix"], judge: null } });

  it("reads the latest: a run sent back for changes stops for review again", () => {
    expect(reviewOf([stop(1), { type: "message" }, stop(2)])?.commits).toBe(2);
  });

  it("is undefined before the run stops for review, or for a stop that isn't a review", () => {
    expect(reviewOf([{ type: "message" }])).toBeUndefined();
    expect(reviewOf([{ type: "suspension", kind: "approval", data: { branch: "b" } }])).toBeUndefined();
  });
});
