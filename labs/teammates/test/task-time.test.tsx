// @vitest-environment happy-dom
/**
 * A teammate's tasks carry their time in its panel: a running row times this
 * attempt's run in place of "running", a run that stopped answering (its
 * lease lapsed, the board's own rule) reads *quiet* in the warning colour, but
 * never while the panel's feed is stale, an ended row says how long ago it
 * ended, and the heading counts each state. The adapter keeps what the signal
 * reads from the board's row: its view, its run's start and its lease.
 *
 * Red states produced before this was trusted: the row's words drawn without
 * the signal (the panel case fails), `toBoardTask` dropping `leaseUntil` (the
 * adapter and quiet cases fail), the panel passing `stale` as false (the stale
 * case fails).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionConnectionState } from "@flow-state-dev/client";
import { toBoardTask, type LabAdapter, type WorkerRow } from "../src/adapter";
import { TeammatePanel } from "../src/components/TeammatePanel";

afterEach(cleanup);

const MIN = 60_000;
const worker = { id: "cos", name: "Chief of Staff", role: "Runs the team", own: false } as WorkerRow;

/** A board row as `listTasks` answers it. */
const listed = (id: string, status: string, times: { updatedAt: number; startedAt?: number; leaseUntil?: number }) => ({
  id,
  title: `Task ${id}`,
  goal: `Task ${id}`,
  assignee: "researcher",
  status,
  attempts: 1,
  updatedAt: times.updatedAt,
  ...(times.startedAt === undefined ? {} : { run: { sessionId: `run:${id}`, requestId: "q1", startedAt: times.startedAt } }),
  ...(times.leaseUntil === undefined ? {} : { leaseUntil: times.leaseUntil }),
});

function panel(rows: Record<string, any>[], connection: SessionConnectionState = "live", boardStale = false) {
  const adapter = {
    watchTasks: (_session: string, emit: (tasks: unknown[]) => void, onStale?: (stale: boolean) => void) => {
      emit(rows.map((row) => toBoardTask(row)));
      if (boardStale) onStale?.(true);
      return () => {};
    },
    watchConnection: (_session: string, emit: (state: SessionConnectionState) => void) => (emit(connection), () => {}),
  } as unknown as LabAdapter;
  render(
    <TeammatePanel adapter={adapter} worker={worker} sessionId="s1" openTask={undefined} nameOf={(id) => id} lookOf={() => ({}) as never} isCoding={() => false} onOpen={() => {}} />,
  );
  return screen.getByRole("complementary", { name: "Chief of Staff's panel" });
}

describe("a teammate's task rows and their time", () => {
  it("keeps the row's view, its run's start and its lease from the board's row", () => {
    const task = toBoardTask(listed("t1", "in_progress", { updatedAt: 5, startedAt: 3, leaseUntil: 120_005 }));
    expect(task.view?.state).toBe("running");
    expect(task.run).toEqual({ startedAt: 3, leaseUntil: 120_005 });
    expect(toBoardTask(listed("t2", "pending", { updatedAt: 5 })).run).toBeUndefined();
  });

  it("times a working run, marks one that stopped answering quiet, ages an ended one, and counts each state", () => {
    const now = Date.now();
    const shown = panel([
      listed("a", "in_progress", { updatedAt: now - 10_000, startedAt: now - (4 * MIN + 12_000), leaseUntil: now + 100_000 }),
      listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN }),
    ]);
    expect(within(shown).getByText(/^Tasks \(2\) · 2 running$/)).toBeTruthy();
    expect(within(shown).getByText(/^working · 4m 1[23]s$/)).toBeTruthy();
    const quiet = within(shown).getByText("quiet for 40m");
    expect(quiet.className).toContain("text-warning");
  });

  it("never says quiet while the panel's feed is stale", () => {
    const now = Date.now();
    const shown = panel([listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })], "stopped");
    expect(within(shown).queryByText(/quiet/)).toBeNull();
    expect(within(shown).getByText(/^working · 45m/)).toBeTruthy();
  });

  it("never says quiet while the board's read fails, though the conversation's feed is live", () => {
    const now = Date.now();
    const shown = panel([listed("b", "in_progress", { updatedAt: now - 40 * MIN, startedAt: now - 45 * MIN, leaseUntil: now - 38 * MIN })], "live", true);
    expect(within(shown).queryByText(/quiet/)).toBeNull();
    expect(within(shown).getByText(/^working · 45m/)).toBeTruthy();
  });

  it("says how long ago an ended task ended, after its status", () => {
    const now = Date.now();
    const shown = panel([listed("c", "completed", { updatedAt: now - 12 * MIN })]);
    expect(within(shown).getByText(/^Tasks \(1\) · 1 done$/)).toBeTruthy();
    fireEvent.click(within(shown).getByRole("button", { name: /Done \(1\)/ }));
    expect(within(shown).getByText("12m ago").closest("[data-status]")?.textContent).toBe("done · 12m ago");
  });
});
