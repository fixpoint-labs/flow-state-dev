/**
 * The lab's task changes go through the board's own calls:
 * orchestration's `inbox.board(at)` on the session that holds the board, so the
 * lab spells no task action of its own. A steer typed in a thread with no open
 * question is that client's `steer`, not a raw `updateTask` send. A coding
 * board row is drawn as the view answered it.
 */
import { describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import { appCalls } from "../src/app";
import { codingBoardTask } from "./coding-board-task";

type Sent = { flow: string; action: string; input: Record<string, unknown>; sessionId: string };

/**
 * A client whose board holds `rows`, as the coding board view answers them. A
 * send is answered by `answer`; only the board client's routine
 * (`flow.request(id).result`) can read its answer, by the request's id, so a
 * send through any other path fails. An answer to a run's stop is recorded in `answered`.
 */
function fakeClient(rows: Record<string, unknown>[], answer: (sent: Sent) => Record<string, unknown> = () => ({ ok: true }), flowId = "agent") {
  const sent: Sent[] = [];
  const answered: { flow: string; requestId: string; body: Record<string, unknown> }[] = [];
  const outputs = new Map<string, Record<string, unknown>>();
  const client = {
    sessions: {
      get: async (id: string) => ({ id, flowKind: "agent", flowId, state: {} }),
    },
    view: async () => ({ value: rows }),
    flow: (flow: string) => ({
      send: async (action: string, input: Record<string, unknown>, options: { sessionId: string }) => {
        const entry = { flow, action, input, sessionId: options.sessionId };
        sent.push(entry);
        const id = `r${sent.length}`;
        outputs.set(id, answer(entry));
        return { id };
      },
      request: (id: string) => ({
        result: async () => ({ status: "completed", output: outputs.get(id) }),
        answer: async (body: Record<string, unknown>) => void answered.push({ flow, requestId: id, body }),
      }),
    }),
  } as unknown as Client;
  return { client, sent, answered };
}

/** A review hold on the run's stop `stop`. */
const reviewHold = (stop: string) =>
  ({
    id: stop,
    source: { kind: "suspension", flowId: "coder", sessionId: "run-1", requestId: "q1", suspensionId: stop },
    ask: { kind: "review", prompt: "Accept the changes?" },
    openedAt: 1,
    answerable: true,
    unanswerable: null,
  }) as unknown as InboxHold;

/** A question `id` the task holds on its own row, answered through the board in session s1. */
const questionHold = (id: string) =>
  ({
    id,
    source: { kind: "task", flowId: "agent", sessionId: "s1", action: "updateTask_tasks", taskId: "t1" },
    ask: { kind: "question", prompt: "Which spelling?" },
    openedAt: 1,
    answerable: true,
    unanswerable: null,
  }) as unknown as InboxHold;

const RUNNING = { id: "t1", goal: "Fix the typo", status: "in_progress", attempts: 1, asks: [] };

describe("the lab's task actions", () => {
  it("sends a steer typed in a thread with no open question through the board client's steer", async () => {
    const lab = fakeClient([RUNNING]);
    await appCalls(lab.client).sayInThread("s1", codingBoardTask({ asks: [] }), "Use the British spelling.");
    expect(lab.sent).toEqual([{ flow: "agent", action: "updateTask_tasks", input: { id: "t1", message: "Use the British spelling." }, sessionId: "s1" }]);
  });

  it("answers the question the board holds now, even when the drawn row was read before it opened", async () => {
    // The screen drew the row with no question; the run has since asked one. The line answers it, not steers.
    const lab = fakeClient([{ ...RUNNING, asks: [questionHold("ask-1")] }]);
    await appCalls(lab.client).sayInThread("s1", codingBoardTask({ asks: [] }), "British.");
    expect(lab.sent).toEqual([{ flow: "agent", action: "updateTask_tasks", input: { id: "t1", answers: "ask-1", message: "British." }, sessionId: "s1" }]);
  });

  it("refuses a review verdict when the board has stopped for a newer round than the one drawn", async () => {
    // The screen drew round 1's review; the run has since answered it and stopped for round 2.
    // Accepting round 2 unseen would land work nobody read, so nothing is sent.
    const lab = fakeClient([{ ...RUNNING, asks: [reviewHold("stop-2")] }]);
    const drawn = codingBoardTask({ asks: [reviewHold("stop-1")] });
    await expect(appCalls(lab.client).resolve("s1", drawn)).rejects.toThrow(`The thread "t1" has a newer review; look it over first.`);
    await expect(appCalls(lab.client).requestChanges("s1", drawn, "Shorter, please.")).rejects.toThrow(/newer review/);
    expect(lab.answered).toEqual([]);
  });

  it("refuses a verdict when the drawn task has reached a newer round than the review stop on screen", async () => {
    // The task was read after the run stopped for round 2, but the run's feed still draws round 1's changes.
    // The drawn task and the board agree, so only the stop on screen can tell: a verdict on round 2 is one nobody saw.
    const lab = fakeClient([{ ...RUNNING, asks: [reviewHold("stop-2")] }]);
    const drawn = codingBoardTask({ asks: [reviewHold("stop-2")] });
    await expect(appCalls(lab.client).resolve("s1", drawn, undefined, "stop-1")).rejects.toThrow(/newer review/);
    await expect(appCalls(lab.client).requestChanges("s1", drawn, "Shorter, please.", "stop-1")).rejects.toThrow(/newer review/);
    expect(lab.answered).toEqual([]);
    // Once the feed draws round 2, the verdict goes to it.
    await appCalls(lab.client).resolve("s1", drawn, undefined, "stop-2");
    expect(lab.answered.map((a) => a.body.suspensionId)).toEqual(["stop-2"]);
  });

  it("answers the review round it drew while the board still holds it", async () => {
    const lab = fakeClient([{ ...RUNNING, asks: [reviewHold("stop-1")] }]);
    const drawn = codingBoardTask({ asks: [reviewHold("stop-1")] });
    await appCalls(lab.client).requestChanges("s1", drawn, "Shorter, please.");
    expect(lab.answered.map((a) => a.body.suspensionId)).toEqual(["stop-1"]);
  });

  it("refuses a review answer when the board holds no review, whatever the drawn row says", async () => {
    const lab = fakeClient([{ ...RUNNING, asks: [] }]);
    const drawn = codingBoardTask({ asks: [reviewHold("stop-1")] });
    await expect(appCalls(lab.client).resolve("s1", drawn)).rejects.toThrow(`The thread "t1" isn't waiting on your review.`);
    expect(lab.answered).toEqual([]);
  });

  it("cancels, releases and retries on the session's own board, and hands back the dependents a cancel took", async () => {
    const lab = fakeClient([RUNNING], (sent) => (sent.input.status === "cancelled" ? { ok: true, cancelled: ["t2"] } : { ok: true }));
    const actions = appCalls(lab.client).taskActions("s1");
    expect(await actions.cancel("t1")).toEqual(["t2"]);
    await actions.release("t1");
    await actions.retry("t1");
    await actions.steer("t1", "Faster, please.");
    expect(lab.sent.map((s) => [s.flow, s.sessionId, s.action, s.input])).toEqual([
      ["agent", "s1", "updateTask_tasks", { id: "t1", status: "cancelled" }],
      ["agent", "s1", "updateTask_tasks", { id: "t1", status: "pending" }],
      ["agent", "s1", "retryTask_tasks", { id: "t1" }],
      ["agent", "s1", "updateTask_tasks", { id: "t1", message: "Faster, please." }],
    ]);
  });

  it("reads the board on the instance of its flow that owns the session, not the base flow", async () => {
    const lab = fakeClient([RUNNING], undefined, "agent:desk");
    await appCalls(lab.client).taskActions("s1").steer("t1", "Faster, please.");
    expect(lab.sent.map((s) => s.flow)).toEqual(["agent:desk"]);
  });

  it("rejects with the board's own words when it refuses", async () => {
    const lab = fakeClient([RUNNING], () => ({ ok: false, error: "Task t1 is already cancelled." }));
    await expect(appCalls(lab.client).taskActions("s1").retry("t1")).rejects.toThrow("Task t1 is already cancelled.");
  });

});

