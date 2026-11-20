// @vitest-environment happy-dom
/**
 * A running task's view ends in a live line that says it is alive and what it
 * is doing now, the same line the teammates lab's task popup ends in. Without
 * it, a run between steps reads as a feed that went quiet. The line names the
 * most specific status there is (the tool call in flight, then the plan step
 * in progress, then the run's note, then a plain "Working..."), counts the
 * time since the run started, and is gone once the task stops running. It is
 * the registry's `StreamingIndicator`, the line the teammates popup draws, so
 * a long command keeps to one line with the whole of it on hover.
 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingBoardTask } from "../src/app";
import { ask, codingBoardTask } from "./coding-board-task";
import { SessionOverlayArea, SessionOverlayProvider } from "../src/components/flow-state/session-overlay";
import { TasksPane } from "../src/components/TasksPane";
import { ThreadView } from "../src/components/ThreadView";
import { RUN, stubServer } from "./stub-server";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STARTED = Date.UTC(2026, 10, 4, 9, 0, 0);

const RUNNING: CodingBoardTask = codingBoardTask({ id: "t-1", title: "Fix session log ordering", goal: "Fix it", harness: "claude-code", startedAt: STARTED, run: { ...RUN, attempt: 1 } });

/** A tool call of the run, as its session stores it: `in_progress` while it runs. */
const call = (id: string, name: string, args: unknown, status: "completed" | "in_progress") => ({
  id,
  requestId: RUN.requestId,
  type: "tool_output",
  status,
  ts: 1,
  itemIndex: 0,
  blockName: name,
  output: status === "completed" ? "ok" : null,
  toolCall: { callId: id, name, arguments: JSON.stringify(args), generatorBlock: "claude-code" },
});

/** The run's items so far: it has done things, and nothing new has arrived since. */
const DONE_SO_FAR = [
  { id: "a1", requestId: RUN.requestId, type: "message", role: "assistant", status: "completed", ts: 1, itemIndex: 0, content: [{ type: "output_text", text: "Now the core converter in `adapter.ts`." }] },
  call("c1", "Bash", { command: "ls" }, "completed"),
];

/** What the run is doing now: the call in flight, and the plan its harness recorded. */
type Now = { inFlight?: { tool: string; args: unknown }; plan?: { title: string; status: string }[] };

/** The run as the stand-in serves it: what it did so far, plus `now`. */
function server(now: Now = {}) {
  return stubServer({
    items: { [RUN.sessionId]: [...DONE_SO_FAR, ...(now.inFlight === undefined ? [] : [call("c2", now.inFlight.tool, now.inFlight.args, "in_progress")])] },
    recorded: now.plan === undefined ? {} : { [RUN.requestId]: { plan: { rows: now.plan.map((step, i) => ({ id: `p${i}`, ...step })), truncated: false } } },
  });
}

function open(task: CodingBoardTask, now: Now = {}) {
  const { wrap } = server(now);
  // The view is a sheet, which draws into the area a provider hosts.
  const shown = (current: CodingBoardTask) =>
    wrap(
      <SessionOverlayProvider>
        <SessionOverlayArea>
          <ThreadView sessionId="s-1" task={current} pinned={false} onClose={() => {}} />
        </SessionOverlayArea>
      </SessionOverlayProvider>,
    );
  const view = render(shown(task));
  const pane = screen.getByRole("dialog", { name: `Task: ${task.title}` });
  return {
    pane,
    line: () => within(pane).queryByTestId("streaming-indicator"),
    setTask: (next: Partial<CodingBoardTask>) => view.rerender(shown({ ...task, ...next })),
  };
}

