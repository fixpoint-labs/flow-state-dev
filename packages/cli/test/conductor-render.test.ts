import { describe, expect, it } from "vitest";
import { renderBoardPlain, renderFrame, watchExitCode } from "../src/conductor/render";
import { emptyView, type StatusRow } from "../src/conductor/types";

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

describe("renderFrame", () => {
  it("shows the board, the selected question, and the prompt", () => {
    const frame = renderFrame(
      { ...emptyView("harness-manager"), rows: [waiting], lastRefreshAt: Date.parse("2026-08-28T12:00:00Z") },
      { cols: 80, rows: 24 },
    );
    expect(frame).toContain("FSDEV CONDUCTOR");
    expect(frame).toContain("FIX-1");
    expect(frame).toContain("awaiting_review");
    expect(frame).toContain("Which path?");
    expect(frame).toContain("1 waiting");
    expect(frame).toContain("click/j/k select");
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
});
