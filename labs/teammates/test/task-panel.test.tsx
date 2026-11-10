// @vitest-environment happy-dom
/**
 * A teammate's panel says at a glance what is running, what
 * failed and why, and what finished most recently (FIX-2395); a task's line
 * in the conversation uses the same word and colour as its panel row, so the
 * two never disagree on how a task stands.
 *
 * Red states produced before this was trusted: on `main` (filing order, no
 * order by time, *Failed* collapsed with no reason, *Done* uncapped) every panel case
 * fails; read `waiting` out of `taskPresentation` and the card case fails; drop
 * the times from the board's `listTasks` rows and the adapter case fails.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { taskView } from "@flow-state-dev/orchestration/inbox";
import { afterEach, describe, expect, it } from "vitest";
import { toBoardTask, type BoardTask, type LabAdapter, type LabWorker } from "../src/adapter";
import { TaskCard } from "../src/components/TaskCard";
import { TeammatePanel } from "../src/components/TeammatePanel";
import { lookOf } from "../src/lib/looks";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const NOW = Date.now();
const MIN = 60_000;

/** A task with its row's view, as the adapter reads one: its times are the board's `createdAt` / `startedAt` / `completedAt`. */
const task = (id: string, over: Partial<BoardTask>, times: { createdAt?: number; startedAt?: number; completedAt?: number } = {}): BoardTask => {
  const t: BoardTask = { id, to: "researcher", title: `Task ${id}`, status: "running", boardStatus: "in_progress", goal: `Task ${id}`, ...over };
  return { ...t, view: taskView({ id, status: t.boardStatus, title: t.title, goal: t.goal, board: "s1", ...times }) };
};

const TASKS: BoardTask[] = [
  task("r-old", {}, { startedAt: NOW - 42 * MIN }),
  task("r-asks", { waiting: { kind: "question", prompt: "Which branch?", unanswerable: null } }, { startedAt: NOW - 3 * MIN }),
  task("f-old", { status: "failed", boardStatus: "errored", error: "Tests did not pass\nstack…" }, { completedAt: NOW - 50 * MIN }),
  task("f-new", { status: "failed", boardStatus: "errored", error: "No sign-in found" }, { completedAt: NOW - 5 * MIN }),
  ...Array.from({ length: 7 }, (_, i) => task(`d${i}`, { status: "done", boardStatus: "completed" }, { completedAt: NOW - (10 + i) * MIN })),
  task("c1", { status: "cancelled", boardStatus: "cancelled" }, { completedAt: NOW - MIN }),
];

const worker: LabWorker = { id: "chief", name: "Lead", role: "Routes work", instructions: "", own: false } as LabWorker;

/** Just what the panel watches: one conversation's tasks, and a connection that never went stale. */
const adapter = {
  watchTasks: (_: string, onChange: (tasks: BoardTask[]) => void) => (onChange(TASKS), () => {}),
  watchConnection: () => () => {},
} as unknown as LabAdapter;

function renderPanel(a: LabAdapter = adapter) {
  render(<TeammatePanel adapter={a} worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} isCoding={() => false} onOpen={() => {}} />);
  return screen.getByRole("complementary", { name: "Lead's panel" });
}

const rows = (list: HTMLElement) => within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
const statusOf = (list: HTMLElement, i: number) => list.querySelectorAll("[data-status]")[i]!.textContent;

describe("a teammate's tasks in its panel", () => {
  it("counts them in the heading", () => {
    const panel = renderPanel();
    // The total, then FIX-2394's counts by state.
    expect(panel.querySelector("#tasks-heading")!.textContent).toMatch(/^Tasks \(12\) · /);
  });

  it("puts a task waiting on you first among the running ones", () => {
    const panel = renderPanel();
    const running = within(panel).getByRole("list", { name: "Running" });
    expect(rows(running)).toEqual(["Asked researcher to task r-asks", "Asked researcher to task r-old"]);
    expect(statusOf(running, 0)).toBe("waiting on you");
    expect(statusOf(running, 1)).not.toContain("waiting on you");
  });

  it("shows the failed ones without a click, newest first, each with its reason's first line", () => {
    const panel = renderPanel();
    const failed = within(panel).getByRole("list", { name: "Failed" });
    expect(rows(failed)).toEqual(["Asked researcher to task f-new", "Asked researcher to task f-old"]);
    expect(statusOf(failed, 0)).toMatch(/^failed · .* · No sign-in found$/);
    expect(statusOf(failed, 1)).toMatch(/^failed · .* · Tests did not pass$/);
  });

  it("opens Done to its newest five, and Show all to the rest", () => {
    const panel = renderPanel();
    expect(within(panel).queryByRole("list", { name: "Done" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /Done \(7\)/ }));
    const done = within(panel).getByRole("list", { name: "Done" });
    expect(rows(done)).toEqual(["d0", "d1", "d2", "d3", "d4"].map((id) => `Asked researcher to task ${id}`));
    fireEvent.click(within(panel).getByRole("button", { name: "Show all 7" }));
    expect(rows(within(panel).getByRole("list", { name: "Done" }))).toHaveLength(7);
    expect(within(panel).queryByRole("button", { name: "Show all 7" })).toBeNull();
  });
});

