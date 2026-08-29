import { describe, expect, it } from "vitest";
import {
  conductorWindowTitle,
  renderBoardPlain,
  renderFrame,
  renderWatchLine,
  visibleTableWindow,
  watchExitCode,
  windowTitleSequence,
} from "../src/conductor/render";
import {
  emptyView,
  lastActivityAt,
  rowNow,
  selectedFailure,
  type StatusRow,
} from "../src/conductor/types";
import {
  GOLD,
  RUST,
  TEAL,
  elideEnd,
  fileHref,
  formatAge,
  link,
  shorten,
  shortenToolLine,
  stripAnsi,
  visibleWidth,
} from "../src/conductor/theme";

describe("conductorWindowTitle", () => {
  it("names the epic and the counts the header already shows", () => {
    expect(conductorWindowTitle(emptyView("epic"))).toBe("conductor · epic");
    expect(
      conductorWindowTitle({
        ...emptyView("epic"),
        rows: [waiting],
      }),
    ).toBe("conductor · epic · 1 waiting");
    expect(
      conductorWindowTitle({
        ...emptyView("epic"),
        rows: [{ ...waiting, status: "in_progress", questions: [] }],
        busy: true,
      }),
    ).toBe("conductor · epic · 1 running · working");
    expect(
      conductorWindowTitle({
        ...emptyView("epic"),
        repoLabel: "fsd-product",
      }),
    ).toBe("conductor · epic · fsd-product");
  });

  it("sets the tab with ST, not a bell", () => {
    expect(windowTitleSequence("conductor · epic · 1 waiting")).toBe(
      "\x1b]0;conductor · epic · 1 waiting\x1b\\",
    );
    expect(windowTitleSequence("conductor · epic")).not.toContain("\x07");
  });
});

describe("visibleTableWindow", () => {
  it("is the whole board when it fits", () => {
    expect(visibleTableWindow(3, 1)).toEqual({ start: 0, end: 3 });
  });

  it("keeps the selected row inside an eight-row window", () => {
    expect(visibleTableWindow(20, 0)).toEqual({ start: 0, end: 8 });
    expect(visibleTableWindow(20, 19)).toEqual({ start: 12, end: 20 });
    expect(visibleTableWindow(12, 10)).toEqual({ start: 4, end: 12 });
  });
});

describe("formatAge / lastActivityAt", () => {
  const now = 1_700_000_000_000;

  it("floors to seconds, minutes, hours, then days", () => {
    expect(formatAge(now, now)).toBe("0s");
    expect(formatAge(now - 8_000, now)).toBe("8s");
    expect(formatAge(now - 59_999, now)).toBe("59s");
    expect(formatAge(now - 60_000, now)).toBe("1m");
    expect(formatAge(now - 3 * 60_000, now)).toBe("3m");
    expect(formatAge(now - 60 * 60_000, now)).toBe("1h");
    expect(formatAge(now - 47 * 60 * 60_000, now)).toBe("47h");
    expect(formatAge(now - 48 * 60 * 60_000, now)).toBe("2d");
  });

  it("uses the newer of the journal and the run record, and ignores another request", () => {
    const row: StatusRow = {
      ...waiting,
      status: "in_progress",
      questions: [],
      run: { ...waiting.run!, outcome: "running", requestId: "req-live-1", updatedAt: now - 60_000 },
    };
    expect(lastActivityAt(row)).toBe(now - 60_000);
    expect(
      lastActivityAt(row, [
        { at: now - 8_000, text: "tool · Write src/a.ts", requestId: "req-live-1" },
        { at: now - 1_000, text: "tool · Write src/b.ts", requestId: "req-other" },
      ]),
    ).toBe(now - 8_000);
    expect(
      lastActivityAt(row, [{ at: now - 90_000, text: "tool · Read src/a.ts", requestId: "req-live-1" }]),
    ).toBe(now - 60_000);
  });

  it("reads that row's live line or last tool, not another request's", () => {
    const row: StatusRow = {
      ...waiting,
      status: "in_progress",
      questions: [],
      run: { ...waiting.run!, outcome: "running", requestId: "req-live-1" },
    };
    const state = {
      ...emptyView("epic"),
      rows: [row],
      activity: [
        { at: 1, text: "tool · Write src/a.ts", requestId: "req-live-1" },
        { at: 2, text: "tool · Write src/b.ts", requestId: "req-other" },
      ],
      childLive: { "req-other": "status · coding B" },
    };
    expect(rowNow(state, row)).toBe("Write src/a.ts");
    expect(rowNow({ ...state, childLive: { "req-live-1": "tool · Bash pnpm test" } }, row)).toBe(
      "Bash pnpm test",
    );
    expect(rowNow({ ...state, childLive: { "req-live-1": "think · look at the tests" } }, row)).toBe(
      "think · look at the tests",
    );
    expect(
      rowNow(
        {
          ...state,
          activity: [{ at: 1, text: "think · look at the tests", requestId: "req-live-1" }],
        },
        row,
      ),
    ).toBe("think · look at the tests");
    expect(
      rowNow(
        {
          ...state,
          activity: [
            { at: 1, text: "tool · Read src/a.ts", requestId: "req-live-1" },
            { at: 2, text: "think · that test is the one", requestId: "req-live-1" },
          ],
        },
        row,
      ),
    ).toBe("think · that test is the one");
  });
});

describe("path shortening", () => {
  it("keeps the filename and the tool name when the prefix will not fit", () => {
    expect(elideEnd("src/conductor/render.ts", 11)).toBe("…/render.ts");
    expect(shorten("/tmp/deep/src/conductor/render.ts", 11)).toBe("…/render.ts");
    expect(shorten("pnpm test --filter fsdev", 12)).toBe("pnpm test -…");
    expect(shortenToolLine("tool · Write /tmp/deep/src/foo.ts", 21)).toBe("tool · Write …/foo.ts");
    expect(shortenToolLine("tool · Bash pnpm --filter @flow-state-dev/fsdev test", 28)).toBe(
      "tool · Bash pnpm --filter @…",
    );
  });
});

