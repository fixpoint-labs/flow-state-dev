// @vitest-environment happy-dom
/**
 * A teammate's panel says at a glance what is running, what
 * failed and why, and what finished most recently (FIX-2395); a task's line
 * in the conversation uses the same word and colour as its panel row, so the
 * two never disagree on how a task stands.
 *
 * Red states produced before this was trusted: on `main` (filing order, no
 * order by time, *Failed* collapsed with no reason, *Done* uncapped) every panel case
 * fails; read `asks` out of `taskPresentation` and the card case fails; read the
 * task's own start for this attempt's and the row case fails.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationView } from "../src/lib/conversation";
import { scriptedServer, rosterEntry } from "./scripted-server";
import { Conversation } from "../src/components/Conversation";
import { attemptStartedAt, viewOf } from "../src/lib/task";
import { codingTask, hold, POPUP_READ, standInFollower, stubServer, TestProvider } from "./stub-server";
import { TaskCard } from "../src/components/TaskCard";
import { TeammatePanel } from "../src/components/TeammatePanel";
import { lookOf } from "../src/lib/looks";
import { filed, linesOf } from "./lines";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const NOW = Date.now();
const MIN = 60_000;

/** A coding board row, running for researcher unless `over` says otherwise, with the board's `createdAt` / `startedAt` / `completedAt`. */
const task = (id: string, over: Partial<CodingBoardTask>, times: { createdAt?: number; startedAt?: number; completedAt?: number } = {}): CodingBoardTask =>
  codingTask({ id, assignee: "researcher", title: `Task ${id}`, status: "in_progress", ...over, ...times });

const TASKS: CodingBoardTask[] = [
  task("r-old", {}, { startedAt: NOW - 42 * MIN }),
  task("r-asks", { asks: [hold("question", "Which branch?")] }, { startedAt: NOW - 3 * MIN }),
  task("f-old", { status: "errored", error: "Tests did not pass\nstack…" }, { completedAt: NOW - 50 * MIN }),
  task("f-new", { status: "errored", error: "No sign-in found" }, { completedAt: NOW - 5 * MIN }),
  ...Array.from({ length: 7 }, (_, i) => task(`d${i}`, { status: "completed" }, { completedAt: NOW - (10 + i) * MIN })),
  task("c1", { status: "cancelled" }, { completedAt: NOW - MIN }),
];

const worker = rosterEntry({ id: "chief", name: "Lead", description: "Routes work" });


/** The panel over a stand-in board holding `tasks`, once its rows are drawn. */
async function renderPanel(tasks: CodingBoardTask[] = TASKS) {
  const { client } = stubServer({ board: { s1: tasks } });
  render(
    <TestProvider client={client}>
      <TeammatePanel worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} isCoding={() => false} onOpen={() => {}} />
    </TestProvider>,
  );
  const panel = screen.getByRole("complementary", { name: "Lead's panel" });
  await within(panel).findByText(/^Tasks \(/);
  return panel;
}

const rows = (list: HTMLElement) => within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
const statusOf = (list: HTMLElement, i: number) => list.querySelectorAll("[data-status]")[i]!.textContent;

