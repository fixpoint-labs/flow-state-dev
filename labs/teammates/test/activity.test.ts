/**
 * A teammate's busy dot and its "Idle · …" age, from workforce's views: the
 * worker sessions view names the default conversation and whether a turn runs
 * in it, and the session turns view gives the age, from the last turn's end,
 * else its start. Never the session's `updatedAt`: a board dispatch moves it
 * and adds no turn (workforce's `dispatch-not-a-turn`), so the age would reset
 * on every pass while the teammate did nothing.
 */
import { describe, expect, it } from "vitest";
import type { ListedTurn, ListedWorkerSession } from "@flow-state-dev/workforce/browser";
import { activityOf, statusOf } from "../src/lib/status";

const session = (fields: Partial<ListedWorkerSession>): ListedWorkerSession => ({
  id: "wks_lead", title: "Untitled", worker: "lead", updatedAt: 0, running: false, state: {}, isDefault: true, waiting: [], ...fields,
});
const turn = (startedAt: number, completedAt: number | null): ListedTurn => ({
  id: `t${startedAt}`, action: "respond", status: completedAt === null ? "in_progress" : "completed", source: "http", startedAt, completedAt, endedAt: completedAt, error: null, historyStart: null, retryable: true,
});
const line = (activity: ReturnType<typeof activityOf>, now: number) =>
  statusOf("lead", { activity, entries: [], talk: [], tasks: [], now }, (id) => id, () => false).text;

describe("whether a teammate is busy, and since when", () => {
  it("ages from the last turn's end, not from a later dispatch that moved the session", () => {
    const MIN = 60_000;
    // The last turn ended at 10 min; a board dispatch moved the session at 50 min.
    const activity = activityOf([session({ updatedAt: 50 * MIN })], [turn(5 * MIN, 8 * MIN), turn(9 * MIN, 10 * MIN)]);
    expect(activity).toEqual({ running: false, lastActiveAt: 10 * MIN });
    expect(line(activity, 60 * MIN)).toBe("Idle · 50m");
  });

  it("ages a turn still running from its start, and is busy while the default conversation runs one", () => {
    expect(activityOf([session({ running: true, updatedAt: 9_000 })], [turn(1_000, 2_000), turn(3_000, null)])).toEqual({ running: true, lastActiveAt: 3_000 });
  });

  it("is idle with no age before a first turn, or with no default conversation yet", () => {
    expect(activityOf([session({ updatedAt: 9_000 })], [])).toEqual({ running: false, lastActiveAt: 0 });
    expect(activityOf([session({ isDefault: false, running: true })], undefined)).toEqual({ running: false, lastActiveAt: 0 });
    expect(activityOf([], undefined)).toEqual({ running: false, lastActiveAt: 0 });
  });

  it("ages a failed turn from when it failed, not from when it started", () => {
    // A failed turn has no completedAt: it ended at 7 min, after starting at 2.
    const failed: ListedTurn = { ...turn(2 * 60_000, null), status: "failed", endedAt: 7 * 60_000, error: { code: "model", message: "down" } };
    expect(activityOf([session({})], [failed])).toEqual({ running: false, lastActiveAt: 7 * 60_000 });
  });

  it("says nothing until its reads land", () => {
    expect(activityOf(undefined, undefined)).toBeUndefined();
    expect(activityOf([session({})], undefined)).toBeUndefined();
    expect(line(undefined, 0)).toBe("");
  });
});
