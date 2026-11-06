// @vitest-environment happy-dom
/**
 * A teammate's panel says at a glance what is running, what
 * failed and why, and what finished most recently (FIX-2395); a task's line
 * in the conversation uses the same word and colour as its panel row, so the
 * two never disagree on how a task stands.
 *
 * Red states produced before this was trusted: on `main` (filing order, no
 * order by time, *Failed* collapsed with no reason, *Done* uncapped) every panel case
 * fails; read `waiting` out of `taskRowPresentation` and the card case fails; drop
 * the times from the board's `listTasks` rows and the adapter case fails.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { taskRowView } from "@flow-state-dev/orchestration/inbox";
import { afterEach, describe, expect, it } from "vitest";
import { toBoardTask, type BoardTask, type LabAdapter, type WorkerRow } from "../src/adapter";
import { TaskCard } from "../src/components/TaskCard";
import { TeammatePanel } from "../src/components/TeammatePanel";
import { lookOf } from "../src/lib/looks";

afterEach(cleanup);

const NOW = Date.now();
const MIN = 60_000;

/** A task with its row's view, as the adapter reads one: its times are the board's `createdAt` / `startedAt` / `completedAt`. */
const task = (id: string, over: Partial<BoardTask>, times: { createdAt?: number; startedAt?: number; completedAt?: number } = {}): BoardTask => {
  const t: BoardTask = { id, to: "researcher", title: `Task ${id}`, status: "running", boardStatus: "in_progress", goal: `Task ${id}`, ...over };
  return { ...t, view: taskRowView({ id, status: t.boardStatus, title: t.title, goal: t.goal, board: "s1", ...times }) };
};

const TASKS: BoardTask[] = [
  task("r-old", {}, { startedAt: NOW - 42 * MIN }),
  task("r-asks", { waiting: { kind: "question", prompt: "Which branch?", unanswerable: null } }, { startedAt: NOW - 3 * MIN }),
  task("f-old", { status: "failed", boardStatus: "errored", error: "Tests did not pass\nstack…" }, { completedAt: NOW - 50 * MIN }),
  task("f-new", { status: "failed", boardStatus: "errored", error: "No sign-in found" }, { completedAt: NOW - 5 * MIN }),
  ...Array.from({ length: 7 }, (_, i) => task(`d${i}`, { status: "done", boardStatus: "completed" }, { completedAt: NOW - (10 + i) * MIN })),
  task("c1", { status: "cancelled", boardStatus: "cancelled" }, { completedAt: NOW - MIN }),
];

const worker: WorkerRow = { id: "chief", name: "Chief of Staff", role: "Routes work", instructions: "", own: false } as WorkerRow;

/** Just what the panel watches: one conversation's tasks, and a connection that never went stale. */
const adapter = {
  watchTasks: (_: string, onChange: (tasks: BoardTask[]) => void) => (onChange(TASKS), () => {}),
  watchConnection: () => () => {},
} as unknown as LabAdapter;

function renderPanel() {
  render(<TeammatePanel adapter={adapter} worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} isCoding={() => false} onOpen={() => {}} />);
  return screen.getByRole("complementary", { name: "Chief of Staff's panel" });
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
