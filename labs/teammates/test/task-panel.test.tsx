// @vitest-environment happy-dom
/**
 * A teammate's panel says at a glance what is running, what
 * failed and why, and what finished (FIX-2395); a task's line
 * in the conversation uses the same word and colour as its panel row, so the
 * two never disagree on how a task stands. Every ended task stays findable
 * under *Done*: completed, cancelled (marked so), and failed ones you cleared.
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
import { attemptStartedAt, timeSignalOf } from "../src/lib/task";
import { codingTask, hold, POPUP_READ, standInFollower, stubServer, TestProvider } from "./stub-server";
import { TaskCard } from "../src/components/TaskCard";
import { taskPresentation } from "../src/lib/task-presentation";
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
  // Its run opened a pull request and waits on it to merge or close: open, but nothing runs.
  task("i-pr", { pullRequests: [5512], updatedAt: NOW - 2 * 24 * 60 * MIN }, { startedAt: NOW - 3 * 24 * 60 * MIN }),
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
      <TeammatePanel worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} isCoding={() => false} onOpen={() => {}} />
    </TestProvider>,
  );
  const panel = screen.getByRole("complementary", { name: "Lead's panel" });
  await within(panel).findByRole("list", { name: "Running" });
  return panel;
}

const rows = (list: HTMLElement) => within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
const statusOf = (list: HTMLElement, i: number) => within(list).getAllByRole("button")[i]!.querySelector("[data-status]")?.textContent ?? null;
const tab = (panel: HTMLElement, name: string) => within(panel).getByRole("tab", { name: new RegExp(name) });
const tiles = (panel: HTMLElement) => within(panel).getAllByRole("tab").map((t) => [t.textContent, t.getAttribute("aria-selected")]);

describe("a teammate's tasks in its panel", () => {
  it("totals them in the heading and counts each filter on its tile, Running first and selected", async () => {
    const panel = await renderPanel();
    expect(within(panel).getByRole("heading", { name: "Tasks 13" })).toBeTruthy();
    // The tiles are the tabs: the only way to choose which tasks show. Done counts completed and cancelled alike.
    expect(within(panel).getByRole("tablist", { name: "Task status" })).toBeTruthy();
    expect(tiles(panel)).toEqual([["Running2", "true"], ["Idle1", "false"], ["Failed2", "false"], ["Done8", "false"]]);
  });

  it("puts a task waiting on you first among the running ones", async () => {
    const panel = await renderPanel();
    const running = within(panel).getByRole("list", { name: "Running" });
    expect(rows(running)).toEqual(["Asked researcher to task r-asks", "Asked researcher to task r-old"]);
    expect(statusOf(running, 0)).toBe("waiting on you");
    // A running task with nothing for you says nothing more than its clock.
    expect(statusOf(running, 1)).toBeNull();
  });

  it("keeps a task waiting on its pull request out of Running: Idle lists it, says PR open, with no clock counting up or Long-running", async () => {
    const panel = await renderPanel();
    expect(rows(within(panel).getByRole("list", { name: "Running" }))).not.toContain("Asked researcher to task i-pr");
    fireEvent.click(tab(panel, "Idle"));
    const idle = within(panel).getByRole("list", { name: "Idle" });
    expect(rows(idle)).toEqual(["Asked researcher to task i-pr"]);
    expect(statusOf(idle, 0)).toBe("PR open");
    const card = within(idle).getAllByRole("button")[0]!;
    // Its age is since it last moved, not its three days open, and in the quiet colour: it is not working.
    expect(card.querySelector("[data-elapsed]")?.textContent).toBe("2d 0h");
    expect(card.querySelector("[data-elapsed]")?.className).toContain("text-text-3");
    expect(card.querySelector("[data-progress]")).toBeNull();
    expect(card.querySelector("[data-long-running]")).toBeNull();
  });

  it("keeps a task waiting on you in Running even while its pull request is open: the next move is yours", async () => {
    const panel = await renderPanel([task("both", { pullRequests: [7], asks: [hold("review", "Review the work")] }, { startedAt: NOW - MIN })]);
    expect(rows(within(panel).getByRole("list", { name: "Running" }))).toEqual(["Asked researcher to task both"]);
    expect(tiles(panel).map(([t]) => t)).toEqual(["Running1", "Idle0", "Failed0", "Done0"]);
  });

  it("lists the failed ones newest first under their tile, each with its reason's first line", async () => {
    const panel = await renderPanel();
    fireEvent.click(tab(panel, "Failed"));
    expect(tab(panel, "Failed").getAttribute("aria-selected")).toBe("true");
    const failed = within(panel).getByRole("list", { name: "Failed" });
    expect(rows(failed)).toEqual(["Asked researcher to task f-new", "Asked researcher to task f-old"]);
    expect(statusOf(failed, 0)).toBe("failed · No sign-in found");
    expect(statusOf(failed, 1)).toBe("failed · Tests did not pass");
    expect(within(panel).queryByRole("list", { name: "Running" })).toBeNull();
  });

  it("moves between the tiles with the arrow keys, as a tab list does", async () => {
    const panel = await renderPanel();
    fireEvent.keyDown(tab(panel, "Running"), { key: "ArrowRight" });
    expect(tab(panel, "Idle").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(panel, "Idle"));
    fireEvent.keyDown(tab(panel, "Idle"), { key: "ArrowLeft" });
    fireEvent.keyDown(tab(panel, "Running"), { key: "ArrowLeft" });
    expect(tab(panel, "Done").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps finished work findable under Done: newest first, a cancelled task marked as cancelled", async () => {
    // Without a Done tile a completed task left the panel entirely, and a cancelled one sat apart from it.
    const panel = await renderPanel();
    fireEvent.click(tab(panel, "Done"));
    const done = within(panel).getByRole("list", { name: "Done" });
    expect(rows(done)).toEqual(["c1", "d0", "d1", "d2", "d3"].map((id) => `Asked researcher to task ${id}`));
    expect(statusOf(done, 0)).toBe("cancelled");
    // A completed one needs no word: being under Done says it.
    expect(statusOf(done, 1)).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Show all 8" }));
    expect(rows(within(panel).getByRole("list", { name: "Done" }))).toHaveLength(8);
  });

  it("has no other filter: no Show cleared, no All, no New task", async () => {
    const panel = await renderPanel();
    expect(panel.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    expect(within(panel).queryByRole("button", { name: /cleared|^All/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /New task/ })).toBeNull();
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
  it("never caps the running tasks: active work is always in sight", async () => {
    const panel = await renderPanel(BUSY);
    expect(rows(within(panel).getByRole("list", { name: "Running" }))).toHaveLength(6);
  });

  it("shows the newest five failed, and Show all / Show fewer to reach the older ones", async () => {
    const panel = await renderPanel(BUSY);
    fireEvent.click(tab(panel, "Failed"));
    const failedIds = () => rows(within(panel).getByRole("list", { name: "Failed" }));
    expect(failedIds()).toEqual(["f0", "f1", "f2", "f3", "f4"].map((id) => `Asked researcher to task ${id}`));
    fireEvent.click(within(panel).getByRole("button", { name: "Show all 7" }));
    expect(failedIds()).toHaveLength(7);
    fireEvent.click(within(panel).getByRole("button", { name: "Show fewer" }));
    expect(failedIds()).toHaveLength(5);
  });

  it("Clear moves failed rows to Done, not out of reach: the heading still counts them, Failed drops to zero", async () => {
    const panel = await renderPanel(BUSY);
    fireEvent.click(tab(panel, "Failed"));
    fireEvent.click(within(panel).getByRole("button", { name: "Clear failed (7)" }));
    expect(within(panel).queryByRole("list", { name: "Failed" })).toBeNull();
    expect(within(panel).getByText("No failed tasks.")).toBeTruthy();
    expect(tab(panel, "Failed").textContent).toBe("Failed0");
    // Not deleted: the task is still the board's, so the heading's total keeps it.
    expect(within(panel).getByRole("heading", { name: "Tasks 13" })).toBeTruthy();
    // Clear was a dead end; now a cleared failure is under Done, still saying it failed and why.
    expect(tab(panel, "Done").textContent).toBe("Done7");
    fireEvent.click(tab(panel, "Done"));
    const done = within(panel).getByRole("list", { name: "Done" });
    expect(rows(done)[0]).toBe("Asked researcher to task f0");
    expect(statusOf(done, 0)).toBe("failed · boom");
  });

  it("remembers a clear across a reload, but shows a task again when it fails anew", async () => {
    let panel = await renderPanel(BUSY);
    fireEvent.click(tab(panel, "Failed"));
    fireEvent.click(within(panel).getByRole("button", { name: "Clear failed (7)" }));
    cleanup();
    panel = await renderPanel(BUSY);
    expect(tab(panel, "Failed").textContent).toBe("Failed0");
    cleanup();
    // f0 was retried and failed again: it ended at a new time, so it shows.
    const refailed = BUSY.map((t) => (t.id === "f0" ? task("f0", { status: "errored" }, { completedAt: NOW }) : t));
    panel = await renderPanel(refailed);
    fireEvent.click(tab(panel, "Failed"));
    expect(rows(within(panel).getByRole("list", { name: "Failed" }))).toEqual(["Asked researcher to task f0"]);
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
        <Conversation worker={worker} sessionId="s1" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => true} onFire={async () => {}} onOpen={() => {}} />
      </TestProvider>,
    );
    // Which worker codes, and on what, is the roster's: the app's own roster watch shares that read, so the card has it on the page as it is filed.
    const card = (await screen.findByRole("button", { name: "Coding task: Fix the typo, on Cursor" }, POPUP_READ)).closest("[data-entry=task]")!;
    expect(card.querySelector("[data-task-status]")?.textContent).toBe("running");
    // The row arrives, then ends: the same card reads it.
    server.board.s1!.push(codingTask({ id: "t1", assignee: "teammates.cursor", harness: "cursor", title: "Fix the typo", status: "completed" }));
    await waitFor(() => expect(card.querySelector("[data-task-status]")?.textContent).toBe("done"), POPUP_READ);
    expect(screen.getByRole("button", { name: "Coding task: Fix the typo, on Cursor" }).closest("[data-entry=task]")).toBe(card);
  });

  it("uses its panel row's word and colour", () => {
    const byId = (id: string) => TASKS.find((t) => t.id === id)!;
    // The highlighter only for the task that waits on you; blue running, red failed, a dashed ring for an open PR.
    const cases: [CodingBoardTask, string, string][] = [
      [byId("r-asks"), "waiting on you", "bg-attention"],
      [byId("f-new"), "failed", "text-destructive"],
      [byId("r-old"), "running", "text-brand"],
      [byId("i-pr"), "PR open", "border-dashed"],
    ];
    for (const [t, text, pill] of cases) {
      const { unmount } = render(<TaskCard task={t} nameOf={(id) => id} onOpen={() => {}} />);
      const word = document.querySelector("[data-task-status]")!;
      expect(word.textContent).toBe(text);
      expect(document.querySelector("[data-task-pill]")!.className).toContain(pill);
      // The same pill as the task's own reader, which the panel's card draws too.
      expect(document.querySelector("[data-task-pill]")!.className).toContain(taskPresentation(t).pill);
      // An idle task doesn't count up as if it were working.
      if (t.id === "i-pr") expect(document.querySelector("[data-task-since]")).toBeNull();
      unmount();
    }
  });

  it("is one control: a keyboard reaches the card once, and one press opens it once", () => {
    // A clickable card wrapping its own Open button gave two targets for one action, the card itself mouse-only.
    const opened: string[] = [];
    const { container } = render(<TaskCard task={TASKS[0]!} nameOf={(id) => id} onOpen={(id) => opened.push(id)} />);
    const buttons = within(container).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(opened).toEqual([TASKS[0]!.id]);
    // The card's own box has no handler: in a browser the button's ::after covers it, so a click there is the button's.
    fireEvent.click(container.querySelector("[data-entry=task]")!);
    expect(opened).toHaveLength(1);
  });
});

describe("a board row's times, as the screen reads them", () => {
  it("passes when it ended through to its time signal", () => {
    const row = codingTask({ id: "t1", status: "completed", createdAt: 1, startedAt: 2, completedAt: 3, updatedAt: 4 });
    expect(timeSignalOf(row).view).toEqual({ state: "done", times: { updatedAt: 4, completedAt: 3 } });
  });

  it("keeps the feed's start on this attempt, not the task's first start", () => {
    // A retried task: its first run started at 2, this attempt at 5.
    const row = codingTask({ id: "t1", status: "in_progress", createdAt: 1, startedAt: 2, run: { sessionId: "r", requestId: "q", attempt: 2, startedAt: 5 } });
    expect(attemptStartedAt(row)).toBe(5);
    expect(timeSignalOf(row).run.startedAt).toBe(5);
    expect(row.startedAt).toBe(2);
  });
});
