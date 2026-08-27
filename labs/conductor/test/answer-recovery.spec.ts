/**
 * The recovery rule, arm by arm.
 *
 * `answer` commits in three places — patch the row, `resumeFromReview`, drain —
 * and the drain commits in two more, so the sequence has four commit points and
 * a crash at any of them leaves a durable prefix. This drives `decideAnswer`
 * directly because each arm is a *state of the world at one instant*: a row
 * already `answered` beside a task at a particular status with a lease at a
 * particular age. Reaching those through a live board would mean racing a lease
 * renewal to reproduce each one, and the arm that matters most — a live claim
 * versus an abandoned one — is invisible from status alone.
 *
 * **The clock is injected**, which is the point. A lease is a comparison and a
 * comparison needs one clock: reading `Date.now()` instead works right up until
 * the collection is built on another, at which point a live task reads as
 * abandoned and an abandoned one as live. That divergence is only visible under
 * an injected clock — so a lease test that does not inject one is exactly the
 * test you least want to be wrong.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { decideAnswer, type AnswerBoard, type AnswerOutput } from "../src/answer";
import { askQuestion, answerQuestion, questionFingerprint, questionTopic, readQuestion } from "../src/inbox";
import { conductorTaskId } from "../src/workspace";
import { contextWithInbox, fakeInbox } from "./inbox-fake";

const ISSUE = "FIX-1166";
const PHASE = "implement";
const TASK_ID = conductorTaskId(ISSUE, PHASE);

/** A frozen "now", so a lease is either past it or not, with no wall clock. */
const NOW = 1_700_000_000_000;

function topicFor(question: string, attempt: number): string {
  return questionTopic(ISSUE, PHASE, attempt, questionFingerprint(question));
}

/** The board as this decision reads it, plus a record of what it was asked to do. */
function fakeBoard(task: {
  status: string;
  leaseUntil?: number;
  /**
   * Present only so a test can stage a counter far from where any offset
   * condition would put it. **`decideAnswer` never reads it** — that is the
   * property under test, not an oversight.
   */
  attempts?: number;
  abandonments?: number;
} | undefined) {
  const resumed: string[] = [];
  const board: AnswerBoard = {
    get: () => task,
    resumeFromReview: async (id) => {
      resumed.push(id);
    },
    now: () => NOW,
  };
  return { board, resumed };
}

/** Stage a question that has already been answered — the durable prefix. */
async function stageAnswered(
  question = "which path?",
  attempt = 1,
): Promise<{ ctx: BlockContext; topic: string }> {
  const inbox = fakeInbox();
  const ctx = contextWithInbox(inbox);
  const topic = topicFor(question, attempt);
  await askQuestion(ctx, topic, { question, askedBy: TASK_ID, askedAt: NOW - 1_000 });
  await answerQuestion(ctx, topic, "the durable answer");
  return { ctx, topic };
}

async function answerAgain(
  ctx: BlockContext,
  board: AnswerBoard,
  topic: string,
): Promise<AnswerOutput> {
  return decideAnswer(ctx, board, { question: topic, answer: "a second attempt at answering" });
}

describe("recovery — the three restartable prefixes", () => {
  it("resumes and drains when the crash landed between the patch and the resume", async () => {
    // The case a status PAIR missed. Written as "(answered, pending)" the rule
    // never named "(answered, parked)" — and that state parks the task forever
    // holding an answer the operator watched land.
    const { ctx, topic } = await stageAnswered();
    const { board, resumed } = fakeBoard({ status: "awaiting_review", attempts: 1 });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("recovered");
    expect(outcome.drained).toBe(true);
    expect(resumed).toEqual([TASK_ID]);
  });

  it("drains ONLY when the crash landed between the resume and the drain", async () => {
    // `resumeFromReview` only re-queues, and `onReview: "exit"` already ended
    // the drain that saw the question — so nothing is left to run it.
    const { ctx, topic } = await stageAnswered();
    const { board, resumed } = fakeBoard({ status: "pending", attempts: 2 });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("recovered");
    expect(outcome.drained).toBe(true);
    // Never re-queued: the row is already `pending`, and re-queueing it would
    // be a second transition on a task that has already made this one.
    expect(resumed).toEqual([]);
  });

  it("drains when the crash landed after the CLAIM, leaving an abandoned lease", async () => {
    // The fourth commit point. The claim advances `attempts` and takes the row
    // `in_progress` before the hand-off is attempted, and a hand-off that threw
    // leaves nothing owning the row — it simply sits until its lease lapses.
    // Without this arm the answer is durable, `attempts` has moved, and no
    // drain remains to run it: the outcome this whole design exists to prevent,
    // arriving through the machinery built to prevent it.
    const { ctx, topic } = await stageAnswered();
    const { board, resumed } = fakeBoard({
      status: "in_progress",
      leaseUntil: NOW - 1,
      attempts: 2,
    });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("recovered");
    expect(outcome.drained).toBe(true);
    expect(resumed).toEqual([]);
  });

  it("never re-patches the row on any arm", async () => {
    // The rule reads a durable patch and restarts from it. Re-patching would
    // overwrite the answer the operator actually gave with whatever the
    // re-running caller happened to send.
    for (const task of [
      { status: "awaiting_review" },
      { status: "pending" },
      { status: "in_progress", leaseUntil: NOW - 1 },
    ]) {
      const { ctx, topic } = await stageAnswered();
      const { board } = fakeBoard(task);
      await answerAgain(ctx, board, topic);
      const row = await readQuestion(ctx, topic);
      expect(row?.answer).toBe("the durable answer");
      expect(row?.status).toBe("answered");
    }
  });
});

