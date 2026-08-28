import { describe, expect, it } from "vitest";
import { renderBoardPlain, renderFrame, watchExitCode } from "../src/conductor/render";
import { emptyView, selectedFailure, type StatusRow } from "../src/conductor/types";
import { stripAnsi } from "../src/conductor/theme";

function beforeTranscript(frame: string): string {
  const text = stripAnsi(frame);
  const at = text.indexOf("TRANSCRIPT");
  return at < 0 ? text : text.slice(0, at);
}

const waiting: StatusRow = {
  taskId: "FIX-1--implement",
  issue: "FIX-1",
  phase: "implement",
  status: "awaiting_review",
  attempts: 1,
  feedback: null,
  run: {
    attempt: 1,
    taskId: "FIX-1--implement",
    workspacePath: "/tmp/ws",
    branch: "conductor/FIX-1--implement",
    outcome: "succeeded",
    reason: "asked",
    sessionId: "sess",
    finalMessage: null,
    usage: { inputTokens: 10, outputTokens: 4 },
    costUsd: 0.02,
    childSessionId: null,
    requestId: null,
    updatedAt: 1,
  },
  questions: [
    {
      question: "FIX-1/implement/1/q",
      text: "Which path?",
      attempt: 1,
      askedAt: 1,
    },
  ],
};

const failed: StatusRow = {
  taskId: "FAIL-1--implement",
  issue: "FAIL-1",
  phase: "implement",
  status: "pending",
  attempts: 2,
  feedback: "Not logged in · Please run /login",
  run: {
    attempt: 2,
    taskId: "FAIL-1--implement",
    workspacePath: "/tmp/ws",
    branch: "conductor/FAIL-1--implement",
    outcome: "failed",
    reason: "Not logged in · Please run /login",
    sessionId: "sess",
    finalMessage: null,
    usage: null,
    costUsd: null,
    childSessionId: null,
    requestId: null,
    updatedAt: 1,
  },
  questions: [],
};

