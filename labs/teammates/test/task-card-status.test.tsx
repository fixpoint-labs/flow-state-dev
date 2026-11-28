// @vitest-environment happy-dom
/**
 * A running task's card in the panel says what its run is doing now, in one
 * muted line under its title, where a decorative bar used to sit: the board
 * row's `statusNote`, which harness-manager keeps from every harness's
 * activity (a command, an edit, a read, thinking) and from the run's own
 * phases (preparing its worktree, checking the work, the judge). Nothing
 * known yet reads *Starting…*; a task waiting on you or on its pull request
 * says what it waits on. The note comes from the model's commands, so it is
 * drawn as one line of plain text: never markup, never a second line.
 *
 * Red states produced before this was trusted: the panel with its old bar
 * (the no-bar case fails), the line drawn from nothing (every note case
 * fails), the note drawn unsanitised (the newline case fails).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { rosterEntry } from "./scripted-server";
import { TeammatePanel } from "../src/components/TeammatePanel";
import { nowLine, plainLine } from "../src/lib/task";
import { codingTask, hold, standInFollower, stubServer, TestProvider } from "./stub-server";

afterEach(cleanup);

const worker = rosterEntry({ id: "lead", name: "Lead", description: "Runs the team" });

/** A task its run holds now: in progress, its lease live, with the note the board row carries. */
const running = (id: string, statusNote: string | null, extra: Partial<CodingBoardTask> = {}): CodingBoardTask => {
  const now = Date.now();
  return codingTask({
    id,
    title: `Task ${id}`,
    assignee: "coder",
    status: "in_progress",
    attempts: 1,
    updatedAt: now - 5_000,
    run: { sessionId: `run:${id}`, requestId: "q1", attempt: 1, startedAt: now - 60_000 },
    leaseUntil: now + 100_000,
    ...(statusNote === null ? {} : { statusNote }),
    ...extra,
  });
};

async function panel(tasks: CodingBoardTask[]) {
  const { client } = stubServer({ board: { s1: tasks } });
  const { Follower } = standInFollower("s1", { lines: [], running: false, stopping: false, backgroundRunning: 0 });
  render(
    <TestProvider client={client}>
      <Follower />
      <TeammatePanel worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} isCoding={() => true} onOpen={() => {}} />
    </TestProvider>,
  );
  // Only the panel's own name: each test then waits on its card, by the card's accessible name, which every panel layout keeps.
  return screen.getByRole("complementary", { name: "Lead's panel" });
}

const card = async (shown: HTMLElement, id: string) => within(shown).findByRole("button", { name: new RegExp(`^Coding task: Task ${id}(,|$)`) });

describe("a running task's card", () => {
  it("draws no progress bar: it never said how far along a run was", async () => {
    const shown = await panel([running("a", "Running pnpm test")]);
    const a = await card(shown, "a");
    expect(a.querySelector("[data-progress]")).toBeNull();
  });

  it("says what the run is doing now, for each kind of activity and each phase the row's note carries", async () => {
    const notes = [
      "Running pnpm test",
      "Editing packages/x/y.ts",
      "Reading README.md",
      "Thinking…",
      "Preparing worktree…",
      "Checking the work…",
      "Judge reviewing…",
    ];
    const shown = await panel(notes.map((note, i) => running(`n${i}`, note)));
    for (const [i, note] of notes.entries()) {
      const line = (await card(shown, `n${i}`)).querySelector("[data-now]");
      expect(line?.textContent).toBe(note);
      // The full text on hover, since the line truncates.
      expect(line?.getAttribute("title")).toBe(note);
    }
  });

  it("falls back to Starting… while its run has said nothing yet", async () => {
    const shown = await panel([running("s", null)]);
    expect((await card(shown, "s")).querySelector("[data-now]")?.textContent).toBe("Starting…");
  });

  it("shows a command as plain single-line text: a newline, a control character or markup in it is drawn, never obeyed", async () => {
    const shown = await panel([running("x", "Running echo <b>hi</b>\nrm -rf /\u0007 && \u202edone")]);
    const line = (await card(shown, "x")).querySelector("[data-now]")!;
    expect(line.textContent).toBe("Running echo <b>hi</b> rm -rf / && done");
    expect(line.querySelector("b")).toBeNull();
    expect(line.className).toContain("truncate");
  });

  it("keeps its pill for a task waiting on you, and says what it waits on", async () => {
    const shown = await panel([running("h", "Running pnpm test", { asks: [hold("question", "Which branch?\nmain or next", { taskId: "h" })] })]);
    const h = await card(shown, "h");
    expect(h.querySelector("[data-status]")?.textContent).toBe("waiting on you");
    expect(h.querySelector("[data-now]")?.textContent).toBe("Waiting on your answer: Which branch?");
  });
});

describe("the line a card reads", () => {
  it("names what a task waits on before what its run last did", () => {
    expect(nowLine(running("r", "Running pnpm test", { asks: [hold("review", "Look it over")] }))).toBe("Waiting on your review");
    expect(nowLine(running("p", "Running gh pr create", { pullRequests: [5661] }))).toBe("Waiting on PR #5661");
    expect(nowLine(running("p2", null, { pullRequests: [5661, 5662] }))).toBe("Waiting on PR #5661, #5662");
  });

  it("says a task no run has claimed yet is queued", () => {
    expect(nowLine(codingTask({ id: "q", status: "pending" }))).toBe("Queued");
  });

  it("strips what would break one line of text", () => {
    expect(plainLine(" a\tb\r\nc\u0000d\u2066e ")).toBe("a b c d e");
    expect(plainLine(" \n ")).toBe("");
  });
});
