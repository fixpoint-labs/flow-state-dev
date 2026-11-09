// @vitest-environment happy-dom
/**
 * Routines: everything that runs as the user on its own, clock and event, in
 * one list read through the roster session, each with its maker, and paused,
 * resumed or deleted from its line.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSnapshot } from "../src/lib/derive";
import { parseRoute, pathFor } from "../src/lib/routes";
import { toRoutines } from "../src/lib/routines";

const runAction = vi.fn();
vi.mock("../src/lib/action", async (original) => ({
  ...(await original<typeof import("../src/lib/action")>()),
  runAction: (...a: unknown[]) => runAction(...a),
}));
const lab = { client: { userId: "u_1" }, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

import { Routines, madeByLabel, nextRunLabel } from "../src/surfaces/Routines";

const weekly = {
  id: "clock:adoption",
  name: "adoption",
  worker: "launch",
  paused: false,
  madeBy: { by: "user" },
  trigger: { clock: { cron: "0 9 * * 1", timezone: "Europe/London", nextRunAt: "2026-10-26T09:00:00.000Z" } },
  task: { filer: "launch", goal: "Refresh the adoption numbers", assignee: "researcher" },
};
const off = { ...weekly, id: "clock:paused", name: "paused", paused: true, trigger: { clock: { ...weekly.trigger.clock, nextRunAt: null } } };
const review = {
  id: "event:sub_1",
  name: "github:acme/api#412",
  worker: "eng.coder",
  paused: false,
  madeBy: { by: "worker", worker: "eng.coder" },
  trigger: { event: { provider: "github", thread: "github:acme/api#412", kinds: ["review"], screens: [], interest: "Reviews on my PR" } },
};
const declared = { ...weekly, id: "clock:cfg_abc", name: "cfg_abc", madeBy: { by: "app", entry: "weekly-digest" } };

const ROSTER = "workforce-roster-own-u_1";
const snapshot = { sessions: [{ id: ROSTER, flowKind: "workforce-roster", parentSessionId: null }], readAt: 1 } as unknown as LoadedSnapshot;

beforeEach(() => {
  runAction.mockReset();
  window.history.replaceState(null, "", "/routines");
});
afterEach(() => cleanup());

describe("the routine list", () => {
  it("keeps the order the list answered, clock and event together", () => {
    expect(toRoutines({ routines: [off, weekly, review] }).map((r) => r.id)).toEqual(["clock:paused", "clock:adoption", "event:sub_1"]);
  });

  it("leaves out a row that isn't a routine", () => {
    expect(toRoutines({ routines: [weekly, { id: 1 }, null] }).map((r) => r.id)).toEqual(["clock:adoption"]);
    expect(toRoutines(undefined)).toEqual([]);
  });

  it("says a paused routine is paused, whatever its cron, and names who made each", () => {
    expect(nextRunLabel("2026-10-26T09:00:00.000Z", true)).toBe("paused");
    expect(nextRunLabel(null, false)).toBe("no next run");
    expect([madeByLabel({ by: "user" }), madeByLabel({ by: "app", entry: "x" }), madeByLabel(null)]).toEqual(["made by you", "the app's", ""]);
  });
});

describe("the Routines view", () => {
  it("lists clock and event routines read through the user's roster session", async () => {
    runAction.mockResolvedValue({ output: { routines: [weekly, off, review] }, sessionId: ROSTER });
    render(<Routines snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("routine");
    expect(runAction.mock.calls[0]!.slice(1, 4)).toEqual(["workforce-roster", ROSTER, "listRoutines"]);
    expect(lines.map((l) => [l.getAttribute("data-id"), l.getAttribute("data-trigger"), l.getAttribute("data-paused")])).toEqual([
      ["clock:adoption", "clock", "false"],
      ["clock:paused", "clock", "true"],
      ["event:sub_1", "event", "false"],
    ]);
    expect(within(lines[0]!).getByTestId("routine-title").textContent).toBe("Refresh the adoption numbers");
    expect(within(lines[0]!).getByTestId("routine-detail").textContent).toContain("0 9 * * 1 · Europe/London");
    expect(within(lines[1]!).getByTestId("routine-when").textContent).toBe("paused");
    expect(within(lines[2]!).getByTestId("routine-detail").textContent).toContain("github:acme/api#412");
    expect(within(lines[2]!).getByTestId("routine-when").textContent).toBe("on each event");
  });

  it("pauses, resumes and deletes from a line, and reads the list again", async () => {
    runAction.mockImplementation(async (_c: unknown, _f: string, _s: string, action: string) =>
      action === "listRoutines" ? { output: { routines: [weekly, off] }, sessionId: ROSTER } : { output: { ok: true, routine: weekly }, sessionId: ROSTER },
    );
    render(<Routines snapshot={snapshot} />);
    const [on, paused] = await screen.findAllByTestId("routine");
    fireEvent.click(within(on!).getByTestId("routine-pause"));
    fireEvent.click(within(paused!).getByTestId("routine-pause"));
    // A line's buttons wait while its change is in flight.
    await waitFor(() => expect((within(on!).getByTestId("routine-delete") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(on!).getByTestId("routine-delete"));
    await waitFor(() => expect(runAction.mock.calls.filter((c) => c[3] === "listRoutines").length).toBeGreaterThan(1));
    expect(runAction.mock.calls.filter((c) => c[3] !== "listRoutines").map((c) => [c[3], c[4]])).toEqual([
      ["pauseRoutine", { id: "clock:adoption", paused: true }],
      ["pauseRoutine", { id: "clock:paused", paused: false }],
      ["deleteRoutine", { id: "clock:adoption" }],
    ]);
  });

  it("offers an app's routine a pause and no delete, and says why a change was refused", async () => {
    runAction.mockImplementation(async (_c: unknown, _f: string, _s: string, action: string) =>
      action === "listRoutines"
        ? { output: { routines: [declared] }, sessionId: ROSTER }
        : { output: { ok: false, error: "declared: it follows the app's config" }, sessionId: ROSTER },
    );
    render(<Routines snapshot={snapshot} />);
    const [line] = await screen.findAllByTestId("routine");
    expect(within(line!).queryByTestId("routine-delete")).toBeNull();
    fireEvent.click(within(line!).getByTestId("routine-pause"));
    expect((await within(line!).findByTestId("routine-problem")).textContent).toContain("declared");
  });

  it("says so when there are none", async () => {
    runAction.mockResolvedValue({ output: { routines: [] }, sessionId: ROSTER });
    render(<Routines snapshot={snapshot} />);
    expect((await screen.findByTestId("routines-empty")).textContent).toContain("No routines yet");
  });

  it("says what the Lab answered when the list didn't load", async () => {
    runAction.mockRejectedValue(new Error("store offline"));
    render(<Routines snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByTestId("routines-failure").textContent).toContain("store offline"));
  });

  it("is at /routines, and the old /schedules address still opens it", () => {
    expect(parseRoute("/routines")).toEqual({ level: "routines" });
    expect(parseRoute("/schedules")).toEqual({ level: "routines" });
    expect(pathFor({ level: "routines" })).toBe("/routines");
  });
});