describe("recovery — the condition names no counter", () => {
  it("recovers with `attempts` TWO beyond the row, after two abandoned hand-offs", async () => {
    // **A suite that stages ONE failure passes with an offset condition in
    // place**, which is the bug this exists to catch. Every claim advances
    // `attempts` — including each lease-lapse reclaim — while the open question
    // does not change, so any counter form ("equal", "one behind", "N behind")
    // survives a bounded number of abandoned hand-offs and then strands the
    // answer for good.
    const { ctx, topic } = await stageAnswered();
    const { board } = fakeBoard({
      status: "in_progress",
      leaseUntil: NOW - 1,
      attempts: 3,
      abandonments: 2,
    });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("recovered");
    expect(outcome.drained).toBe(true);
  });

  it("still recovers at the substrate's abandonment bound, while the row is not yet terminal", async () => {
    // **Stage the bound where it actually falls.** `abandonments` increments on
    // the RECLAIM, so after the fourth failed hand-off the row is `in_progress`
    // with `abandonments: 3` and is NOT yet terminal — the NEXT drain is what
    // settles it. Staging settlement one invocation early passes against an
    // implementation that never drains at the bound at all.
    const { ctx, topic } = await stageAnswered();
    const { board } = fakeBoard({
      status: "in_progress",
      leaseUntil: NOW - 1,
      attempts: 5,
      abandonments: 3,
    });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("recovered");
    expect(outcome.drained).toBe(true);
  });

  it("declines once that drain has settled the row terminal", async () => {
    // Past the bound the drain settles the row `errored` with the answer
    // recorded against it, and the arm then declines like any other terminal
    // task. **Guaranteed recovery past that bound is not this rule's to grow** —
    // it is the atomic verb FIX-1244 owns, where the answer and the new request
    // are one write and there is no reclaim to exhaust.
    const { ctx, topic } = await stageAnswered();
    const { board, resumed } = fakeBoard({ status: "errored", attempts: 6, abandonments: 3 });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("declined");
    expect(outcome.reason).toBe("task-terminal");
    expect(outcome.drained).toBe(false);
    expect(resumed).toEqual([]);
  });
});

describe("recovery — live versus abandoned, which is the whole third arm", () => {
  it("DECLINES and dispatches nothing when the lease is still live", async () => {
    // **The negative arm, and the one that matters.** A suite without it passes
    // with an action that drains every `in_progress` and resumes a run that is
    // still working — which is a worse failure than the one the arm closes, and
    // is not recoverable the way a stranded answer is.
    const { ctx, topic } = await stageAnswered();
    const { board, resumed } = fakeBoard({
      status: "in_progress",
      leaseUntil: NOW + 60_000,
      attempts: 2,
    });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("declined");
    expect(outcome.reason).toBe("run-live");
    expect(outcome.drained).toBe(false);
    expect(resumed).toEqual([]);
  });

  it("reads an ABSENT lease as live and declines", async () => {
    // BP-030: rows persisted before leases shipped, and rows never claimed. The
    // conservative direction is the safe one and it is deliberate — the arm
    // refuses whenever it cannot PROVE abandonment.
    const { ctx, topic } = await stageAnswered();
    const { board } = fakeBoard({ status: "in_progress", attempts: 2 });

    const outcome = await answerAgain(ctx, board, topic);

    expect(outcome.result).toBe("declined");
    expect(outcome.reason).toBe("run-live");
  });

  it("judges the lease against the COLLECTION's clock, not the wall clock", async () => {
    // A lease one millisecond in the collection's future is live even though it
    // is decades in the wall clock's past. An implementation reading
    // `Date.now()` calls this abandoned and resumes a run that is still
    // working.
    const { ctx, topic } = await stageAnswered();
    const { board } = fakeBoard({ status: "in_progress", leaseUntil: NOW + 1 });

    expect((await answerAgain(ctx, board, topic)).reason).toBe("run-live");

    const { ctx: ctx2, topic: topic2 } = await stageAnswered();
    const { board: board2 } = fakeBoard({ status: "in_progress", leaseUntil: NOW });
    // Exactly at the clock counts as lapsed — the boundary is stated rather
    // than left to whichever comparison happened to be written.
    expect((await answerAgain(ctx2, board2, topic2)).result).toBe("recovered");
  });
});

describe("recovery — what it refuses outright", () => {
  it("declines when the board has no such task", async () => {
    const { ctx, topic } = await stageAnswered();
    const { board } = fakeBoard(undefined);
    const outcome = await answerAgain(ctx, board, topic);
    expect(outcome.result).toBe("declined");
    expect(outcome.reason).toBe("unknown-task");
  });

  it("declines a question nothing ever asked, without touching the board", async () => {
    const inbox = fakeInbox();
    const ctx = contextWithInbox(inbox);
    const { board, resumed } = fakeBoard({ status: "awaiting_review" });
    const outcome = await decideAnswer(ctx, board, {
      question: topicFor("never asked", 1),
      answer: "into the void",
    });
    expect(outcome.result).toBe("declined");
    expect(outcome.reason).toBe("unknown-question");
    expect(resumed).toEqual([]);
  });
});