describe("OSC-8 links", () => {
  const url = "https://github.com/fixpoint-labs/flow-state-dev/pull/1496";

  it("does not count the wrapper in visible width", () => {
    const shown = "…/pull/1496";
    const painted = link(url, shown);
    expect(stripAnsi(painted)).toBe(shown);
    expect(visibleWidth(painted)).toBe(shown.length);
    expect(painted).toContain(`\x1b]8;;${url}`);
  });

  it("leaves a URL that is not http(s) or file plain", () => {
    expect(link("javascript:alert(1)", "x")).toBe("x");
    expect(link("https://ex.com/\x1b", "x")).toBe("x");
  });

  it("opens an absolute path, or a relative path against the checkout", () => {
    expect(fileHref("/tmp/ws/src/foo.ts")).toBe("file:///tmp/ws/src/foo.ts");
    expect(fileHref("src/foo.ts", "/tmp/ws")).toBe("file:///tmp/ws/src/foo.ts");
    expect(fileHref("src/foo.ts")).toBeUndefined();
    expect(link("file:///tmp/ws/src/foo.ts", "foo.ts")).toContain("\x1b]8;;file:///tmp/ws/src/foo.ts");
  });
});

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
    expect(
      stripAnsi(
        beforeTranscript(
          renderFrame(
            { ...emptyView("harness-manager"), rows: [waiting], busy: true },
            { cols: 80, rows: 24 },
          ),
        ),
      ),
    ).toContain("10→4");
    expect(
      stripAnsi(
        renderFrame(
          { ...emptyView("harness-manager"), rows: [waiting], busy: true },
          { cols: 80, rows: 24 },
        ),
      ),
    ).toContain("working");
    expect(frame).toContain("type to answer");
    expect(frame).toContain("↑/↓");
    expect(frame).not.toContain("click/");
    expect(frame).toContain("/find");
    expect(frame).toContain("TRANSCRIPT");
    expect(stripAnsi(frame)).not.toContain("a answer");
    expect(stripAnsi(frame)).not.toContain("talk to the coordinator, or /seed /wake /answer");
  });

  it("names the product checkout in the header when it is set", () => {
    const frame = stripAnsi(
      renderFrame(
        { ...emptyView("harness-manager"), repoLabel: "fsd-product" },
        { cols: 80, rows: 24 },
      ),
    );
    expect(frame).toContain("harness-manager");
    expect(frame).toContain("fsd-product");
  });

  it("keeps the prompt when the board has more rows than the table window", () => {
    const rows: StatusRow[] = Array.from({ length: 20 }, (_, i) => ({
      taskId: `FIX-${i + 1}--implement`,
      issue: `FIX-${i + 1}`,
      phase: "implement",
      status: "pending",
      attempts: 1,
      feedback: null,
      run: null,
      questions: [],
    }));
    const top = renderFrame({ ...emptyView("epic"), rows, selected: 0 }, { cols: 80, rows: 24 });
    const topText = stripAnsi(top);
    expect(topText).toMatch(/\bFIX-1\s+implement\b/);
    expect(topText).not.toMatch(/\bFIX-20\s+implement\b/);
    expect(topText).toContain("1–8");
    expect(topText).toContain("/quit");
    expect(top.split("\n")).toHaveLength(24);

    const bottom = renderFrame({ ...emptyView("epic"), rows, selected: 19 }, { cols: 80, rows: 24 });
    const bottomText = stripAnsi(bottom);
    expect(bottomText).toMatch(/\bFIX-20\s+implement\b/);
    expect(bottomText).not.toMatch(/\bFIX-1\s+implement\b/);
    expect(bottomText).toContain("13–20");
    expect(bottomText).toContain("/quit");
  });

  it("keeps the prompt when the reserved band is tall", () => {
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
        workspacePath: "/tmp/very/long/checkout/path/that/wraps",
        branch: "conductor/t0/hash/conductor-tasks--t0--epic/live-1--implement",
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: { inputTokens: 12000, outputTokens: 400 },
        costUsd: 0.2,
        childSessionId: "child",
        requestId: "req-live-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const rest: StatusRow[] = Array.from({ length: 19 }, (_, i) => ({
      taskId: `FIX-${i + 2}--implement`,
      issue: `FIX-${i + 2}`,
      phase: "implement",
      status: "pending",
      attempts: 1,
      feedback: null,
      run: null,
      questions: [],
    }));
    const hunk = { "req-live-1": [{ file: "src/big.ts", lines: Array.from({ length: 20 }, (_, i) => `+ line-${i}`) }] };
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [running, ...rest],
        childHunks: hunk,
        childFiles: { "req-live-1": Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`) },
        filesExpanded: true,
        hunksExpanded: true,
      },
      { cols: 80, rows: 24 },
    );
    const text = stripAnsi(frame);
    expect(text).toContain("/quit");
    expect(text).toContain("type to talk");
    expect(frame.split("\n")).toHaveLength(24);
  });

  it("opens an empty board on type-to-talk, not a slash-only door", () => {
    const frame = renderFrame(emptyView("epic"), { cols: 80, rows: 24 });
    const text = stripAnsi(frame);
    expect(text).toContain("no rows. type to talk, or /seed <issue> to file one.");
    expect(text).toContain("type to talk to the coordinator, or s to seed an issue");
    expect(text).toContain("nothing yet. type to talk.");
    expect(text).toContain("talk to the coordinator, or /seed /wake /answer");
    expect(text).toContain("type to talk  ·  s seed");
    expect(text).toContain("/quit");
    expect(text).not.toContain("select a row");
    expect(text).not.toContain("click/j/k");
    expect(text).not.toContain("/find");
  });

  it("keeps the end of a long compose line so the cursor stays visible", () => {
    const long = `please retry the failed rows and then tell me ${"x".repeat(80)} done`;
    const frame = renderFrame(
      { ...emptyView("epic"), input: long, caret: long.length },
      { cols: 80, rows: 24 },
    );
    const plain = stripAnsi(frame);
    expect(plain).toContain("done");
    expect(plain).toContain("…");
    expect(plain).toContain("Enter send");
    expect(plain).toContain("Ctrl-J line");
    expect(plain).not.toContain("↑ prior");
    expect(
      stripAnsi(
        renderFrame(
          { ...emptyView("epic"), input: long, caret: long.length, drafts: ["please retry"] },
          { cols: 80, rows: 24 },
        ),
      ),
    ).toContain("↑ prior");
    expect(plain).not.toContain("please retry the failed rows");
    const fromStart = stripAnsi(
      renderFrame({ ...emptyView("epic"), input: long, caret: 0 }, { cols: 80, rows: 24 }),
    );
    expect(fromStart).toContain("please retry the failed rows");
    expect(fromStart).not.toContain("done");
    const stacked = stripAnsi(
      renderFrame(
        { ...emptyView("epic"), input: "please\nretry the failed rows", caret: "please\n".length },
        { cols: 80, rows: 24 },
      ),
    );
    expect(stacked).toContain("please");
    expect(stacked).toContain("retry the failed rows");
  });

  it("shows a you · talk line in the transcript", () => {
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        activity: [{ at: 1, text: "you · what's on the board?" }],
      },
      { cols: 80, rows: 24 },
    );
    expect(stripAnsi(frame)).toContain("you · what's on the board?");
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
    expect(stripAnsi(frame)).toContain("/wake");
    expect(frame).toContain("wake-line-39");
  });

  it("does not advertise /wake on a spent row — the board will not take it", () => {
    const spent: StatusRow = { ...failed, status: "errored", attempts: 3 };
    const frame = renderFrame({ ...emptyView("epic"), rows: [spent] }, { cols: 80, rows: 24 });
    const text = stripAnsi(frame);
    const above = beforeTranscript(frame);
    expect(above).toMatch(/^ FAIL\s*$/m);
    expect(above).toContain("spent");
    expect(above).not.toContain("/wake");
    expect(text).toContain("spent");
    expect(text).not.toContain("/wake");
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
        healed: ["added **/.fsdev/ to .gitignore"],
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
    expect(above).toContain("heal · added **/.fsdev/ to .gitignore");
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

  it("shows last-write age on a running row, rust after 30s, and prefers the journal", () => {
    const now = 1_700_000_030_000;
    const running = (updatedAt: number): StatusRow => ({
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
        updatedAt,
      },
      questions: [],
    });
    const fresh = renderFrame(
      { ...emptyView("epic"), rows: [running(now - 8_000)] },
      { cols: 80, rows: 24 },
      now,
    );
    const freshText = stripAnsi(fresh);
    const freshBand = beforeTranscript(fresh);
    expect(freshText).toMatch(/in_progress\s+8s/);
    expect(freshBand).toContain("8s");
    expect(freshBand).toContain("12.0k→400");
    expect(fresh).toContain(GOLD);

    const stalled = renderFrame(
      { ...emptyView("epic"), rows: [running(now - 45_000)] },
      { cols: 80, rows: 24 },
      now,
    );
    expect(stripAnsi(stalled)).toContain("45s");
    expect(stalled).toContain(RUST);

    const journalNewer = renderFrame(
      {
        ...emptyView("epic"),
        rows: [running(now - 60_000)],
        activity: [{ at: now - 3_000, text: "tool · Write src/a.ts", requestId: "req-live-1" }],
      },
      { cols: 80, rows: 24 },
      now,
    );
    expect(beforeTranscript(journalNewer)).toContain("3s");
    expect(beforeTranscript(journalNewer)).not.toContain("60s");

    const settled = renderFrame({ ...emptyView("epic"), rows: [failed] }, { cols: 80, rows: 24 }, now);
    expect(stripAnsi(settled)).not.toMatch(/\b8s\b/);
    expect(stripAnsi(settled)).not.toMatch(/\b45s\b/);
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
    expect(first).not.toContain("+ export const b");
    expect(stripAnsi(beforeTranscript(first))).toContain("coding B");

    const second = renderFrame(
      { ...emptyView("epic"), rows, selected: 1, activity, childLive },
      { cols: 80, rows: 24 },
    );
    expect(second).toContain("tool · Write src/b.ts");
    expect(second).toContain("+ export const b = 2;");
    expect(second).toContain("status · coding B");
    expect(second).toContain("LIVE-1 · in_progress");
    expect(second).not.toContain("src/a.ts");
    expect(second).not.toContain("+ export const a");
    expect(stripAnsi(beforeTranscript(second))).toContain("coding A");
  });

  it("shows each running row's current tool on the board; a question still wins", () => {
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
        updatedAt: 1_700_000_000_000,
      },
      questions: [],
    });
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [live("LIVE-1", "req-1"), live("LIVE-2", "req-2"), waiting],
        selected: 0,
        activity: [
          { at: 1, text: "tool · Write src/a.ts", requestId: "req-1" },
          { at: 2, text: "tool · Bash pnpm test", requestId: "req-2" },
        ],
      },
      { cols: 80, rows: 24 },
      1_700_000_008_000,
    );
    const table = stripAnsi(beforeTranscript(frame));
    expect(table).toContain("Write src/a.ts");
    expect(table).toContain("Bash pnpm test");
    expect(table).toContain("Which path?");
    // Lab usage is verdict-only. A live row almost always has usage: null,
    // so OUTCOME stays `running` — do not invent a spend the scan cannot see.
    const live1 = table.split("\n").find((line) => line.includes("LIVE-1"));
    const live2 = table.split("\n").find((line) => line.includes("LIVE-2"));
    expect(live1).toContain("running");
    expect(live2).toContain("running");
    expect(live1).not.toMatch(/\d+(?:\.\d+k)?→\d/);
    expect(live2).not.toMatch(/\d+(?:\.\d+k)?→\d/);
  });

  it("shows each running row's token counts on the board, not another row's", () => {
    const live = (issue: string, requestId: string, input: number, output: number): StatusRow => ({
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
        usage: { inputTokens: input, outputTokens: output },
        costUsd: null,
        childSessionId: "child",
        requestId,
        updatedAt: 1_700_000_000_000,
      },
      questions: [],
    });
    const settled: StatusRow = {
      ...waiting,
      status: "completed",
      questions: [],
      run: { ...waiting.run!, outcome: "succeeded", usage: { inputTokens: 99_000, outputTokens: 9_000 } },
    };
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [live("LIVE-1", "req-1", 12_000, 400), live("LIVE-2", "req-2", 800, 50), settled],
        selected: 0,
      },
      { cols: 80, rows: 24 },
      1_700_000_008_000,
    );
    const table = stripAnsi(beforeTranscript(frame)).split("\n");
    const live1 = table.find((line) => line.includes("LIVE-1"));
    const live2 = table.find((line) => line.includes("LIVE-2"));
    const done = table.find((line) => line.includes(settled.issue ?? ""));
    expect(live1).toContain("12.0k→400");
    expect(live2).toContain("800→50");
    expect(live1).not.toContain("800→50");
    expect(done).toContain("succeeded");
    expect(done).not.toContain("99.0k");
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
    expect(stripAnsi(first)).toContain("type to talk");

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

  it("keeps files, plan, last tool, and request id after the row settles", () => {
    const settled: StatusRow = {
      taskId: "FAIL-1--implement",
      issue: "FAIL-1",
      phase: "implement",
      status: "pending",
      attempts: 1,
      feedback: "Not logged in",
      run: {
        attempt: 1,
        taskId: "FAIL-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/FAIL-1--implement",
        outcome: "failed",
        reason: "Not logged in",
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child",
        requestId: "req-fail-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [settled],
        childPlan: {
          "req-fail-1": [
            { mark: "x", text: "Add hello.js" },
            { mark: " ", text: "Open the pull request" },
          ],
        },
        childFiles: { "req-fail-1": ["src/hello.js"] },
        activity: [
          { at: 1, text: "tool · Write src/hello.js", requestId: "req-fail-1" },
          { at: 2, text: "tool · TaskCreate Add hello.js", requestId: "req-fail-1" },
        ],
      },
      { cols: 80, rows: 28 },
    );
    const above = beforeTranscript(frame);
    expect(above).toMatch(/^ FAIL\s*$/m);
    expect(above).not.toMatch(/^ RUN\s*$/m);
    expect(above).toContain("conductor/FAIL-1--implement");
    expect(above).toContain("req-fail-1");
    expect(above).toContain("src/hello.js");
    expect(above).toContain("[ ] Open the pull request");
    expect(above).toContain("1/2");
    expect(above).toContain("TaskCreate Add hello.js");
    expect(stripAnsi(frame)).toContain("type to talk");

    const busy = beforeTranscript(
      renderFrame(
        {
          ...emptyView("epic"),
          rows: [settled],
          busy: true,
          childPlan: {
            "req-fail-1": [
              { mark: "x", text: "Add hello.js" },
              { mark: " ", text: "Open the pull request" },
            ],
          },
          childFiles: { "req-fail-1": ["src/hello.js"] },
          activity: [
            { at: 1, text: "tool · Write src/hello.js", requestId: "req-fail-1" },
            { at: 2, text: "tool · TaskCreate Add hello.js", requestId: "req-fail-1" },
          ],
        },
        { cols: 80, rows: 28 },
      ),
    );
    expect(busy).toMatch(/^ FAIL\s*$/m);
    expect(busy).toContain("req-fail-1");
    expect(busy).toContain("src/hello.js");
    expect(busy).toContain("TaskCreate Add hello.js");
  });

  it("shows the pull request URL on a settled row", () => {
    const settled: StatusRow = {
      taskId: "FAIL-1--implement",
      issue: "FAIL-1",
      phase: "implement",
      status: "pending",
      attempts: 1,
      feedback: "error_max_turns",
      run: {
        attempt: 1,
        taskId: "FAIL-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/FAIL-1--implement",
        outcome: "failed",
        reason: "error_max_turns",
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child",
        requestId: "req-fail-1",
        prUrl: "https://github.com/fixpoint-labs/flow-state-dev/pull/1496",
        updatedAt: 1,
      },
      questions: [],
    };
    const frame = renderFrame({ ...emptyView("epic"), rows: [settled] }, { cols: 80, rows: 28 });
    const above = beforeTranscript(frame);
    expect(above).toContain("pull/1496");
    expect(frame).toContain("\x1b]8;;https://github.com/fixpoint-labs/flow-state-dev/pull/1496");
    expect(stripAnsi(frame)).not.toContain("\x1b]8;;");
  });

  it("shows the request id on a settled FAIL", () => {
    const settled: StatusRow = {
      taskId: "FAIL-1--implement",
      issue: "FAIL-1",
      phase: "implement",
      status: "pending",
      attempts: 1,
      feedback: "error_max_turns",
      run: {
        attempt: 1,
        taskId: "FAIL-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/FAIL-1--implement",
        outcome: "failed",
        reason: "error_max_turns",
        sessionId: "sess-operator",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child-claude-1",
        requestId: "req-fail-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const above = beforeTranscript(
      renderFrame({ ...emptyView("epic"), rows: [settled] }, { cols: 80, rows: 28 }),
    );
    expect(above).toMatch(/^ FAIL\s*$/m);
    expect(above).toContain("req-fail-1");
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

  it("lists the selected run's files on the RUN band, last touch last", () => {
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
            { at: 1, text: "tool · Write src/a.ts", requestId: "req-live-1" },
            { at: 2, text: "tool · Bash pnpm test", requestId: "req-live-1" },
            { at: 3, text: "tool · Read package.json", requestId: "req-live-1" },
            { at: 4, text: "tool · Write src/b.ts", requestId: "req-other" },
            { at: 5, text: "tool · Edit src/a.ts", requestId: "req-live-1" },
          ],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(above).toMatch(/^ RUN\s*$/m);
    expect(above).toContain("src/a.ts");
    expect(above).toContain("package.json");
    expect(above.indexOf("package.json")).toBeLessThan(above.lastIndexOf("src/a.ts"));
    expect(above).not.toContain("src/b.ts");
    expect(above).not.toContain("pnpm test");
  });

  it("caps the RUN-band file list", () => {
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
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((name, i) => ({
      at: i,
      text: `tool · Write src/${name}`,
      requestId: "req-live-1",
    }));
    const above = beforeTranscript(
      renderFrame({ ...emptyView("epic"), rows: [running], activity: files }, { cols: 80, rows: 24 }),
    );
    expect(above).toContain("… 2 more");
    expect(above).toContain("src/c.ts");
    expect(above).toContain("src/e.ts");
    expect(above).not.toContain("src/a.ts");
    expect(above).not.toContain("src/b.ts");

    const expanded = beforeTranscript(
      renderFrame(
        { ...emptyView("epic"), rows: [running], activity: files, filesExpanded: true },
        { cols: 80, rows: 24 },
      ),
    );
    expect(expanded).toContain("src/a.ts");
    expect(expanded).toContain("src/e.ts");
    expect(expanded).not.toContain("… 2 more");
    expect(stripAnsi(renderFrame({ ...emptyView("epic"), rows: [running], activity: files }, { cols: 80, rows: 24 }))).toContain(
      "f files",
    );
  });

  it("caps the RUN-band last hunk and expands it with h", () => {
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
    const hunk = Array.from({ length: 20 }, (_, i) => `+ line-${i}`);
    const stack = { "req-live-1": [{ file: "src/big.ts", lines: hunk }] };
    const above = beforeTranscript(
      renderFrame(
        { ...emptyView("epic"), rows: [running], childHunks: stack },
        { cols: 80, rows: 28 },
      ),
    );
    expect(above).toContain("… 17 more");
    expect(above).toContain("+ line-17");
    expect(above).toContain("+ line-19");
    expect(above).not.toContain("+ line-0");
    expect(above).not.toContain("+ line-16");

    const expanded = beforeTranscript(
      renderFrame(
        {
          ...emptyView("epic"),
          rows: [running],
          childHunks: stack,
          hunksExpanded: true,
        },
        { cols: 80, rows: 36 },
      ),
    );
    expect(expanded).toContain("+ line-4");
    expect(expanded).toContain("+ line-19");
    expect(expanded).not.toContain("+ line-0");
    expect(expanded).not.toContain("+ line-3");
    expect(expanded).toContain("… 4 more");
    expect(
      stripAnsi(
        renderFrame(
          { ...emptyView("epic"), rows: [running], childHunks: stack },
          { cols: 80, rows: 28 },
        ),
      ),
    ).toContain("h hunk");
  });

  it("cycles an older file's hunk on the RUN band with H", () => {
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
    const childHunks = {
      "req-live-1": [
        { file: "src/a.ts", lines: ["+ export const a = 1;"] },
        { file: "src/b.ts", lines: ["+ export const b = 2;"] },
      ],
    };
    const latest = beforeTranscript(
      renderFrame({ ...emptyView("epic"), rows: [running], childHunks }, { cols: 80, rows: 24 }),
    );
    expect(latest).toContain("src/b.ts");
    expect(latest).toContain("2/2");
    expect(latest).toContain("+ export const b = 2;");
    expect(latest).not.toContain("+ export const a = 1;");
    expect(stripAnsi(renderFrame({ ...emptyView("epic"), rows: [running], childHunks }, { cols: 80, rows: 24 }))).toContain(
      "H older",
    );

    const older = beforeTranscript(
      renderFrame(
        { ...emptyView("epic"), rows: [running], childHunks, hunkAt: 1 },
        { cols: 80, rows: 24 },
      ),
    );
    expect(older).toContain("src/a.ts");
    expect(older).toContain("1/2");
    expect(older).toContain("+ export const a = 1;");
    expect(older).not.toContain("+ export const b = 2;");
  });

  it("shows the last Read peek on the RUN band, and drops it after a Write", () => {
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
    const peek = [
      { at: 1, text: "tool · Read src/foo.ts", requestId: "req-live-1" },
      { at: 1, text: "  export function foo() {", requestId: "req-live-1" },
      { at: 1, text: "    return 1;", requestId: "req-live-1" },
    ];
    const reading = beforeTranscript(
      renderFrame({ ...emptyView("epic"), rows: [running], activity: peek }, { cols: 80, rows: 24 }),
    );
    expect(reading).toMatch(/^ RUN\s*$/m);
    expect(reading).toContain("export function foo() {");
    expect(reading).toContain("return 1;");

    const afterWrite = beforeTranscript(
      renderFrame(
        {
          ...emptyView("epic"),
          rows: [running],
          activity: [
            ...peek,
            { at: 2, text: "tool · Write src/foo.ts", requestId: "req-live-1" },
            { at: 2, text: "+ export function foo() {", requestId: "req-live-1" },
          ],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(afterWrite).toContain("Write src/foo.ts");
    expect(afterWrite).not.toContain("return 1;");
  });

  it("expands the last Read peek with peekExpanded, and offers e more", () => {
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
    const peek = [
      { at: 1, text: "tool · Read src/foo.ts", requestId: "req-live-1" },
      { at: 1, text: "  line-1", requestId: "req-live-1" },
      { at: 1, text: "  line-2", requestId: "req-live-1" },
      { at: 1, text: "  line-3", requestId: "req-live-1" },
      { at: 1, text: "  line-4", requestId: "req-live-1" },
      { at: 1, text: "  line-5", requestId: "req-live-1" },
    ];
    const collapsedFrame = renderFrame(
      { ...emptyView("epic"), rows: [running], activity: peek },
      { cols: 80, rows: 24 },
    );
    const collapsed = beforeTranscript(collapsedFrame);
    expect(collapsed).toContain("line-1");
    expect(collapsed).toContain("line-3");
    expect(collapsed).not.toContain("line-5");
    expect(collapsed).toContain("… 2 more");
    expect(stripAnsi(collapsedFrame)).toContain("e more");

    const expanded = beforeTranscript(
      renderFrame(
        { ...emptyView("epic"), rows: [running], activity: peek, peekExpanded: true },
        { cols: 80, rows: 28 },
      ),
    );
    expect(expanded).toContain("line-5");
    expect(expanded).not.toContain("… 2 more");
  });

  it("shows the last Bash tail on the RUN band, and drops it after a Write", () => {
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
    const output = [
      { at: 1, text: "tool · Bash pnpm test", requestId: "req-live-1" },
      { at: 1, text: "  … 14 above", requestId: "req-live-1" },
      { at: 1, text: "  Test Files  1 passed (1)", requestId: "req-live-1" },
      { at: 1, text: "  Tests  12 passed (12)", requestId: "req-live-1" },
    ];
    const runningBand = beforeTranscript(
      renderFrame({ ...emptyView("epic"), rows: [running], activity: output }, { cols: 80, rows: 24 }),
    );
    expect(runningBand).toMatch(/^ RUN\s*$/m);
    expect(runningBand).toContain("Bash pnpm test");
    expect(runningBand).toContain("Test Files  1 passed (1)");
    expect(runningBand).toContain("Tests  12 passed (12)");
    expect(runningBand).toContain("… 14 above");

    const afterWrite = beforeTranscript(
      renderFrame(
        {
          ...emptyView("epic"),
          rows: [running],
          activity: [
            ...output,
            { at: 2, text: "tool · Write src/foo.ts", requestId: "req-live-1" },
            { at: 2, text: "+ export const n = 1;", requestId: "req-live-1" },
          ],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(afterWrite).toContain("Write src/foo.ts");
    expect(afterWrite).not.toContain("Test Files  1 passed (1)");
  });

  it("keeps the branch on ASK when there is no pull request", () => {
    const above = beforeTranscript(
      renderFrame({ ...emptyView("epic"), rows: [waiting] }, { cols: 80, rows: 24 }),
    );
    expect(above).toMatch(/\bASK\b/);
    expect(above).toContain("conductor/FIX-1--implement");
    expect(above).not.toContain("pull/");
  });

  it("keeps the issue--phase suffix when the branch will not fit", () => {
    const long =
      "conductor/t0/h16ed7875924f09c235bd7ada69126a8c2fdb8adcd20e3b79e41eff5c60875ae8/conductor-tasks--t0--atlas-prove-ask-1/ask-1--implement";
    const parked: StatusRow = {
      ...waiting,
      run: { ...waiting.run!, branch: long },
    };
    const above = beforeTranscript(
      renderFrame({ ...emptyView("epic"), rows: [parked] }, { cols: 80, rows: 24 }),
    );
    expect(above).toContain("ask-1--implement");
    expect(above).not.toContain("conductor/t0/h16ed7875924f09c235bd7ada69126a8c2fdb8adcd20e3b79e…");
  });

  it("keeps files, the current todo, and the PR URL on ASK", () => {
    const parked: StatusRow = {
      ...waiting,
      run: {
        ...waiting.run!,
        requestId: "req-ask-1",
        prUrl: "https://github.com/fixpoint-labs/flow-state-dev/pull/1496",
      },
    };
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((name, i) => ({
      at: i,
      text: `tool · Write src/${name}`,
      requestId: "req-ask-1",
    }));
    const above = beforeTranscript(
      renderFrame(
        {
          ...emptyView("epic"),
          rows: [parked],
          activity: files,
          childPlan: {
            "req-ask-1": [
              { mark: "x", text: "Read the failing test" },
              { mark: "·", text: "Implement the fix" },
              { mark: " ", text: "Open a pull request" },
            ],
          },
          planExpanded: true,
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(above).toContain("Which path?");
    expect(above).toMatch(/\bASK\b/);
    expect(above).not.toMatch(/^ RUN\s*$/m);
    expect(above).toContain("conductor/FIX-1--implement");
    expect(above).toContain("pull/1496");
    expect(above).toContain("… 2 more");
    expect(above).toContain("src/e.ts");
    expect(above).not.toContain("src/a.ts");
    expect(above).toContain("Implement the fix");
    expect(above).not.toContain("Read the failing test");
    expect(above).not.toContain("Open a pull request");
  });

  it("shows eight wrapped lines of a long question, then how many more", () => {
    const words = Array.from({ length: 10 }, (_, i) => `AskLine${i + 1}${"x".repeat(64)}`);
    const parked: StatusRow = {
      ...waiting,
      questions: [{ ...waiting.questions[0]!, text: words.join(" ") }],
    };
    const above = stripAnsi(
      beforeTranscript(
        renderFrame({ ...emptyView("epic"), rows: [parked] }, { cols: 80, rows: 40 }),
      ),
    );
    expect(above).toMatch(/^ ASK\s+·\s+… \d+ more\s*$/m);
    expect(above).toContain("AskLine1");
    expect(above).toContain("AskLine8");
    expect(above).not.toContain("AskLine9");
  });

  it("keeps the branch on a 24-line ASK when the question wraps", () => {
    const words = Array.from({ length: 10 }, (_, i) => `AskLine${i + 1}${"x".repeat(64)}`);
    const parked: StatusRow = {
      ...waiting,
      questions: [{ ...waiting.questions[0]!, text: words.join(" ") }],
    };
    const frame = stripAnsi(
      renderFrame(
        {
          ...emptyView("conductor--t0--atlas-prove-ask-1"),
          repoLabel: "fsd-product",
          rows: [parked],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(frame).toContain("conductor/FIX-1--implement");
    expect(frame).toContain("/quit");
    expect(frame).toMatch(/^ ASK\s+·\s+… \d+ more\s*$/m);
    const askBand = frame.slice(frame.search(/^ ASK\s/m));
    const branchAt = askBand.indexOf("conductor/FIX-1--implement");
    const bodyAt = askBand.indexOf("AskLine1");
    expect(branchAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(branchAt);
    expect(frame).toContain("TRANSCRIPT");
  });

  it("keeps TRANSCRIPT on a 24-line ASK that matches a parked implement", () => {
    const words = Array.from({ length: 10 }, (_, i) => `AskLine${i + 1}${"x".repeat(64)}`);
    const question = words.join(" ");
    const branch =
      "conductor/t0/h16ed7875924f09c235bd7ada69126a8c2fdb8adcd20e3b79e41eff5c60875ae8/conductor-tasks--t0--atlas-prove-ask-1/ask-1--implement";
    const parked: StatusRow = {
      ...waiting,
      taskId: "ASK-1--implement",
      issue: "ASK-1",
      attempts: 2,
      run: {
        ...waiting.run!,
        attempt: 2,
        taskId: "ASK-1--implement",
        branch,
        outcome: "running",
        requestId: "req-ask-1",
      },
      questions: [
        {
          question: "ASK-1/implement/2/q",
          text: question,
          attempt: 2,
          askedAt: 1,
        },
      ],
    };
    const frame = stripAnsi(
      renderFrame(
        {
          ...emptyView("conductor--t0--atlas-prove-ask-1"),
          repoLabel: "fsd-product",
          lastRefreshAt: Date.parse("2026-08-29T04:37:00Z"),
          rows: [parked],
          activity: [
            { at: 1, text: `ASK-1 · asked ${question}`, requestId: "req-ask-1" },
            { at: 2, text: "tool · Write src/ask-prove.ts", requestId: "req-ask-1" },
            { at: 2, text: "+ export function proveFn() { return 1; }", requestId: "req-ask-1" },
            { at: 3, text: "tool · Write src/b.ts", requestId: "req-ask-1" },
            { at: 3, text: "+ export const b = 2;", requestId: "req-ask-1" },
            { at: 4, text: "tool · Write src/c.ts", requestId: "req-ask-1" },
          ],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(frame).toContain("TRANSCRIPT");
    expect(frame).toContain("ask-1--implement");
    expect(frame).toContain("AskLine1");
    expect(frame).toMatch(/^ ASK\s+·\s+… \d+ more\s*$/m);
    expect(frame).toContain("/quit");
    const askBand = frame.slice(frame.search(/^ ASK\s/m), frame.indexOf("TRANSCRIPT"));
    expect(askBand).toContain("ask-1--implement");
    expect(Number((askBand.match(/^ ASK\s+·\s+… (\d+) more/m) ?? [])[1])).toBeGreaterThan(2);
  });

  it("keeps TRANSCRIPT on an 18-line ASK whose attempt strip is as tall as a parked implement", () => {
    const words = Array.from({ length: 10 }, (_, i) => `AskLine${i + 1}${"x".repeat(64)}`);
    const question = words.join(" ");
    const branch =
      "conductor/t0/h16ed7875924f09c235bd7ada69126a8c2fdb8adcd20e3b79e41eff5c60875ae8/conductor-tasks--t0--atlas-prove-ask-1/ask-1--implement";
    const parked: StatusRow = {
      ...waiting,
      taskId: "ASK-1--implement",
      issue: "ASK-1",
      attempts: 2,
      run: {
        ...waiting.run!,
        attempt: 2,
        taskId: "ASK-1--implement",
        workspacePath:
          "/tmp/conductor-checkouts-ask-1/t0/h16ed7875924f09c235bd7ada69126a8c2fdb8adcd20e3b79e41eff5c60875ae8/conductor-tasks--t0--atlas-prove-ask-1/ask-1--implement",
        branch,
        outcome: "running",
        requestId: "req-ask-1",
        usage: { inputTokens: 114, outputTokens: 3500 },
        costUsd: 0.154,
      },
      questions: [
        {
          question: "ask-1/implement/2/1afff1cd1f128157",
          text: `## GitHub PR Creation Permission Issue Cannot create a pull request via GitHub CLI. The command \`gh pr create\` fails. ${question}`,
          attempt: 2,
          askedAt: 1,
        },
      ],
    };
    const frame = stripAnsi(
      renderFrame(
        {
          ...emptyView("conductor--t0--atlas-prove-ask-1"),
          repoLabel: "fsd-product",
          lastRefreshAt: Date.parse("2026-08-29T04:37:00Z"),
          rows: [parked],
          activity: [
            { at: 1, text: `ASK-1 · asked ${question}`, requestId: "req-ask-1" },
            { at: 2, text: "tool · Write src/ask-prove.ts", requestId: "req-ask-1" },
            { at: 3, text: "tool · Write .fsdev/ask/2.md", requestId: "req-ask-1" },
            { at: 4, text: "01429b0 Add ask-prove module with proveFn function", requestId: "req-ask-1" },
            {
              at: 5,
              text: "Merge pull request #1506 from fixpoint-labs/fix/FIX-150-overlap",
              requestId: "req-ask-1",
            },
            {
              at: 6,
              text: "think · Perfect. The implementation is complete with the commit…",
              requestId: "req-ask-1",
            },
          ],
          childFiles: {
            "req-ask-1": [
              "src/ask-prove.ts",
              ".fsdev/ask/2.md",
              "src/b.ts",
              "src/c.ts",
            ],
          },
          childHunks: {
            "req-ask-1": [
              {
                file: "src/ask-prove.ts",
                lines: [
                  "01429b0 Add ask-prove module with proveFn function",
                  "Merge pull request #1506 from fixpoint-labs/fix/FIX-150-overlap",
                  "+ export function proveFn() { return 1; }",
                ],
              },
            ],
          },
          childPlan: {
            "req-ask-1": [{ mark: "·", text: "open the completing pull request" }],
          },
        },
        { cols: 80, rows: 18 },
      ),
    );
    expect(frame).toContain("TRANSCRIPT");
    expect(frame).toContain("ask-1--implement");
    expect(frame).toContain("type to answer");
    expect(frame).toContain("/quit");
    expect(frame).toMatch(/^ ASK\s+·\s+… \d+ more\s*$/m);
    const askBand = frame.slice(frame.search(/^ ASK\s/m), frame.indexOf("TRANSCRIPT"));
    expect(askBand).toContain("ask-1--implement");
    expect(askBand).toMatch(/GitHub PR|gh pr create|AskLine1/);
  });

  it("keeps TRANSCRIPT on an 18-line FAIL whose attempt strip is as tall as a parked implement", () => {
    const words = Array.from({ length: 10 }, (_, i) => `Fail${String(i + 1).padStart(2, "0")}${"x".repeat(64)}`);
    const parked: StatusRow = {
      ...failed,
      run: {
        ...failed.run!,
        reason: words.join(" "),
        requestId: "req-fail-1",
        branch:
          "conductor/t0/h16ed7875924f09c235bd7ada69126a8c2fdb8adcd20e3b79e41eff5c60875ae8/conductor-tasks--t0--atlas-prove-fail-1/fail-1--implement",
      },
    };
    const frame = stripAnsi(
      renderFrame(
        {
          ...emptyView("conductor--t0--atlas-prove-fail-1"),
          repoLabel: "fsd-product",
          rows: [parked],
          activity: [
            { at: 1, text: "tool · Write src/a.ts", requestId: "req-fail-1" },
            { at: 2, text: "think · the pull request could not be opened", requestId: "req-fail-1" },
          ],
          childFiles: { "req-fail-1": ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"] },
          childHunks: {
            "req-fail-1": [
              {
                file: "src/a.ts",
                lines: ["+ a", "+ b", "+ c"],
              },
            ],
          },
          childPlan: {
            "req-fail-1": [{ mark: "·", text: "retry the failed rows" }],
          },
        },
        { cols: 80, rows: 18 },
      ),
    );
    expect(frame).toContain("TRANSCRIPT");
    expect(frame).toContain("fail-1--implement");
    expect(frame).toMatch(/^ FAIL\s+·\s+… \d+ more\s*$/m);
    expect(frame).toContain("/quit");
  });

  it("shows eight wrapped lines of a long failure, then how many more", () => {
    const words = Array.from({ length: 10 }, (_, i) => `Fail${String(i + 1).padStart(2, "0")}${"x".repeat(64)}`);
    const parked: StatusRow = {
      ...failed,
      run: { ...failed.run!, reason: words.join(" ") },
    };
    const above = stripAnsi(
      beforeTranscript(
        renderFrame({ ...emptyView("epic"), rows: [parked] }, { cols: 80, rows: 40 }),
      ),
    );
    expect(above).toMatch(/^ FAIL\s+·\s+… \d+ more\s*$/m);
    expect(above).toContain("Fail01");
    expect(above).toContain("Fail08");
    expect(above).not.toContain("Fail09");
  });

  it("keeps the branch on a 24-line FAIL when the reason wraps", () => {
    const words = Array.from({ length: 10 }, (_, i) => `Fail${String(i + 1).padStart(2, "0")}${"x".repeat(64)}`);
    const parked: StatusRow = {
      ...failed,
      run: { ...failed.run!, reason: words.join(" ") },
    };
    const frame = stripAnsi(
      renderFrame(
        {
          ...emptyView("conductor--t0--atlas-prove-fail-1"),
          repoLabel: "fsd-product",
          rows: [parked],
        },
        { cols: 80, rows: 24 },
      ),
    );
    expect(frame).toContain("conductor/FAIL-1--implement");
    expect(frame).toContain("/quit");
    expect(frame).toMatch(/^ FAIL\s+·\s+… \d+ more\s*$/m);
    const failBand = frame.slice(frame.search(/^ FAIL\s/m));
    const branchAt = failBand.indexOf("conductor/FAIL-1--implement");
    const bodyAt = failBand.indexOf("Fail01");
    expect(branchAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(branchAt);
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

  it("lists matching slash verbs above the prompt", () => {
    const frame = renderFrame(
      { ...emptyView("epic"), rows: [waiting], input: "/s" },
      { cols: 80, rows: 24 },
    );
    const text = stripAnsi(frame);
    expect(text).toContain("/status");
    expect(text).toContain("refresh, or jump to a row");
    expect(text).toContain("/seed");
    expect(text).toContain("/start");
    expect(text).toContain("Tab complete");
    expect(text).not.toContain("/wake");
  });

  it("lists board issue ids after /status ", () => {
    const frame = renderFrame(
      { ...emptyView("epic"), rows: [waiting, failed], input: "/status " },
      { cols: 80, rows: 24 },
    );
    const text = stripAnsi(frame);
    expect(text).toContain("FIX-1");
    expect(text).toContain("awaiting_review");
    expect(text).toContain("FAIL-1");
    expect(text).toContain("Tab complete");
  });

  it("pins the current find hit and paints the match", () => {
    const idle: StatusRow = {
      taskId: "FIX-1--implement",
      issue: "FIX-1",
      phase: "implement",
      status: "pending",
      attempts: 0,
      feedback: null,
      run: null,
      questions: [],
    };
    const activity = Array.from({ length: 40 }, (_, i) => ({
      at: i + 1,
      text: `tool · Read src/line-${String(i).padStart(2, "0")}.ts`,
    }));
    const base = { ...emptyView("epic"), rows: [idle], activity };
    const tail = renderFrame(base, { cols: 80, rows: 18 });
    expect(stripAnsi(tail)).not.toContain("src/line-00.ts");
    expect(stripAnsi(tail)).toContain("src/line-39.ts");

    const finding = { ...base, find: "line-00", findAt: 0 };
    const frame = renderFrame(finding, { cols: 80, rows: 18 });
    const text = stripAnsi(frame);
    expect(text).toContain("src/line-00.ts");
    expect(text).toMatch(/find · "line-00"  1\/1/);
    expect(text).toContain("n older");
    expect(text).toContain("Esc clear");
    expect(frame).toContain(GOLD);
  });

  it("keeps the ASK band when find is on", () => {
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [waiting],
        find: "path",
        findAt: 0,
        activity: [{ at: 1, text: "Which path?" }],
      },
      { cols: 80, rows: 24 },
    );
    const above = beforeTranscript(frame);
    expect(above).toMatch(/^ ASK\s*$/m);
    expect(above).toContain("Which path?");
    expect(stripAnsi(frame)).toMatch(/find · "path"/);
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

  it("keeps the filename when a checkout or file path will not fit", () => {
    const longTree =
      "/tmp/conductor-checkouts/live-prove-30/very/deep/nested/workspaces/LIVE-1--implement";
    const longFile =
      "/tmp/conductor-checkouts/live-prove-30/very/deep/nested/src/conductor/render.ts";
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
        workspacePath: longTree,
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
    const frame = renderFrame(
      {
        ...emptyView("epic"),
        rows: [running],
        childFiles: { "req-live-1": [longFile] },
        activity: [{ at: 1, text: `tool · Write ${longFile}`, requestId: "req-live-1" }],
      },
      { cols: 72, rows: 24 },
    );
    const text = stripAnsi(frame);
    const above = beforeTranscript(frame);
    expect(above).toContain("LIVE-1--implement");
    expect(above).toContain("render.ts");
    expect(above).not.toMatch(/\/tmp\/conductor-checkouts\/live-prove-30\/very\/deep\/nested\/src/);
    expect(text).toContain("render.ts");
    expect(text).not.toMatch(/tool · Write \/tmp\/conductor-checkouts\/live-prove-30\/very/);
    expect(frame).toContain(`\x1b]8;;file://${longFile}`);
    expect(frame).toContain(`\x1b]8;;file://${longTree}`);
    expect(text).not.toContain("\x1b]8;;");
  });

  it("uses 1 when the last attempt failed, even if the row is still pending", () => {
    expect(watchExitCode([failed])).toBe(1);
    expect(watchExitCode([{ ...failed, status: "errored" }])).toBe(1);
    const text = renderBoardPlain([failed], false);
    expect(text).toContain("FAIL-1");
    expect(text).toContain("! failed");
    expect(text).toContain("Not logged in");
  });

  it("prints the pull request URL, request id, and branch under a headless row", () => {
    const settled: StatusRow = {
      ...failed,
      run: {
        ...failed.run!,
        requestId: "req-fail-1",
        prUrl: "https://github.com/fixpoint-labs/flow-state-dev/pull/1496",
        usage: { inputTokens: 1200, outputTokens: 400 },
        costUsd: 0.042,
        finalMessage: "opened the pull request then exhausted the turn budget",
      },
    };
    const text = renderBoardPlain([settled], false);
    expect(text).toContain("https://github.com/fixpoint-labs/flow-state-dev/pull/1496");
    expect(text).toContain("@ req-fail-1");
    expect(text).toContain("conductor/FAIL-1--implement");
    expect(text).toContain("/tmp/ws");
    expect(text).toContain("1.2k→400");
    expect(text).toContain("$0.042");
    expect(text).toContain("opened the pull request then exhausted the turn budget");
    const watch = renderWatchLine([settled]);
    expect(watch).toContain("FAIL-1 pending failed");
    expect(watch).toContain("https://github.com/fixpoint-labs/flow-state-dev/pull/1496");
    expect(watch).toContain("@ req-fail-1");
    expect(watch).toContain("conductor/FAIL-1--implement");
    expect(watch).toContain("1.2k→400");
  });

  it("prints last tool, files, hunk, and todo when a named row has a journal view", () => {
    const settled: StatusRow = {
      ...failed,
      run: { ...failed.run!, requestId: "req-fail-1" },
    };
    const view = {
      ...emptyView(""),
      rows: [settled],
      childFiles: { "req-fail-1": ["src/hello.js"] },
      childHunks: { "req-fail-1": [{ file: "src/hello.js", lines: ["+ export const hello = 1;"] }] },
      childPlan: {
        "req-fail-1": [
          { mark: "x" as const, text: "Add hello.js" },
          { mark: " " as const, text: "Open the pull request" },
        ],
      },
      activity: [
        { at: 1, text: "tool · Write src/hello.js", requestId: "req-fail-1" },
        { at: 2, text: "  first line of the file", requestId: "req-fail-1" },
      ],
    };
    const text = renderBoardPlain([settled], false, { "req-fail-1": view });
    expect(text).toContain("Write src/hello.js");
    expect(text).toContain("src/hello.js");
    expect(text).toContain("+ export const hello = 1;");
    expect(text).toContain("[ ] Open the pull request");
    expect(text).toContain("1/2");
    expect(text).not.toContain("\x1b]8;;");

    const without = renderBoardPlain([settled], false);
    expect(without).not.toContain("Write src/hello.js");
    expect(without).not.toContain("+ export const hello = 1;");
    expect(without).not.toContain("Open the pull request");

    const watch = renderWatchLine([settled], { "req-fail-1": view });
    expect(watch).toContain("Write src/hello.js");
    expect(watch).toContain("[ ] Open the pull request");
  });

  it("prints last-write age on a running headless row, from the journal when newer", () => {
    const now = 1_700_000_030_000;
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
        updatedAt: now - 60_000,
      },
      questions: [],
    };
    const fromRecord = renderBoardPlain([running], false, undefined, now);
    expect(fromRecord).toContain("1m");
    expect(fromRecord).not.toContain("\x1b[");

    const view = {
      ...emptyView(""),
      rows: [running],
      activity: [{ at: now - 8_000, text: "tool · Write src/a.ts", requestId: "req-live-1" }],
    };
    const named = renderBoardPlain([running], false, { "req-live-1": view }, now);
    expect(named).toContain("8s");
    expect(named).toContain("Write src/a.ts");
    expect(named).not.toContain("1m");

    const watch = renderWatchLine([running], { "req-live-1": view }, now);
    expect(watch).toContain("8s");
    expect(renderBoardPlain([failed], false, undefined, now)).not.toContain("8s");
  });

  it("puts a running row's current action on ASK when a view is passed", () => {
    // Same rule as the TUI table: a question wins; otherwise the live
    // child's last tool. Without a journal the column stays `·` — that
    // is a full-board print of a settled history, not a missing verb.
    const now = 1_700_000_000_000;
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
        updatedAt: now,
      },
      questions: [],
    };
    const view = {
      ...emptyView(""),
      rows: [running],
      activity: [{ at: now, text: "tool · Write src/a.ts", requestId: "req-live-1" }],
    };
    const table = renderBoardPlain([running], false, { "req-live-1": view }, now).split("\n")[1]!;
    expect(table).toContain("Write src/a.ts");
    expect(renderBoardPlain([running], false, undefined, now).split("\n")[1]).toMatch(/·\s*$/);

    const thinking = {
      ...emptyView(""),
      rows: [running],
      childLive: { "req-live-1": "think · look at the tests" },
    };
    expect(renderBoardPlain([running], false, { "req-live-1": thinking }, now).split("\n")[1]).toContain(
      "think · look at",
    );

    const asked: StatusRow = {
      ...running,
      questions: [{ question: "LIVE-1/implement/1/q", text: "Which path?" }],
    };
    expect(renderBoardPlain([asked], false, { "req-live-1": view }, now).split("\n")[1]).toContain(
      "Which path?",
    );
    expect(renderBoardPlain([asked], false, { "req-live-1": view }, now).split("\n")[1]).not.toContain(
      "Write src/a.ts",
    );
  });

  it("adds now and files on --json when a journal view is passed", () => {
    const now = 1_700_000_000_000;
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
        updatedAt: now,
      },
      questions: [],
    };
    const view = {
      ...emptyView(""),
      rows: [running],
      activity: [{ at: now, text: "tool · Write src/a.ts", requestId: "req-live-1" }],
      childFiles: { "req-live-1": ["src/a.ts"] },
    };
    const loaded = JSON.parse(renderBoardPlain([running], true, { "req-live-1": view }, now)) as {
      rows: Array<{ now?: string; files?: string[] }>;
    };
    expect(loaded.rows[0]?.now).toBe("Write src/a.ts");
    expect(loaded.rows[0]?.files).toEqual(["src/a.ts"]);
    const bare = JSON.parse(renderBoardPlain([running], true, undefined, now)) as {
      rows: Array<{ now?: string }>;
    };
    expect(bare.rows[0]?.now).toBeUndefined();
  });

  it("names the board so leftover CONDUCTOR_EPIC is visible", () => {
    const identity = { epic: "conductor/t0/atlas-prove-add-bye", repo: "fsd-product" };
    expect(renderBoardPlain([], false, undefined, Date.now(), identity)).toBe(
      "conductor/t0/atlas-prove-add-bye · fsd-product\nno rows\n",
    );
    const withRow = renderBoardPlain([waiting], false, undefined, Date.now(), identity);
    expect(withRow.startsWith("conductor/t0/atlas-prove-add-bye · fsd-product\nISSUE")).toBe(true);
    expect(withRow).toContain("FIX-1");
    expect(JSON.parse(renderBoardPlain([], true, undefined, Date.now(), identity))).toEqual({
      epic: "conductor/t0/atlas-prove-add-bye",
      repo: "fsd-product",
      rows: [],
    });
    const loaded = JSON.parse(
      renderBoardPlain([waiting], true, undefined, Date.now(), identity),
    ) as { epic: string; repo: string; rows: Array<{ issue?: string }> };
    expect(loaded.epic).toBe("conductor/t0/atlas-prove-add-bye");
    expect(loaded.repo).toBe("fsd-product");
    expect(loaded.rows[0]?.issue).toBe("FIX-1");
  });

  it("omits epic and repo when the caller did not pass a board identity", () => {
    expect(renderBoardPlain([], false)).toBe("no rows\n");
    expect(JSON.parse(renderBoardPlain([], true))).toEqual({ rows: [] });
  });

  it("names the epic alone when the repo label is absent", () => {
    const identity = { epic: "conductor/t0/harness-manager" };
    expect(renderBoardPlain([], false, undefined, Date.now(), identity)).toBe(
      "conductor/t0/harness-manager\nno rows\n",
    );
    expect(JSON.parse(renderBoardPlain([], true, undefined, Date.now(), identity))).toEqual({
      epic: "conductor/t0/harness-manager",
      rows: [],
    });
  });
});

describe("renderFrame help", () => {
  it("fits the board keys on a 24-line terminal and keeps Esc", () => {
    const frame = renderFrame({ ...emptyView("harness-manager"), help: true }, { cols: 80, rows: 24 });
    const text = stripAnsi(frame);
    expect(text).toContain("type to talk");
    expect(text).toContain("/quit");
    expect(text).toContain("/find");
    expect(text).toContain("Ctrl-W");
    expect(text).toContain("/steer talks");
    expect(text).toContain("any key returns");
    expect(text).not.toContain("click");
    expect(text).not.toContain("wheel");
    expect(text).not.toContain("Headless (scripting)");
    const lines = text.split("\n");
    expect(lines).toHaveLength(24);
    expect(lines.filter((line) => line.trim() !== "").at(-1)).toMatch(/any key returns/);
  });

  it("keeps Esc when the terminal is shorter than the help list", () => {
    const frame = renderFrame({ ...emptyView("harness-manager"), help: true }, { cols: 72, rows: 18 });
    const lines = stripAnsi(frame).split("\n");
    expect(lines).toHaveLength(18);
    expect(lines.at(-1)).toMatch(/any key returns/);
  });
});