describe("a running task's view ends in a live working line", () => {
  it("names the tool call in flight, then the plan step, then the note, then Working...", async () => {
    const inFlight = open(RUNNING, { inFlight: { tool: "Edit", args: { file_path: "src/adapter.ts" } }, plan: [{ title: "Add regression test", status: "in_progress" }] });
    await waitFor(() => expect(inFlight.line()?.textContent).toContain("Edit src/adapter.ts"));
    cleanup();

    const planned = open(RUNNING, { plan: [{ title: "Read", status: "completed" }, { title: "Add regression test", status: "in_progress" }] });
    await waitFor(() => expect(planned.line()?.textContent).toContain("Step 2 of 2: Add regression test"));
    cleanup();

    const view = open(RUNNING);
    view.setTask({ statusNote: "Comparing SLA tiers" });
    expect(view.line()?.textContent).toContain("Comparing SLA tiers");
    view.setTask({ statusNote: undefined });
    expect(view.line()?.textContent).toMatch(/^Working\.\.\./);
  });

  it("counts the time since the run started, and keeps counting", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(STARTED + 4 * 60_000 + 12_000);
    const view = open(RUNNING);
    expect(within(view.pane).getByTestId("run-timer").textContent).toBe("(4m 12s)");
    act(() => vi.advanceTimersByTime(3_000));
    expect(within(view.pane).getByTestId("run-timer").textContent).toBe("(4m 15s)");
  });

  it("keeps a long command to one line, whole on hover", async () => {
    const command = "pnpm --filter @flow-state-dev/engine test -- --reporter=verbose test/stream-resume.test.ts";
    const view = open(RUNNING, { inFlight: { tool: "Bash", args: { command } } });
    const said = await waitFor(() => within(view.line()!).getByTitle(/^Running pnpm --filter/));
    expect(said.title).toBe(said.textContent);
    expect(said.className).toContain("truncate");
  });

  it.each(["completed", "errored", "cancelled"] as const)("is gone once the task is %s", (status) => {
    const view = open(RUNNING);
    expect(view.line()).not.toBeNull();
    view.setTask({ status });
    expect(view.line()).toBeNull();
  });

  it("is not shown while the task waits on you", () => {
    const view = open({ ...RUNNING, status: "held", asks: [ask("question", "Which region?")] });
    expect(view.line()).toBeNull();
  });
});

/** Session mode's opened background task: the same line, in the sheet the tasks pane opens. */
function openInPane(task: CodingBoardTask, now: Now = {}) {
  const { wrap } = server(now);
  // The app reads the rows and hands them to the pane (FIX-2399 E1): a row change is a new `tasks` prop.
  const pane = (rows: CodingBoardTask[]) =>
    wrap(
      <SessionOverlayProvider>
        <SessionOverlayArea>
          <TasksPane sessionId="s-1" tasks={rows} openId={task.id} onOpen={() => {}} onMissing={() => {}} />
        </SessionOverlayArea>
      </SessionOverlayProvider>,
    );
  const { rerender } = render(pane([task]));
  const showTasks = (rows: CodingBoardTask[]) => rerender(pane(rows));
  const sheet = () => screen.getByRole("dialog", { name: `Work: ${task.title}` });
  return {
    line: () => within(sheet()).queryByTestId("streaming-indicator"),
    setTask: (next: Partial<CodingBoardTask>) => act(() => showTasks([{ ...task, ...next }])),
  };
}

describe("session mode's opened task ends in the same live working line", () => {
  it("names what the run is doing now, and falls back to Working...", async () => {
    const busy = openInPane(RUNNING, { inFlight: { tool: "Edit", args: { file_path: "src/adapter.ts" } } });
    await waitFor(() => expect(busy.line()?.textContent).toContain("Edit src/adapter.ts"));
    cleanup();
    const idle = openInPane(RUNNING);
    expect(idle.line()?.textContent).toMatch(/^Working\.\.\./);
  });

  it("is gone once the task ends, and while it waits on you", () => {
    const view = openInPane(RUNNING);
    expect(view.line()).not.toBeNull();
    view.setTask({ asks: [ask("question", "Which region?")] });
    expect(view.line()).toBeNull();
    view.setTask({ status: "completed" });
    expect(view.line()).toBeNull();
  });
});
