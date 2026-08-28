import { describe, expect, it } from "vitest";
import { renderBoardPlain, renderFrame, watchExitCode } from "../src/conductor/render";
import { emptyView, selectedFailure, type StatusRow } from "../src/conductor/types";
import { RUST, TEAL, stripAnsi } from "../src/conductor/theme";

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
    expect(stripAnsi(frame)).toContain("10→4");
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

    const held = renderFrame(
      {
        ...emptyView("epic"),
        rows: [waiting],
        live: "tool · Bash pnpm test",
        activity: [{ at: 1, text: "tool · Bash pnpm test" }],
      },
      { cols: 80, rows: 24 },
    );
    expect(stripAnsi(held).match(/tool · Bash pnpm test/g)?.length).toBe(1);
    expect(held).toContain("live");

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

  it("leaves the running transcript room by not repeating the checkout under the RUN band", () => {
    const runningRow: StatusRow = {
      ...waiting,
      status: "in_progress",
      questions: [],
      run: {
        ...waiting.run!,
        outcome: "running",
        reason: null,
        requestId: "req-live-1",
        workspacePath: "/tmp/conductor-src/.fsdev/workspaces/LIVE-1--implement",
        branch: "conductor/LIVE-1--implement",
        usage: { inputTokens: 12_000, outputTokens: 400 },
      },
    };
    const activity = Array.from({ length: 40 }, (_, i) => ({ at: i, text: `wake-line-${i}` }));
    const frame = renderFrame(
      { ...emptyView("epic"), rows: [runningRow], activity },
      { cols: 80, rows: 24 },
    );
    const above = beforeTranscript(frame);
    expect(above).toMatch(/^ RUN\s*$/m);
    expect(above).toContain("12.0k→400");
    expect(above).not.toContain("none open");
    expect(above.match(/conductor\/LIVE-1--implement/g)?.length).toBe(1);
    expect(frame.split("wake-line-").length - 1).toBeGreaterThan(5);
  });

  it("keeps a failed attempt above the transcript even when the log is long", () => {
    const activity = Array.from({ length: 40 }, (_, i) => ({ at: i, text: `wake-line-${i}` }));
    const frame = renderFrame(
      { ...emptyView("epic"), rows: [failed], activity },
      { cols: 80, rows: 24 },
    );
    const above = beforeTranscript(frame);
    expect(above).toContain("Not logged in");
    expect(above).toMatch(/^ FAIL\s*$/m);
    expect(above).not.toMatch(/^ ASK\s*$/m);
    expect(above.match(/Not logged in/g)?.length).toBe(1);
    expect(stripAnsi(frame)).toContain("1 failed");
    expect(stripAnsi(frame)).toContain("w retry");
    expect(frame).toContain("wake-line-39");
  });

  it("keeps a running checkout above the transcript even when the log is long", () => {
    const running: StatusRow = {
      taskId: "LIVE-1--implement",
      issue: "LIVE-1",
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "LIVE-1--implement",
        workspacePath: "/tmp/conductor-src/.fsdev/workspaces/LIVE-1--implement",
        branch: "conductor/LIVE-1--implement",
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: { inputTokens: 12_000, outputTokens: 400 },
        costUsd: null,
        childSessionId: "child-1",
        requestId: "req-live-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const activity = Array.from({ length: 40 }, (_, i) => ({ at: i, text: `wake-line-${i}` }));
    const frame = renderFrame(
      { ...emptyView("epic"), rows: [running], activity },
      { cols: 80, rows: 24 },
    );
    const above = beforeTranscript(frame);
    expect(above).toMatch(/^ RUN\s*$/m);
    expect(above).toContain("conductor/LIVE-1--implement");
    expect(above).toContain("/tmp/conductor-src/.fsdev/workspaces/LIVE-1--implement");
    expect(above).toContain("req-live-1");
    expect(above).toContain("12.0k→400");
    expect(above).not.toMatch(/^ ASK\s*$/m);
    expect(above).not.toMatch(/^ FAIL\s*$/m);
    expect(above.match(/conductor\/LIVE-1--implement/g)?.length).toBe(1);
    expect(stripAnsi(frame)).toContain("1 running");
    expect(stripAnsi(frame)).toContain("x stop");
    expect(frame).toContain("wake-line-39");
  });

  it("shows the selected row's tools and keeps the other child's hunks off the pane", () => {
    const live = (issue: string, requestId: string): StatusRow => ({
      taskId: `${issue}--implement`,
      issue,
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: `${issue}--implement`,
        workspacePath: "/tmp/ws",
        branch: `conductor/${issue}--implement`,
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child",
        requestId,
        updatedAt: 1,
      },
      questions: [],
    });
    const activity = [
      { at: 1, text: "LIVE-1 · in_progress" },
      { at: 2, text: "tool · Write src/a.ts", requestId: "req-live-1" },
      { at: 2, text: "+ export const a = 1;", requestId: "req-live-1" },
      { at: 3, text: "tool · Write src/b.ts", requestId: "req-live-2" },
      { at: 3, text: "+ export const b = 2;", requestId: "req-live-2" },
    ];
    const childLive = {
      "req-live-1": "status · coding A",
      "req-live-2": "status · coding B",
    };
    const rows = [live("LIVE-1", "req-live-1"), live("LIVE-2", "req-live-2")];
    const first = renderFrame(
      { ...emptyView("epic"), rows, selected: 0, activity, childLive },
      { cols: 80, rows: 24 },
    );
    expect(first).toContain("tool · Write src/a.ts");
    expect(first).toContain("+ export const a = 1;");
    expect(first).toContain("status · coding A");
    expect(first).toContain("LIVE-1 · in_progress");
    expect(first).not.toContain("src/b.ts");
    expect(first).not.toContain("coding B");

    const second = renderFrame(
      { ...emptyView("epic"), rows, selected: 1, activity, childLive },
      { cols: 80, rows: 24 },
    );
    expect(second).toContain("tool · Write src/b.ts");
    expect(second).toContain("+ export const b = 2;");
    expect(second).toContain("status · coding B");
    expect(second).toContain("LIVE-1 · in_progress");
    expect(second).not.toContain("src/a.ts");
    expect(second).not.toContain("coding A");
  });

  it("keeps the implement hunk on a parked row that still has its request id", () => {
    const parked: StatusRow = {
      ...waiting,
      run: { ...waiting.run!, requestId: "req-ask-1" },
    };
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [parked],
        activity: [
          { at: 1, text: "ASK-1 · asked Which path?" },
          { at: 2, text: "tool · Write src/a.ts", requestId: "req-ask-1" },
          { at: 2, text: "+ export const a = 1;", requestId: "req-ask-1" },
          { at: 3, text: "tool · Write src/other.ts", requestId: "req-other" },
        ],
      },
      { cols: 80, rows: 24 },
    );
    expect(beforeTranscript(frame)).toContain("Which path?");
    expect(frame).toContain("tool · Write src/a.ts");
    expect(frame).toContain("+ export const a = 1;");
    expect(frame).not.toContain("src/other.ts");
  });

  it("pins the selected run's current todo on the RUN band and expands on demand", () => {
    const live = (issue: string, requestId: string): StatusRow => ({
      taskId: `${issue}--implement`,
      issue,
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: `${issue}--implement`,
        workspacePath: "/tmp/ws",
        branch: `conductor/${issue}--implement`,
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child",
        requestId,
        updatedAt: 1,
      },
      questions: [],
    });
    const childPlan = {
      "req-live-1": [
        { mark: "x" as const, text: "Add the failing test" },
        { mark: "·" as const, text: "Implement the fix" },
        { mark: " " as const, text: "Open the pull request" },
        { mark: " " as const, text: "Update the changelog" },
        { mark: " " as const, text: "Notify review" },
      ],
      "req-live-2": [{ mark: "x" as const, text: "Other child's work" }],
    };
    const rows = [live("LIVE-1", "req-live-1"), live("LIVE-2", "req-live-2")];
    const first = renderFrame(
      {
        ...emptyView("epic"),
        rows,
        selected: 0,
        childPlan,
        childLive: { "req-live-1": "status · coding A" },
        activity: [{ at: 1, text: "tool · Write src/a.ts", requestId: "req-live-1" }],
      },
      { cols: 80, rows: 24 },
    );
    const firstAbove = beforeTranscript(first);
    expect(firstAbove).toMatch(/^ RUN\s*$/m);
    expect(firstAbove).toContain("coding A");
    expect(firstAbove).toContain("[·] Implement the fix");
    expect(firstAbove).toContain("1/5");
    expect(firstAbove).not.toContain("Add the failing test");
    expect(firstAbove).not.toContain("Open the pull request");
    expect(firstAbove).not.toContain("Other child's work");
    expect(stripAnsi(first)).toContain("t list");

    const expanded = renderFrame(
      { ...emptyView("epic"), rows, selected: 0, childPlan, planExpanded: true },
      { cols: 80, rows: 24 },
    );
    const expandedAbove = beforeTranscript(expanded);
    expect(expandedAbove).toContain("[x] Add the failing test");
    expect(expandedAbove).toContain("[·] Implement the fix");
    expect(expandedAbove).toContain("[ ] Open the pull request");
    expect(expandedAbove).toContain("[ ] Update the changelog");
    expect(expandedAbove).toContain("… 1 more");
    expect(expandedAbove).not.toContain("Notify review");

    const second = renderFrame(
      { ...emptyView("epic"), rows, selected: 1, childPlan },
      { cols: 80, rows: 24 },
    );
    const secondAbove = beforeTranscript(second);
    expect(secondAbove).toContain("[x] Other child's work");
    expect(secondAbove).not.toContain("Implement the fix");
  });

  it("shows the last tool on the RUN band when nothing is mid-stream", () => {
    const running: StatusRow = {
      taskId: "LIVE-1--implement",
      issue: "LIVE-1",
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "LIVE-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/LIVE-1--implement",
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child",
        requestId: "req-live-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const above = beforeTranscript(
      renderFrame(
        {
          ...emptyView("epic"),
          rows: [running],
          activity: [
            { at: 1, text: "LIVE-1 · in_progress" },
            { at: 2, text: "tool · Write src/a.ts", requestId: "req-live-1" },
            { at: 3, text: "tool · Write src/b.ts", requestId: "req-live-2" },
          ],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(above).toContain("Write src/a.ts");
    expect(above).not.toContain("src/b.ts");
  });

  it("shows the open tool on the RUN band without the transcript prefix", () => {
    const running: StatusRow = {
      taskId: "LIVE-1--implement",
      issue: "LIVE-1",
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "LIVE-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/LIVE-1--implement",
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child",
        requestId: "req-live-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const above = beforeTranscript(
      renderFrame(
        {
          ...emptyView("epic"),
          rows: [running],
          childLive: { "req-live-1": "tool · Bash pnpm test" },
          activity: [{ at: 1, text: "tool · Bash pnpm test", requestId: "req-live-1" }],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(above).toContain("Bash pnpm test");
    expect(above).not.toContain("tool · Bash");
  });

  it("does not pin a plan on the ASK band", () => {
    const parked: StatusRow = {
      ...waiting,
      run: { ...waiting.run!, requestId: "req-ask-1" },
    };
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [parked],
        childPlan: {
          "req-ask-1": [{ mark: "·", text: "Implement the fix" }],
        },
      },
      { cols: 80, rows: 24 },
    );
    const above = beforeTranscript(frame);
    expect(above).toContain("Which path?");
    expect(above).toMatch(/\bASK\b/);
    expect(above).not.toMatch(/^ RUN\s*$/m);
    expect(above).not.toContain("Implement the fix");
  });

  it("paints a plan checklist and a Read peek in the transcript", () => {
    const running: StatusRow = {
      taskId: "LIVE-1--implement",
      issue: "LIVE-1",
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "LIVE-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/LIVE-1--implement",
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: { inputTokens: 12_000, outputTokens: 400 },
        costUsd: null,
        childSessionId: "child-1",
        requestId: "req-live-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [running],
        activity: [
          { at: 1, text: "tool · TodoWrite" },
          { at: 1, text: "  [x] Add the failing test" },
          { at: 1, text: "  [·] Implement the fix" },
          { at: 2, text: "tool · Read src/foo.ts" },
          { at: 2, text: "  export function foo() {" },
        ],
      },
      { cols: 80, rows: 24 },
    );
    const text = stripAnsi(frame);
    expect(text).toContain("tool · TodoWrite");
    expect(text).toContain("[x] Add the failing test");
    expect(text).toContain("[·] Implement the fix");
    expect(text).toContain("tool · Read src/foo.ts");
    expect(text).toContain("export function foo() {");
  });

  it("paints a Write hunk in the transcript", () => {
    const running: StatusRow = {
      taskId: "LIVE-1--implement",
      issue: "LIVE-1",
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "LIVE-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/LIVE-1--implement",
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: { inputTokens: 12_000, outputTokens: 400 },
        costUsd: null,
        childSessionId: "child-1",
        requestId: "req-live-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [running],
        activity: [
          { at: 1, text: "tool · Write src/foo.ts" },
          { at: 1, text: "- const n = 1;" },
          { at: 1, text: "+ const n = 2;" },
        ],
      },
      { cols: 80, rows: 24 },
    );
    const text = stripAnsi(frame);
    expect(text).toContain("tool · Write src/foo.ts");
    expect(text).toContain("- const n = 1;");
    expect(text).toContain("+ const n = 2;");
    expect(frame).toContain(TEAL);
    expect(frame).toContain(RUST);
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
    expect(above).toMatch(/^ ASK\s*$/m);
    expect(above).toContain("Which path?");
    expect(above).not.toMatch(/^ FAIL\s*$/m);
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
