// @vitest-environment happy-dom
/**
 * A running task's feed ends in a live line that says it is alive and what it
 * is doing now. Without it, a run between steps (a long test run, a big edit)
 * reads as a feed that went quiet, with only the header's RUNNING to go on.
 * The line names the most specific status there is (the tool call in flight,
 * then the plan step in progress, then a plain "Working..."), counts the time
 * since the run started, and is gone the moment the task stops running.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBoardTask, type BoardTask, type LabAdapter, type SessionStep, type WorkingNow } from "../src/adapter";
import { PopupView } from "../src/components/Popups";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STARTED = Date.UTC(2026, 10, 4, 9, 0, 0);

/** The run's steps so far: it has done things, and nothing new has arrived since its last step. */
const STEPS: SessionStep[] = [
  { id: "harness", kind: "harness", text: "Started on Claude Code" },
  { id: "brief", kind: "given", text: "Fix session log ordering." },
  { id: "t1", kind: "tool", tool: "Bash", text: "ls", code: true },
];

/** An adapter whose task row and run status a test sets by hand. */
function stub(task: BoardTask) {
  let showTasks: (tasks: BoardTask[]) => void = () => {};
  let showNow: (now: WorkingNow) => void = () => {};
  const watched: string[] = [];
  const adapter = {
    watchTasks: (_: string, onChange: (tasks: BoardTask[]) => void) => {
      showTasks = onChange;
      onChange([task]);
      return () => {};
    },
    watchRun: (_: string, onChange: (steps: SessionStep[]) => void) => {
      onChange(STEPS);
      return () => {};
    },
    watchReview: () => () => {},
    taskActions: () => ({}),
    watchWorking: (run: { sessionId: string; requestId?: string }, onChange: (now: WorkingNow) => void) => {
      watched.push(`${run.sessionId}/${run.requestId}`);
      showNow = onChange;
      onChange({});
      return () => {};
    },
  } as unknown as LabAdapter;
  return {
    adapter,
    watched,
    setTask: (next: Partial<BoardTask>) => act(() => showTasks([{ ...task, ...next }])),
    setNow: (now: WorkingNow) => act(() => showNow(now)),
  };
}

const RUNNING: BoardTask = {
  id: "t-1",
  to: "coder.claude-code",
  title: "Fix session log ordering",
  status: "running",
  boardStatus: "in_progress",
  goal: "Fix session log ordering after researcher replies.",
  runSessionId: "run-1",
  runRequestId: "req-1",
  harness: "Claude Code",
  startedAt: STARTED,
};

function open(lab: ReturnType<typeof stub>) {
  render(
    <PopupView
      adapter={lab.adapter}
      popup={{ kind: "task", sessionId: "conversation", taskId: RUNNING.id }}
      nameOf={(id) => id}
      lookOf={() => ({}) as never}
      isCoding={() => true}
      coders={[]}
      onClose={() => {}}
    />,
  );
  return screen.getByRole("dialog");
}

const line = (popup: HTMLElement) => within(popup).queryByTestId("streaming-indicator");

describe("a running task's feed ends in a live working line", () => {
  it("names the tool call in flight, then the plan step, then falls back to Working...", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(STARTED + 4 * 60_000 + 12_000);
    const lab = stub(RUNNING);
    const popup = open(lab);
    // The run it reads is the task's own: its session and its request.
    expect(lab.watched).toEqual(["run-1/req-1"]);

    lab.setNow({ inFlight: { tool: "Bash", args: { command: "cd labs/teammates && pnpm test" } }, plan: [{ title: "Add regression test", status: "in_progress" }] });
    expect(line(popup)?.textContent).toContain("Running pnpm test");

    // The command finished; the plan step in progress is the most specific status left.
    lab.setNow({ plan: [{ title: "Read the adapter", status: "completed" }, { title: "Add regression test", status: "in_progress" }, { title: "Run checks", status: "pending" }] });
    expect(line(popup)?.textContent).toContain("Step 2 of 3: Add regression test");

    // Nothing more specific: the run's own note, and with no note, the plain label.
    lab.setNow({});
    lab.setTask({ note: "Reading the session log" });
    expect(line(popup)?.textContent).toContain("Reading the session log");
    lab.setTask({ note: undefined });
    expect(line(popup)?.textContent).toMatch(/^Working\.\.\./);
  });

  it("follows a re-run in the same session: the new request is the run it reads", () => {
    const lab = stub(RUNNING);
    open(lab);
    lab.setTask({ runRequestId: "req-2" });
    expect(lab.watched).toEqual(["run-1/req-1", "run-1/req-2"]);
  });

  it("counts the time since the run started, and keeps counting", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(STARTED + 4 * 60_000 + 12_000);
    const popup = open(stub(RUNNING));
    expect(within(popup).getByTestId("run-timer").textContent).toBe("(4m 12s)");
    act(() => vi.advanceTimersByTime(3_000));
    expect(within(popup).getByTestId("run-timer").textContent).toBe("(4m 15s)");
  });

  it.each([
    ["done", { status: "done", boardStatus: "completed", result: "Fixed." }],
    ["failed", { status: "failed", boardStatus: "errored", error: "The checks stayed red." }],
    ["cancelled", { status: "cancelled", boardStatus: "cancelled" }],
  ] as const)("is gone once the task is %s", (_, ended) => {
    const lab = stub(RUNNING);
    const popup = open(lab);
    expect(line(popup)).not.toBeNull();
    lab.setTask(ended);
    expect(line(popup)).toBeNull();
    expect(within(popup).getByText(ended.status, { selector: "[data-popup-status]" })).toBeTruthy();
  });

  it("is not shown while the task waits on you: the hold says what it needs instead", () => {
    const popup = open(stub({ ...RUNNING, waiting: { kind: "question", prompt: "Which file?", unanswerable: null } }));
    expect(within(popup).getByRole("region", { name: "Waiting on you" })).toBeTruthy();
    expect(line(popup)).toBeNull();
  });

  it("reads its note, start and run request off the board row the run writes", () => {
    const row = { id: "t-1", status: "in_progress", assignee: "coder.cursor", title: "Fix it", statusNote: "Reading the log", run: { sessionId: "run-1", requestId: "req-1", attempt: 1, startedAt: STARTED } };
    expect(toBoardTask(row)).toMatchObject({ status: "running", note: "Reading the log", startedAt: STARTED, runSessionId: "run-1", runRequestId: "req-1" });
    // The row's own start wins over its run link's.
    expect(toBoardTask({ ...row, startedAt: STARTED - 1 }).startedAt).toBe(STARTED - 1);
  });
});
