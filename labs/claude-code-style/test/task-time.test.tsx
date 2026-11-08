// @vitest-environment happy-dom
/**
 * A background task's time in the pane and on the threads board: a running
 * card times this attempt's run, a run that stopped answering (its lease
 * lapsed, the board's own rule) reads *quiet* in the warning colour, a
 * finished row says how long ago it ended, and the pane's heading counts each
 * state. The board's age on a running row, which a lease renewal kept at
 * "now", is gone.
 *
 * Red states produced before this was trusted: the card's label drawn without
 * `TaskTime` (the pane case fails), the board's `age(updatedAt)` put back in
 * place of `TaskTime` (the board case fails).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { taskView } from "@flow-state-dev/orchestration/inbox";
import type { LabAdapter, TaskRow, TaskStatus } from "../src/adapter";
import { TasksPane } from "../src/components/TasksPane";
import { ThreadsBoard } from "../src/components/ThreadsBoard";

afterEach(cleanup);

const MIN = 60_000;

/** A pane row as the adapter reads one from the board's `listTasks` row. */
function row(id: string, title: string, status: TaskStatus, times: { updatedAt: number; startedAt?: number; leaseUntil?: number }): TaskRow {
  const { startedAt, leaseUntil, updatedAt } = times;
  return {
    id,
    title,
    goal: title,
    status,
    updatedAt,
    view: taskView({ id, title, goal: title, status, board: "s1", updatedAt }),
    ...(startedAt === undefined && leaseUntil === undefined ? {} : { run: { ...(startedAt === undefined ? {} : { startedAt }), ...(leaseUntil === undefined ? {} : { leaseUntil }) } }),
  };
}

const adapter = { watchPins: () => () => {} } as unknown as LabAdapter;

describe("a task's time in the tasks pane", () => {
  it("times a working run, marks one that stopped answering quiet, ages a finished one, and counts each state", () => {
    const now = Date.now();
    const tasks = [
      row("t1", "Research Acme", "in_progress", { updatedAt: now - 20_000, startedAt: now - (4 * MIN + 12_000), leaseUntil: now + 100_000 }),
      row("t2", "Research Globex", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN }),
      row("t3", "Draft the outline", "completed", { updatedAt: now - 12 * MIN }),
    ];
    render(<TasksPane adapter={adapter} sessionId="s1" tasks={tasks} openId={undefined} onOpen={() => {}} onMissing={() => {}} />);
    const pane = screen.getByRole("complementary", { name: "Background tasks" });
    expect(within(pane).getByText(/^Background tasks · 2 running · 1 done$/)).toBeTruthy();

    const working = within(pane).getByText(/^working · 4m 1[23]s$/);
    expect(working.getAttribute("data-task-signal")).toBe("working");
    const quiet = within(pane).getByText("quiet for 40m");
    expect(quiet.className).toContain("text-warning");
    expect(within(pane).getByText("12m ago")).toBeTruthy();
  });
});

describe("a task's time while the pane's read is stale", () => {
  it("never calls a run quiet from rows its last read may have left behind, and marks the pane stale", () => {
    const now = Date.now();
    const tasks = [row("t2", "Research Globex", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })];
    render(<TasksPane adapter={adapter} sessionId="s1" tasks={tasks} stale openId={undefined} onOpen={() => {}} onMissing={() => {}} />);
    const pane = screen.getByRole("complementary", { name: "Background tasks" });
    expect(pane.hasAttribute("data-stale")).toBe(true);
    expect(within(pane).queryByText(/quiet/)).toBeNull();
    expect(within(pane).getByText(/^working · 45m 0s$|^working · 45m 1s$/)).toBeTruthy();
  });

  it("never calls a run quiet on the threads board while the read is stale", () => {
    const now = Date.now();
    const tasks = [row("t2", "Research Globex", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })];
    render(<ThreadsBoard adapter={adapter} sessionId="s1" tasks={tasks} stale openId={undefined} onOpen={() => {}} onMissing={() => {}} />);
    const board = screen.getByRole("complementary", { name: "Tasks" });
    expect(within(board).queryByText(/quiet/)).toBeNull();
  });
});

describe("a task's time on the threads board", () => {
  it("shows a running row's clock, never an age its heartbeat keeps at now", () => {
    const now = Date.now();
    const tasks = [row("t1", "Research Acme", "in_progress", { updatedAt: now - 5_000, startedAt: now - 9 * MIN, leaseUntil: now + 100_000 })];
    render(<ThreadsBoard adapter={adapter} sessionId="s1" tasks={tasks} openId={undefined} onOpen={() => {}} onMissing={() => {}} />);
    const board = screen.getByRole("complementary", { name: "Tasks" });
    expect(within(board).getByText(/^working · 9m 0s$|^working · 9m 1s$/)).toBeTruthy();
    expect(within(board).queryByText("now")).toBeNull();
  });
});
