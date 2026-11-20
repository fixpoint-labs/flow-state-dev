// @vitest-environment happy-dom
/**
 * A teammate's tasks carry their time in its panel: a running row times this
 * attempt's run in place of "running", a run that stopped answering (its
 * lease lapsed, the board's own rule) reads *quiet* in the warning colour, but
 * never while the panel's feed is stale, an ended row says how long ago it
 * ended, and the heading counts each state. The screen reads what the signal
 * needs from the coding board view's row: its `taskView`, its run's start and
 * its lease.
 *
 * Red states produced before this was trusted: the row's words drawn without
 * the signal (the panel case fails), `runTimesOf` dropping `leaseUntil` (the
 * row and quiet cases fail), the panel passing `stale` as false (the stale
 * case fails).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionConnectionStatus } from "@flow-state-dev/client";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { rosterEntry } from "./scripted-server";
import { TeammatePanel } from "../src/components/TeammatePanel";
import { runTimesOf, viewOf } from "../src/lib/task";
import { codingTask, standInFollower, stubServer, TestProvider, type StubData } from "./stub-server";

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
      <TeammatePanel worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} lookOf={() => ({}) as never} isCoding={() => false} onOpen={() => {}} />
    </TestProvider>,
  );
  const shown = screen.getByRole("complementary", { name: "Lead's panel" });
  await within(shown).findByText(/^Tasks \(/);
  return shown;
}

describe("a teammate's tasks and their time", () => {
  it("reads the row's view, its run's start and its lease from the board's row", () => {
    const task = listed("t1", "in_progress", { updatedAt: 5, startedAt: 3, leaseUntil: 120_005 });
    expect(viewOf(task).state).toBe("running");
    expect(runTimesOf(task)).toEqual({ startedAt: 3, leaseUntil: 120_005 });
    expect(runTimesOf(listed("t2", "pending", { updatedAt: 5 }))).toEqual({});
  });

  it("times a working run, marks one that stopped answering quiet, ages an ended one, and counts each state", async () => {
    const now = Date.now();
    const shown = await panel([
      listed("a", "in_progress", { updatedAt: now - 10_000, startedAt: now - (4 * MIN + 12_000), leaseUntil: now + 100_000 }),
      listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN }),
    ]);
    expect(within(shown).getByText(/^Tasks \(2\) · 2 running$/)).toBeTruthy();
    expect(within(shown).getByText(/^working · 4m 1[23]s$/)).toBeTruthy();
    const quiet = within(shown).getByText("quiet for 40m");
    expect(quiet.className).toContain("text-warning");
  });

  it("never says quiet while the panel's feed is stale", async () => {
    const now = Date.now();
    const shown = await panel([listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })], "stopped");
    expect(within(shown).queryByText(/quiet/)).toBeNull();
    expect(within(shown).getByText(/^working · 45m/)).toBeTruthy();
  });

  it("never says quiet while the board's read fails, though the conversation's feed is live", async () => {
    const now = Date.now();
    const data: StubData = {};
    const shown = await panel([listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })], "live", data);
    expect(within(shown).getByText("quiet for 40m")).toBeTruthy();
    // The board's read fails from now: its last rows stay, stale, and say nothing of the run.
    data.boardFails = true;
    await waitFor(() => expect(within(shown).queryByText(/quiet/)).toBeNull(), { timeout: 3000 });
    expect(within(shown).getByText(/^working · 45m/)).toBeTruthy();
  });

  it("never says working for a running task no lease holds (parked, or waiting on its pull request): it says how long it has waited", async () => {
    const now = Date.now();
    const shown = await panel([listed("p", "in_progress", { updatedAt: now - 3 * 24 * 60 * MIN, startedAt: now - 72 * 60 * MIN })]);
    expect(within(shown).queryByText(/working/)).toBeNull();
    expect(within(shown).getByText("waiting · 3d")).toBeTruthy();
  });

  it("says how long ago an ended task ended, after its status", async () => {
    const now = Date.now();
    const shown = await panel([listed("c", "completed", { updatedAt: now - 12 * MIN })]);
    expect(within(shown).getByText(/^Tasks \(1\) · 1 done$/)).toBeTruthy();
    fireEvent.click(within(shown).getByRole("button", { name: /Done \(1\)/ }));
    expect(within(shown).getByText("12m ago").closest("[data-status]")?.textContent).toBe("done · 12m ago");
  });
});