describe("a teammate's tasks in its panel", () => {
  it("counts them in the heading", async () => {
    const panel = await renderPanel();
    // The total, then FIX-2394's counts by state.
    expect(panel.querySelector("#tasks-heading")!.textContent).toMatch(/^Tasks \(12\) · /);
  });

  it("puts a task waiting on you first among the running ones", async () => {
    const panel = await renderPanel();
    const running = within(panel).getByRole("list", { name: "Running" });
    expect(rows(running)).toEqual(["Asked researcher to task r-asks", "Asked researcher to task r-old"]);
    expect(statusOf(running, 0)).toBe("waiting on you");
    expect(statusOf(running, 1)).not.toContain("waiting on you");
  });

  it("shows the failed ones without a click, newest first, each with its reason's first line", async () => {
    const panel = await renderPanel();
    const failed = within(panel).getByRole("list", { name: "Failed" });
    expect(rows(failed)).toEqual(["Asked researcher to task f-new", "Asked researcher to task f-old"]);
    expect(statusOf(failed, 0)).toMatch(/^failed · .* · No sign-in found$/);
    expect(statusOf(failed, 1)).toMatch(/^failed · .* · Tests did not pass$/);
  });

  it("opens Done to its newest five, and Show all to the rest", async () => {
    const panel = await renderPanel();
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
const BUSY: CodingBoardTask[] = [
  ...Array.from({ length: 6 }, (_, i) => task(`r${i}`, {}, { startedAt: NOW - (i + 1) * MIN })),
  ...Array.from({ length: 7 }, (_, i) =>
    task(`f${i}`, { status: "errored", error: "boom" }, { completedAt: NOW - (i + 1) * MIN }),
  ),
];

describe("a busy panel stays short", () => {
  // Red state: on the parent commit Failed lists all seven, with no Show all and no Clear.
  it("never caps the running tasks: active work is always in sight", async () => {
    const panel = await renderPanel(BUSY);
    expect(rows(within(panel).getByRole("list", { name: "Running" }))).toHaveLength(6);
  });

  it("shows the newest five failed, and Show all / Show fewer to reach the older ones", async () => {
    const panel = await renderPanel(BUSY);
    const failedIds = () => rows(within(panel).getByRole("list", { name: "Failed" }));
    expect(failedIds()).toEqual(["f0", "f1", "f2", "f3", "f4"].map((id) => `Asked researcher to task ${id}`));
    fireEvent.click(within(panel).getByRole("button", { name: "Show all 7" }));
    expect(failedIds()).toHaveLength(7);
    fireEvent.click(within(panel).getByRole("button", { name: "Show fewer" }));
    expect(failedIds()).toHaveLength(5);
  });

  it("clears failed rows from the panel only: the heading still counts them, and they can come back", async () => {
    const panel = await renderPanel(BUSY);
    fireEvent.click(within(panel).getByRole("button", { name: "Clear failed (7)" }));
    expect(within(panel).queryByRole("list", { name: "Failed" })).toBeNull();
    // Not deleted: the task is still the board's, so the heading's total keeps it.
    expect(panel.querySelector("#tasks-heading")!.textContent).toMatch(/^Tasks \(13\)/);
    expect(rows(within(panel).getByRole("list", { name: "Running" }))).toHaveLength(6);
    fireEvent.click(within(panel).getByRole("button", { name: "Show 7 cleared" }));
    expect(rows(within(panel).getByRole("list", { name: "Failed" }))).toHaveLength(5);
  });

  it("remembers a clear across a reload, but shows a task again when it fails anew", async () => {
    let panel = await renderPanel(BUSY);
    fireEvent.click(within(panel).getByRole("button", { name: "Clear failed (7)" }));
    cleanup();
    panel = await renderPanel(BUSY);
    expect(within(panel).queryByRole("list", { name: "Failed" })).toBeNull();
    cleanup();
    // f0 was retried and failed again: it ended at a new time, so it shows.
    const refailed = BUSY.map((t) => (t.id === "f0" ? task("f0", { status: "errored" }, { completedAt: NOW }) : t));
    panel = await renderPanel(refailed);
    expect(rows(within(panel).getByRole("list", { name: "Failed" }))).toEqual(["Asked researcher to task f0"]);
    expect(within(panel).getByRole("button", { name: "Show 6 cleared" })).toBeTruthy();
  });
});

describe("a task's line in the conversation", () => {
  it("draws a filed task the moment it is filed and fills it in place from its board row: the same card from filing to done", async () => {
    // The conversation names the filing; the board has no row for it yet.
    const view: ConversationView = { lines: linesOf([filed("k1", "q1", { taskId: "t1", title: "Fix the typo", assignee: "teammates.cursor" })]), running: false, stopping: false, backgroundRunning: 0 };
    // The scripted server answers the roster and the conversation's other package views; its conversation is this one line.
    const { Follower } = standInFollower("s1", view);
    const server = stubServer({ board: { s1: [] } });
    render(
      <TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}>
        <Follower />
        <Conversation worker={worker} sessionId="s1" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => true} harnessOf={() => "Cursor"} onFire={async () => {}} onOpen={() => {}} />
      </TestProvider>,
    );
    const card = screen.getByRole("button", { name: "Coding task: Fix the typo, on Cursor" }).closest("[data-entry=task]")!;
    expect(card.querySelector("[data-task-status]")?.textContent).toBe("running");
    // The row arrives, then ends: the same card reads it.
    server.board.s1!.push(codingTask({ id: "t1", assignee: "teammates.cursor", harness: "cursor", title: "Fix the typo", status: "completed" }));
    await waitFor(() => expect(card.querySelector("[data-task-status]")?.textContent).toBe("done"), POPUP_READ);
    expect(screen.getByRole("button", { name: "Coding task: Fix the typo, on Cursor" }).closest("[data-entry=task]")).toBe(card);
  });

  it("uses its panel row's word and colour", () => {
    for (const t of [TASKS[1]!, TASKS[2]!, TASKS[0]!]) {
      const { unmount } = render(<TaskCard task={t} nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} onOpen={() => {}} />);
      const word = document.querySelector("[data-task-status]")!;
      const asks = t.asks.length > 0;
      expect(word.textContent).toBe(asks ? "waiting on you" : t.status === "errored" ? "failed" : "running");
      expect(word.className).toContain(asks ? "text-attention" : t.status === "errored" ? "text-destructive" : "text-muted-foreground");
      unmount();
    }
  });
});

describe("a board row's times, as the screen reads them", () => {
  it("passes when it was filed, first started and ended through to the task's view", () => {
    const row = codingTask({ id: "t1", status: "completed", createdAt: 1, startedAt: 2, completedAt: 3, updatedAt: 3 });
    expect(viewOf(row).times).toMatchObject({ createdAt: 1, startedAt: 2, completedAt: 3 });
  });

  it("keeps the feed's start on this attempt, not the task's first start", () => {
    // A retried task: its first run started at 2, this attempt at 5.
    const row = codingTask({ id: "t1", status: "in_progress", createdAt: 1, startedAt: 2, run: { sessionId: "r", requestId: "q", attempt: 2, startedAt: 5 } });
    expect(attemptStartedAt(row)).toBe(5);
    expect(viewOf(row).times.startedAt).toBe(2);
  });
});
