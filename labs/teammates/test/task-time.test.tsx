// @vitest-environment happy-dom
/**
 * A teammate's tasks carry their time in its panel: a running card times this
 * attempt's run, a run that stopped answering (its lease lapsed, the board's
 * own rule) reads *quiet* in the warning colour, but never while the panel's
 * feed is stale, an ended card says how long ago it ended, and a task open
 * more than a day says *Long-running*. Durations past a day read in days, so
 * a stalled task never reads as a plausible "71h 24m". The screen reads what the signal
 * needs from the coding board view's row: its `state`, its run's start and
 * its lease.
 *
 * Red states produced before this was trusted: the row's words drawn without
 * the signal (the panel case fails), `timeSignalOf` dropping `leaseUntil` (the
 * row and quiet cases fail), the panel passing `stale` as false (the stale
 * case fails).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionConnectionStatus } from "@flow-state-dev/client";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { rosterEntry } from "./scripted-server";
import { TeammatePanel } from "../src/components/TeammatePanel";
import { elapsedText, isLongRunning, LONG_RUNNING_MS, timeSignalOf } from "../src/lib/task";
import { codingTask, hold, standInFollower, stubServer, TestProvider, type StubData } from "./stub-server";

afterEach(cleanup);

const MIN = 60_000;
const worker = rosterEntry({ id: "lead", name: "Lead", description: "Runs the team" });

/** A board row as the coding board view answers it. */
const listed = (id: string, status: string, times: { updatedAt: number; startedAt?: number; leaseUntil?: number }): CodingBoardTask =>
  codingTask({
    id,
    title: `Task ${id}`,
    assignee: "researcher",
    status,
    attempts: 1,
    updatedAt: times.updatedAt,
    ...(times.startedAt === undefined ? {} : { run: { sessionId: `run:${id}`, requestId: "q1", attempt: 1, startedAt: times.startedAt } }),
    ...(times.leaseUntil === undefined ? {} : { leaseUntil: times.leaseUntil }),
  });

async function panel(rows: CodingBoardTask[], connection: SessionConnectionStatus = "live", data: StubData = {}) {
  const { client } = stubServer(Object.assign(data, { board: { s1: rows } }));
  // Only the conversation's connection, which a stale feed greys the panel by.
  const { Follower } = standInFollower("s1", { lines: [], running: false, stopping: false, backgroundRunning: 0 }, connection);
  render(
    <TestProvider client={client}>
      <Follower />
      <TeammatePanel worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} isCoding={() => false} onOpen={() => {}} />
    </TestProvider>,
  );
  const shown = screen.getByRole("complementary", { name: "Lead's panel" });
  await within(shown).findByRole("heading", { name: /^Tasks/ });
  return shown;
}