/** A busy conversation: six running tasks and seven failed ones. */
const BUSY: BoardTask[] = [
  ...Array.from({ length: 6 }, (_, i) => task(`r${i}`, {}, { startedAt: NOW - (i + 1) * MIN })),
  ...Array.from({ length: 7 }, (_, i) =>
    task(`f${i}`, { status: "failed", boardStatus: "errored", error: "boom" }, { completedAt: NOW - (i + 1) * MIN }),
  ),
];
const busy = (tasks: BoardTask[]) =>
  ({ watchTasks: (_: string, onChange: (t: BoardTask[]) => void) => (onChange(tasks), () => {}), watchConnection: () => () => {} }) as unknown as LabAdapter;

describe("a busy panel stays short", () => {
  // Red state: on the parent commit Failed lists all seven, with no Show all and no Clear.
  it("never caps the running tasks: active work is always in sight", () => {
    const panel = renderPanel(busy(BUSY));
    expect(rows(within(panel).getByRole("list", { name: "Running" }))).toHaveLength(6);
  });

  it("shows the newest five failed, and Show all / Show fewer to reach the older ones", () => {
    const panel = renderPanel(busy(BUSY));
    const failedIds = () => rows(within(panel).getByRole("list", { name: "Failed" }));
    expect(failedIds()).toEqual(["f0", "f1", "f2", "f3", "f4"].map((id) => `Asked researcher to task ${id}`));
    fireEvent.click(within(panel).getByRole("button", { name: "Show all 7" }));
    expect(failedIds()).toHaveLength(7);
    fireEvent.click(within(panel).getByRole("button", { name: "Show fewer" }));
    expect(failedIds()).toHaveLength(5);
  });

  it("clears failed rows from the panel only: the heading still counts them, and they can come back", () => {
    const panel = renderPanel(busy(BUSY));
    fireEvent.click(within(panel).getByRole("button", { name: "Clear failed (7)" }));
    expect(within(panel).queryByRole("list", { name: "Failed" })).toBeNull();
    // Not deleted: the task is still the board's, so the heading's total keeps it.
    expect(panel.querySelector("#tasks-heading")!.textContent).toMatch(/^Tasks \(13\)/);
    expect(rows(within(panel).getByRole("list", { name: "Running" }))).toHaveLength(6);
    fireEvent.click(within(panel).getByRole("button", { name: "Show 7 cleared" }));
    expect(rows(within(panel).getByRole("list", { name: "Failed" }))).toHaveLength(5);
  });

  it("remembers a clear across a reload, but shows a task again when it fails anew", () => {
    let panel = renderPanel(busy(BUSY));
    fireEvent.click(within(panel).getByRole("button", { name: "Clear failed (7)" }));
    cleanup();
    panel = renderPanel(busy(BUSY));
    expect(within(panel).queryByRole("list", { name: "Failed" })).toBeNull();
    cleanup();
    // f0 was retried and failed again: it ended at a new time, so it shows.
    const refailed = BUSY.map((t) => (t.id === "f0" ? task("f0", { status: "failed", boardStatus: "errored" }, { completedAt: NOW }) : t));
    panel = renderPanel(busy(refailed));
    expect(rows(within(panel).getByRole("list", { name: "Failed" }))).toEqual(["Asked researcher to task f0"]);
    expect(within(panel).getByRole("button", { name: "Show 6 cleared" })).toBeTruthy();
  });
});

describe("a task's line in the conversation", () => {
  it("uses its panel row's word and colour", () => {
    for (const t of [TASKS[1]!, TASKS[2]!, TASKS[0]!]) {
      const { unmount } = render(<TaskCard task={t} nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} onOpen={() => {}} />);
      const word = document.querySelector("[data-task-status]")!;
      expect(word.textContent).toBe(t.waiting ? "waiting on you" : t.status);
      expect(word.className).toContain(t.waiting ? "text-attention" : t.status === "failed" ? "text-destructive" : "text-muted-foreground");
      unmount();
    }
  });
});

describe("a board row's times, as the adapter reads them", () => {
  it("passes when it was filed, first started and ended through to the task's view", () => {
    const row = { id: "t1", status: "completed", goal: "g", createdAt: 1, startedAt: 2, completedAt: 3, updatedAt: 3 };
    expect(toBoardTask(row).view?.times).toMatchObject({ createdAt: 1, startedAt: 2, completedAt: 3 });
  });

  it("keeps the feed's start on this attempt, not the task's first start", () => {
    // A retried task: its first run started at 2, this attempt at 5.
    const row = { id: "t1", status: "in_progress", goal: "g", createdAt: 1, startedAt: 2, run: { sessionId: "r", startedAt: 5 } };
    const t = toBoardTask(row);
    expect(t.startedAt).toBe(5);
    expect(t.view?.times.startedAt).toBe(2);
  });
});
