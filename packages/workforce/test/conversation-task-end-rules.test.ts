/**
 * What else holds a task session's task open (FIX-2077, rule 6), as Workforce
 * answers it: its pieces on the session's own board, and a message for the
 * session it hasn't acted on.
 *
 * Why it matters: each answer decides when the filer hears "done". A piece
 * the rule misses settles the task while that piece still runs; a message the
 * rule counts forever (one from an attempt before this one) keeps the task
 * open forever.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { describe, expect, it } from "vitest";
import { piecesHold, conversationEndRules } from "../src/conversation-board/task-admission";
import { PIECE_OF } from "../src/conversation-board/board-entries";
import { WORKER_MESSAGES_SEEN_STATE } from "../src/messages/keys";
import { WORKER_MESSAGES_RESOURCE, type WorkerMessageRow } from "../src/messages/log-row";

const SESSION = "task-session";

function row(id: string, patch: Partial<Task>): Task {
  return { id, goal: id, status: "pending", attempts: 0, createdAt: 1, updatedAt: 1, ...patch } as Task;
}

/** A board that lists its rows, filtering on `filedByTask` the way the real one does. */
function boardOf(rows: Task[]): TaskCollectionRef {
  return {
    list: (filter?: { filedByTask?: string }) =>
      rows.filter((task) => filter?.filedByTask === undefined || task.filedByTask === filter.filedByTask)
  } as unknown as TaskCollectionRef;
}

function message(id: string, at: number, patch: Partial<WorkerMessageRow> = {}): { state: WorkerMessageRow } {
  return {
    state: {
      id,
      from: "a",
      to: "b",
      text: "hi",
      exchange: id,
      fromSession: "elsewhere",
      fromFlow: "f",
      toSession: SESSION,
      toFlow: "f",
      answerTo: { sessionId: "elsewhere", flow: "f" },
      hop: 1,
      status: "delivered",
      at,
      ...patch
    }
  };
}

function ctxWith(messages: Array<{ state: WorkerMessageRow }>, seen: string[] = []): BlockContext {
  return {
    resources: { [WORKER_MESSAGES_RESOURCE]: { list: async () => messages } },
    session: { identity: { id: SESSION }, state: { [WORKER_MESSAGES_SEEN_STATE]: seen } }
  } as unknown as BlockContext;
}

const task = row("t", {
  status: "in_progress",
  attempts: 2,
  run: { sessionId: SESSION, requestId: "r2", attempt: 2, startedAt: 5_000 }
});

describe("what holds a task session's task", () => {
  it("a piece stamped only with the task it is for (a row stored before filedByTask) holds the task while it is open", () => {
    const done = row("p1", { status: "completed", metadata: { [PIECE_OF]: "t" } });
    const open = row("p2", { status: "in_progress", metadata: { [PIECE_OF]: "t" } });

    expect(piecesHold(boardOf([done, open]), "t")).toBe(true);
    expect(piecesHold(boardOf([done]), "t")).toBe(false);
    // Another task's piece holds nothing here.
    expect(piecesHold(boardOf([row("p3", { status: "in_progress", metadata: { [PIECE_OF]: "other" } })]), "t")).toBe(false);
  });

  it("a delivered message the session hasn't acted on holds the task, but only one sent during this attempt", async () => {
    const queued = conversationEndRules.workQueued!;

    expect(await queued(ctxWith([message("m-now", 6_000)]), task)).toBe(true);
    // Sent before this attempt started: a retry is not held by its earlier attempt's message.
    expect(await queued(ctxWith([message("m-old", 4_000)]), task)).toBe(false);
    // Acted on, refused, or for another session: nothing queued.
    expect(await queued(ctxWith([message("m-now", 6_000)], ["m-now"]), task)).toBe(false);
    expect(await queued(ctxWith([message("m-now", 6_000, { status: "refused" })]), task)).toBe(false);
    expect(await queued(ctxWith([message("m-now", 6_000, { toSession: "other" })]), task)).toBe(false);
  });

  it("a row whose run link carries no start time (linked before it did) counts every message it hasn't acted on", async () => {
    const legacy = row("t", { status: "in_progress", run: { sessionId: SESSION, requestId: "r1", attempt: 1 } });

    expect(await conversationEndRules.workQueued!(ctxWith([message("m-old", 4_000)]), legacy)).toBe(true);
  });
});
