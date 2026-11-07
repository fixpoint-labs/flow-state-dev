// @vitest-environment happy-dom
/**
 * A running task's view ends in a live line that says it is alive and what it
 * is doing now, the same line the teammates lab's task popup ends in. Without
 * it, a run between steps reads as a feed that went quiet. The line names the
 * most specific status there is (the tool call in flight, then the plan step
 * in progress, then the run's note, then a plain "Working..."), counts the
 * time since the run started, and is gone once the task stops running.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LabAdapter, TaskRow, TaskWork } from "../src/adapter";
import { SessionOverlayArea, SessionOverlayProvider } from "../src/components/flow-state/session-overlay";
import { TasksPane } from "../src/components/TasksPane";
import { ThreadView } from "../src/components/ThreadView";
import { toolRun } from "../src/lib/tool-steps";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STARTED = Date.UTC(2026, 10, 4, 9, 0, 0);

const RUNNING: TaskRow = { id: "t-1", title: "Fix session log ordering", goal: "Fix it", status: "in_progress", harness: "claude-code", startedAt: STARTED };

/** The run's entries so far: it has done things, and nothing new has arrived since. */
const DONE_SO_FAR: TaskWork["entries"] = [
  { kind: "assistant", id: "a1", text: "Now the core converter in `adapter.ts`." },
  { kind: "tool", id: "t1", ...toolRun([{ id: "c1", name: "Bash", args: { command: "ls" }, status: "done" }]) },
];

function open(task: TaskRow) {
  let show: (work: TaskWork) => void = () => {};
  const adapter = {
    watchTaskWork: (_: string, __: string, onChange: (work: TaskWork) => void) => {
      show = onChange;
      onChange({ entries: DONE_SO_FAR });
      return () => {};
    },
    taskActions: () => ({}),
  } as unknown as LabAdapter;
  // The view is a sheet, which draws into the area a provider hosts.
  const shown = (current: TaskRow) => (
    <SessionOverlayProvider>
      <SessionOverlayArea>
        <ThreadView adapter={adapter} sessionId="s-1" task={current} pinned={false} onClose={() => {}} />
      </SessionOverlayArea>
    </SessionOverlayProvider>
  );
  const view = render(shown(task));
  const pane = screen.getByRole("dialog", { name: `Task: ${task.title}` });
  return {
    pane,
    line: () => within(pane).queryByTestId("streaming-indicator"),
    setWork: (working: TaskWork["working"]) => act(() => show({ entries: DONE_SO_FAR, ...(working === undefined ? {} : { working }) })),
    setTask: (next: Partial<TaskRow>) => view.rerender(shown({ ...task, ...next })),
  };
}

describe("a running task's view ends in a live working line", () => {
  it("names the tool call in flight, then the plan step, then the note, then Working...", () => {
    const view = open(RUNNING);
    view.setWork({ inFlight: { tool: "Edit", args: { file_path: "src/adapter.ts" } }, plan: [{ title: "Add regression test", status: "in_progress" }] });
    expect(view.line()?.textContent).toContain("Edit src/adapter.ts");

    view.setWork({ plan: [{ title: "Read", status: "completed" }, { title: "Add regression test", status: "in_progress" }] });
    expect(view.line()?.textContent).toContain("Step 2 of 2: Add regression test");

    view.setWork(undefined);
    view.setTask({ statusNote: "Comparing SLA tiers" });
    expect(view.line()?.textContent).toContain("Comparing SLA tiers");
    view.setTask({ statusNote: undefined });
    expect(view.line()?.textContent).toMatch(/^Working\.\.\./);
  });

  it("counts the time since the run started, and keeps counting", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(STARTED + 4 * 60_000 + 12_000);
    const view = open(RUNNING);
    expect(within(view.pane).getByTestId("run-timer").textContent).toBe("4m 12s");
    act(() => vi.advanceTimersByTime(3_000));
    expect(within(view.pane).getByTestId("run-timer").textContent).toBe("4m 15s");
  });

  it.each(["completed", "errored", "cancelled"] as const)("is gone once the task is %s", (status) => {
    const view = open(RUNNING);
    expect(view.line()).not.toBeNull();
    view.setTask({ status });
    expect(view.line()).toBeNull();
  });

  it("is not shown while the task waits on you", () => {
    const view = open({ ...RUNNING, status: "held", openHold: { kind: "question", prompt: "Which region?" } });
    expect(view.line()).toBeNull();
  });
});

/** Session mode's opened background task: the same line, in the sheet the tasks pane opens. */
function openInPane(task: TaskRow) {
  let showWork: (work: TaskWork) => void = () => {};
  const adapter = {
    watchTaskWork: (_: string, __: string, onChange: (work: TaskWork) => void) => {
      showWork = onChange;
      onChange({ entries: DONE_SO_FAR });
      return () => {};
    },
    taskActions: () => ({}),
  } as unknown as LabAdapter;
  // The app reads the rows and hands them to the pane (FIX-2399 E1): a row change is a new `tasks` prop.
  const pane = (rows: TaskRow[]) => (
    <SessionOverlayProvider>
      <SessionOverlayArea>
        <TasksPane adapter={adapter} sessionId="s-1" tasks={rows} openId={task.id} onOpen={() => {}} onMissing={() => {}} />
      </SessionOverlayArea>
    </SessionOverlayProvider>
  );
  const { rerender } = render(pane([task]));
  const showTasks = (rows: TaskRow[]) => rerender(pane(rows));
  const sheet = () => screen.getByRole("dialog", { name: `Work: ${task.title}` });
  return {
    line: () => within(sheet()).queryByTestId("streaming-indicator"),
    setWork: (working: TaskWork["working"]) => act(() => showWork({ entries: DONE_SO_FAR, ...(working === undefined ? {} : { working }) })),
    setTask: (next: Partial<TaskRow>) => act(() => showTasks([{ ...task, ...next }])),
  };
}

describe("session mode's opened task ends in the same live working line", () => {
  it("names what the run is doing now, and falls back to Working...", () => {
    const view = openInPane(RUNNING);
    view.setWork({ inFlight: { tool: "Edit", args: { file_path: "src/adapter.ts" } } });
    expect(view.line()?.textContent).toContain("Edit src/adapter.ts");
    view.setWork(undefined);
    expect(view.line()?.textContent).toMatch(/^Working\.\.\./);
  });

  it("is gone once the task ends, and while it waits on you", () => {
    const view = openInPane(RUNNING);
    expect(view.line()).not.toBeNull();
    view.setTask({ openHold: { kind: "question", prompt: "Which region?" } });
    expect(view.line()).toBeNull();
    view.setTask({ status: "completed" });
    expect(view.line()).toBeNull();
  });
});