describe("a teammate's tasks and their time", () => {
  it("reads the row's view, its run's start and its lease from the board's row", () => {
    const task = listed("t1", "in_progress", { updatedAt: 5, startedAt: 3, leaseUntil: 120_005 });
    expect(timeSignalOf(task)).toEqual({ view: { state: "running", times: { updatedAt: 5, completedAt: null } }, run: { startedAt: 3, leaseUntil: 120_005 } });
    expect(timeSignalOf(listed("t2", "pending", { updatedAt: 5 })).run).toEqual({ startedAt: null, leaseUntil: null });
  });

  it("times a working run, marks one that stopped answering quiet, and counts the running ones on their tile", async () => {
    const now = Date.now();
    const shown = await panel([
      listed("a", "in_progress", { updatedAt: now - 10_000, startedAt: now - (4 * MIN + 12_000), leaseUntil: now + 100_000 }),
      listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN }),
    ]);
    await waitFor(() => expect(within(shown).getByRole("tab", { name: /Running/ }).textContent).toBe("Running2"));
    const card = (id: string) => within(shown).getByRole("button", { name: `Asked researcher to task ${id}` });
    expect(card("a").querySelector("[data-elapsed]")?.textContent).toMatch(/^4m 1[23]s$/);
    // Only a run that answers draws the thin bar; a quiet one says how long it has been quiet instead.
    expect(card("a").querySelector("[data-progress]")).not.toBeNull();
    expect(card("b").querySelector("[data-progress]")).toBeNull();
    const quiet = within(shown).getByText("quiet for 40m");
    // A run gone quiet is a problem short of failing: red, with its words, never the highlighter.
    expect(quiet.className).toContain("text-danger");
  });

  it("never says quiet while the panel's feed is stale", async () => {
    const now = Date.now();
    const shown = await panel([listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })], "stopped");
    expect(within(shown).queryByText(/quiet/)).toBeNull();
    expect(shown.querySelector("[data-elapsed]")?.textContent).toMatch(/^45m/);
  });

  it("never says quiet while the board's read fails, though the conversation's feed is live", async () => {
    const now = Date.now();
    const data: StubData = {};
    const shown = await panel([listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })], "live", data);
    expect(within(shown).getByText("quiet for 40m")).toBeTruthy();
    // The board's read fails from now: its last rows stay, stale, and say nothing of the run.
    data.boardFails = true;
    await waitFor(() => expect(within(shown).queryByText(/quiet/)).toBeNull(), { timeout: 3000 });
    expect(shown.querySelector("[data-elapsed]")?.textContent).toMatch(/^45m/);
  });

  it("never says working for a running task no lease holds (parked, or waiting on its pull request): no clock counts up", async () => {
    const now = Date.now();
    const shown = await panel([listed("p", "in_progress", { updatedAt: now - 3 * 24 * 60 * MIN, startedAt: now - 72 * 60 * MIN })]);
    expect(within(shown).queryByText(/working/)).toBeNull();
    expect(within(shown).queryByText(/idle ·/)).toBeNull();
    expect(within(shown).getByRole("button", { name: "Asked researcher to task p" }).querySelector("[data-elapsed]")).toBeNull();
  });

  it("says how long ago an ended task ended", async () => {
    const now = Date.now();
    const shown = await panel([listed("c", "cancelled", { updatedAt: now - 12 * MIN })]);
    fireEvent.click(within(shown).getByRole("tab", { name: /Done/ }));
    expect(within(shown).getByRole("button", { name: "Asked researcher to task c" }).querySelector("[data-elapsed]")?.textContent).toBe("12m ago");
  });

  it("tags a task still open after a day Long-running, in grey, and drops its bar: someone should look at it", async () => {
    const now = Date.now();
    const DAY = 24 * 60 * MIN;
    const shown = await panel([
      listed("stuck", "in_progress", { updatedAt: now - 10_000, startedAt: now - (2 * DAY + 23 * 60 * MIN), leaseUntil: now + 100_000 }),
      listed("fresh", "in_progress", { updatedAt: now - 10_000, startedAt: now - 23 * 60 * MIN, leaseUntil: now + 100_000 }),
    ]);
    const stuck = within(shown).getByRole("button", { name: "Asked researcher to task stuck" });
    expect(stuck.querySelector("[data-long-running]")?.textContent).toBe("Long-running");
    expect(stuck.querySelector("[data-elapsed]")?.textContent).toBe("2d 23h");
    // The tag says it; the clock stays running blue, since yellow is only for what waits on a person.
    expect(stuck.querySelector("[data-long-running]")?.className).toContain("text-text-2");
    expect(stuck.querySelector("[data-elapsed]")?.className).toContain("text-brand");
    expect(stuck.querySelector("[data-progress]")).toBeNull();
    // Under a day is ordinary work, however long it feels.
    expect(within(shown).getByRole("button", { name: "Asked researcher to task fresh" }).querySelector("[data-long-running]")).toBeNull();
  });
});

describe("the Long-running rule", () => {
  const at = (status: string, startedAt: number) => codingTask({ id: "t", status, run: { sessionId: "r", requestId: "q", attempt: 1, startedAt } });

  it("is a day of this attempt, and only for a task still active", () => {
    const now = Date.now();
    expect(LONG_RUNNING_MS).toBe(24 * 60 * MIN);
    expect(isLongRunning(at("in_progress", now - LONG_RUNNING_MS - 1), now)).toBe(true);
    expect(isLongRunning(at("in_progress", now - LONG_RUNNING_MS + 1), now)).toBe(false);
    // A task that ended is over, not long-running, however long it took.
    expect(isLongRunning(at("completed", now - 3 * LONG_RUNNING_MS), now)).toBe(false);
    // A retry times itself: its earlier attempts don't make it long-running.
    const retried = codingTask({ id: "t", status: "in_progress", startedAt: now - 3 * LONG_RUNNING_MS, run: { sessionId: "r", requestId: "q", attempt: 2, startedAt: now - MIN } });
    expect(isLongRunning(retried, now)).toBe(false);
  });

  it("tags a task waiting on you or still queued past a day: the stall it exists to surface", () => {
    // A review that has waited 72h on you is the case that asked for the tag; "active" has to include it.
    const now = Date.now();
    const started = { sessionId: "r", requestId: "q", attempt: 1, startedAt: now - 3 * LONG_RUNNING_MS };
    const waiting = codingTask({ id: "t", status: "in_progress", run: started, asks: [hold("review", "Review the change", { taskId: "t" })] });
    expect(isLongRunning(waiting, now)).toBe(true);
    expect(isLongRunning(codingTask({ id: "t", status: "pending", run: started }), now)).toBe(true);
  });
});

describe("a task card's elapsed time", () => {
  it("keeps two units at most and reads days past a day, never hours in the dozens", () => {
    expect(elapsedText(42_000)).toBe("42s");
    expect(elapsedText(2 * MIN + 23_000)).toBe("2m 23s");
    expect(elapsedText(63 * MIN)).toBe("1h 3m");
    expect(elapsedText(71 * 60 * MIN + 24 * MIN)).toBe("2d 23h");
  });
});
