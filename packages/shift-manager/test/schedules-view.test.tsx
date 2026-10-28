// @vitest-environment happy-dom
/** Scheduled work: each schedule with the task it files and its next run, soonest first, read through the roster session. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSnapshot } from "../src/lib/derive";
import { parseRoute, pathFor } from "../src/lib/routes";
import { toScheduledWork } from "../src/lib/schedules";

const runAction = vi.fn();
vi.mock("../src/lib/action", async (original) => ({
  ...(await original<typeof import("../src/lib/action")>()),
  runAction: (...a: unknown[]) => runAction(...a),
}));
const lab = { client: { userId: "u_1" }, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

import { Schedules, nextRunLabel } from "../src/surfaces/Schedules";

const weekly = {
  key: "adoption",
  cron: "0 9 * * 1",
  timezone: "Europe/London",
  kind: "task",
  enabled: true,
  input: { filer: "launch", goal: "Refresh the adoption numbers", assignee: "researcher" },
  nextRunAt: "2026-10-26T09:00:00.000Z",
};
const daily = { ...weekly, key: "standup", cron: "30 7 * * 1-5", timezone: "America/New_York", input: { ...weekly.input, goal: "Collect the standup notes" }, nextRunAt: "2026-10-22T11:30:00.000Z" };
const off = { ...weekly, key: "paused", enabled: false, nextRunAt: null };

const snapshot = { sessions: [{ id: "workforce-roster-own-u_1", flowKind: "workforce-roster", parentSessionId: null }], readAt: 1 } as unknown as LoadedSnapshot;

beforeEach(() => {
  runAction.mockReset();
  window.history.replaceState(null, "", "/schedules");
});
afterEach(() => cleanup());

describe("the scheduled-work list", () => {
  it("keeps the order the list answered, which is the server's soonest-first", () => {
    expect(toScheduledWork({ schedules: [off, weekly, daily] }).map((s) => s.key)).toEqual(["paused", "adoption", "standup"]);
  });

  it("leaves out a row that isn't a schedule", () => {
    expect(toScheduledWork({ schedules: [weekly, { key: 1 }, null] }).map((s) => s.key)).toEqual(["adoption"]);
    expect(toScheduledWork(undefined)).toEqual([]);
  });

  it("says a schedule that is off is off, whatever its cron", () => {
    expect(nextRunLabel("2026-10-26T09:00:00.000Z", false)).toBe("off");
    expect(nextRunLabel(null, true)).toBe("no next run");
  });
});

describe("the Scheduled work view", () => {
  it("lists each schedule with its next run and the task it files, read through the user's roster session", async () => {
    runAction.mockResolvedValue({ output: { schedules: [daily, weekly, off] }, sessionId: "workforce-roster-own-u_1" });
    render(<Schedules snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("schedule");
    expect(runAction.mock.calls[0]!.slice(1, 4)).toEqual(["workforce-roster", "workforce-roster-own-u_1", "listSchedules"]);
    expect(lines.map((l) => [l.getAttribute("data-key"), l.getAttribute("data-next-run")])).toEqual([
      ["standup", "2026-10-22T11:30:00.000Z"],
      ["adoption", "2026-10-26T09:00:00.000Z"],
      ["paused", ""],
    ]);
    expect(within(lines[1]!).getByTestId("schedule-goal").textContent).toBe("Refresh the adoption numbers");
    expect(within(lines[1]!).getByTestId("schedule-detail").textContent).toContain("0 9 * * 1 · Europe/London");
    expect(within(lines[2]!).getByTestId("schedule-next-run").textContent).toBe("off");
  });

  it("says so when there are none", async () => {
    runAction.mockResolvedValue({ output: { schedules: [] }, sessionId: "workforce-roster-own-u_1" });
    render(<Schedules snapshot={snapshot} />);
    expect((await screen.findByTestId("schedules-empty")).textContent).toContain("No scheduled work yet");
  });

  it("says what the Lab answered when the list didn't load", async () => {
    runAction.mockRejectedValue(new Error("store offline"));
    render(<Schedules snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByTestId("schedules-failure").textContent).toContain("store offline"));
  });

  it("is at /schedules", () => {
    expect(parseRoute("/schedules")).toEqual({ level: "schedules" });
    expect(pathFor({ level: "schedules" })).toBe("/schedules");
  });
});