describe("renderFrame", () => {
  it("shows the board, the selected question, and the prompt", () => {
    const frame = renderFrame(
      { ...emptyView("harness-manager"), rows: [waiting], lastRefreshAt: Date.parse("2026-08-28T12:00:00Z") },
      { cols: 80, rows: 24 },
    );
    expect(frame).toContain("FSDEV CONDUCTOR");
    expect(frame).toContain("FIX-1");
    expect(frame).toContain("awaiting_review");
    expect(beforeTranscript(frame)).toContain("Which path?");
    expect(beforeTranscript(frame)).toMatch(/\bASK\b/);
    expect(stripAnsi(frame)).toContain("succeeded");
    expect(stripAnsi(frame)).not.toMatch(/succeed…Which/);
    expect(frame).toContain("1 waiting");
    expect(frame).toContain("click/j/k select");
    expect(frame).toContain("TRANSCRIPT");
  });

  it("fills leftover rows with the transcript and PageUp looks further back", () => {
    const activity = Array.from({ length: 30 }, (_, i) => ({ at: i, text: `line-${i}` }));
    const follow = renderFrame(
      { ...emptyView("epic"), rows: [waiting], activity, scroll: 0 },
      { cols: 80, rows: 24 },
    );
    expect(follow).toContain("line-29");
    expect(follow).not.toContain("line-0");
    expect(follow).toContain("follow");

    const back = renderFrame(
      { ...emptyView("epic"), rows: [waiting], activity, scroll: 200 },
      { cols: 80, rows: 24 },
    );
    expect(back).toContain("line-0");
    expect(back).not.toContain("line-29");
    expect(back).toContain("back");
  });

  it("shows the live line at the tail while following, and hides it when scrolled back", () => {
    const follow = renderFrame(
      {
        ...emptyView("epic"),
        rows: [waiting],
        live: "status · claiming ASK-1",
        activity: [{ at: 1, text: "ASK-1 · pending" }],
      },
      { cols: 80, rows: 24 },
    );
    expect(follow).toContain("status · claiming ASK-1");
    expect(follow).toContain("live");

    const back = renderFrame(
      {
        ...emptyView("epic"),
        rows: [waiting],
        live: "status · claiming ASK-1",
        activity: Array.from({ length: 30 }, (_, i) => ({ at: i, text: `line-${i}` })),
        scroll: 200,
      },
      { cols: 80, rows: 24 },
    );
    expect(back).not.toContain("status · claiming ASK-1");
    expect(back).toContain("back");
  });

  it("keeps the question above the transcript even when the log is long", () => {
    const activity = Array.from({ length: 40 }, (_, i) => ({ at: i, text: `wake-line-${i}` }));
    const frame = renderFrame(
      { ...emptyView("epic"), rows: [waiting], activity },
      { cols: 80, rows: 24 },
    );
    expect(beforeTranscript(frame)).toContain("Which path?");
    expect(beforeTranscript(frame)).toMatch(/\bASK\b/);
    expect(frame).toContain("wake-line-39");
  });

  it("gives a live wake more transcript rows than an idle board", () => {
    const running = { ...waiting, status: "in_progress", questions: [] };
    const activity = Array.from({ length: 40 }, (_, i) => ({ at: i, text: `wake-line-${i}` }));
    const idle = renderFrame(
      { ...emptyView("epic"), rows: [running], activity, busy: false },
      { cols: 80, rows: 24 },
    );
    const working = renderFrame(
      { ...emptyView("epic"), rows: [running], activity, busy: true, live: "status · running" },
      { cols: 80, rows: 24 },
    );
    const idleHits = idle.split("wake-line-").length - 1;
    const workingHits = working.split("wake-line-").length - 1;
    expect(workingHits).toBeGreaterThan(idleHits);
  });

  it("keeps a failed attempt above the transcript even when the log is long", () => {
    const activity = Array.from({ length: 40 }, (_, i) => ({ at: i, text: `wake-line-${i}` }));
    const frame = renderFrame(
      { ...emptyView("epic"), rows: [failed], activity },
      { cols: 80, rows: 24 },
    );
    const above = beforeTranscript(frame);
    expect(above).toContain("Not logged in");
    expect(above).toMatch(/\bFAIL\b/);
    expect(above).not.toMatch(/\bASK\b/);
    expect(stripAnsi(frame)).toContain("1 failed");
    expect(stripAnsi(frame)).toContain("w retry");
    expect(frame).toContain("wake-line-39");
  });

  it("lets an open question win when the same row also failed", () => {
    const both: StatusRow = {
      ...failed,
      questions: [
        {
          question: "FAIL-1/implement/1/q",
          text: "Which path?",
          attempt: 1,
          askedAt: 1,
        },
      ],
    };
    const frame = renderFrame({ ...emptyView("epic"), rows: [both] }, { cols: 80, rows: 24 });
    const above = beforeTranscript(frame);
    expect(above).toMatch(/\bASK\b/);
    expect(above).toContain("Which path?");
    expect(above).not.toMatch(/\bFAIL\b/);
    expect(selectedFailure({ ...emptyView("epic"), rows: [both] })).toBeUndefined();
  });
});

describe("renderBoardPlain / watchExitCode", () => {
  it("prints questions under the row they belong to", () => {
    const text = renderBoardPlain([waiting], false);
    expect(text).toContain("FIX-1");
    expect(text).toContain("FIX-1/implement/1/q");
    expect(text).toContain("Which path?");
  });

  it("uses 2 when a person has something to answer, 0 when every row completed", () => {
    expect(watchExitCode([waiting])).toBe(2);
    expect(watchExitCode([{ ...waiting, status: "completed", questions: [] }])).toBe(0);
    expect(watchExitCode([])).toBe(1);
  });

  it("uses 1 when the last attempt failed, even if the row is still pending", () => {
    expect(watchExitCode([failed])).toBe(1);
    expect(watchExitCode([{ ...failed, status: "errored" }])).toBe(1);
    const text = renderBoardPlain([failed], false);
    expect(text).toContain("FAIL-1");
    expect(text).toContain("! failed");
    expect(text).toContain("Not logged in");
  });
});
