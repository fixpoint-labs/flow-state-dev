// @vitest-environment happy-dom
/**
 * Routines: everything that runs as the user on its own, clock and event, in
 * one list read through the roster flow's `routines` view with no session,
 * each with its maker, and paused, resumed or deleted from its line by a send
 * to the routines collection, which the roster flow writes.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSnapshot } from "../src/lib/derive";
import { parseRoute, pathFor } from "../src/lib/routes";
import { ClientHttpError } from "@flow-state-dev/client";
import { toRoutines } from "../src/lib/routines";

/** The view read: `(ref, input)`. */
const view = vi.fn();
/** A send to a collection: `(pattern, verb, input)`. */
const send = vi.fn();
const runAction = vi.fn();
vi.mock("../src/lib/action", async (original) => ({
  ...(await original<typeof import("../src/lib/action")>()),
  runAction: (...a: unknown[]) => runAction(...a),
}));
const lab = {
  client: {
    userId: "u_1",
    view: (...a: unknown[]) => view(...a),
    resource: (def: { pattern: string }) => ({ send: (verb: string, input: unknown) => send(def.pattern, verb, input) }),
  },
  refresh: vi.fn(),
};
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

// No session of the roster flow: the list and its changes need none.
const snapshot = { sessions: [], readAt: 1 } as unknown as LoadedSnapshot;
const listed = (routines: unknown[]) => ({ value: { routines }, topics: [] });

beforeEach(() => {
  runAction.mockReset();
  view.mockReset();
  send.mockReset();
  window.history.replaceState(null, "", "/routines");
});
afterEach(() => cleanup());

describe("the routine list", () => {
  it("keeps the order the list answered, clock and event together", () => {
    expect(toRoutines({ routines: [off, weekly, review] }).map((r) => r.id)).toEqual(["clock:paused", "clock:adoption", "event:sub_1"]);
  });

  it("leaves out an answer that isn't a routine", () => {
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
  it("lists clock and event routines read through the roster flow's view, with no session", async () => {
    view.mockResolvedValue(listed([weekly, off, review]));
    render(<Routines snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("routine");
    expect(view.mock.calls[0]![0]).toMatchObject({ flow: "workforce-roster", view: "routines" });
    expect(runAction).not.toHaveBeenCalled();
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

  it("pauses, resumes and deletes from a line by a send to the routines collection, and reads the list again", async () => {
    view.mockResolvedValue(listed([weekly, off]));
    send.mockResolvedValue({ ok: true, routine: weekly });
    render(<Routines snapshot={snapshot} />);
    const [on, paused] = await screen.findAllByTestId("routine");
    fireEvent.click(within(on!).getByTestId("routine-pause"));
    fireEvent.click(within(paused!).getByTestId("routine-pause"));
    // A line's buttons wait while its change is in flight.
    await waitFor(() => expect((within(on!).getByTestId("routine-delete") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(on!).getByTestId("routine-delete"));
    await waitFor(() => expect(view.mock.calls.length).toBeGreaterThan(1));
    expect(send.mock.calls).toEqual([
      ["workforce/schedules/*", "pauseRoutine", { id: "clock:adoption", paused: true }],
      ["workforce/schedules/*", "pauseRoutine", { id: "clock:paused", paused: false }],
      ["workforce/schedules/*", "deleteRoutine", { id: "clock:adoption" }],
    ]);
    expect(runAction).not.toHaveBeenCalled();
  });

  it("offers an app's routine a pause and no delete, and says why a change was refused", async () => {
    view.mockResolvedValue(listed([declared]));
    send.mockResolvedValue({ ok: false, error: "declared: it follows the app's config" });
    render(<Routines snapshot={snapshot} />);
    const [line] = await screen.findAllByTestId("routine");
    expect(within(line!).queryByTestId("routine-delete")).toBeNull();
    fireEvent.click(within(line!).getByTestId("routine-pause"));
    expect((await within(line!).findByTestId("routine-problem")).textContent).toContain("declared");
  });

  it("says so when there are none", async () => {
    view.mockResolvedValue(listed([]));
    render(<Routines snapshot={snapshot} />);
    expect((await screen.findByTestId("routines-empty")).textContent).toContain("No routines yet");
  });

  it("says the Lab keeps no routines when it serves no roster flow", async () => {
    view.mockRejectedValue(new ClientHttpError("Request failed (404)", { status: 404, body: { error: 'Unknown flow "workforce-roster"' } }));
    render(<Routines snapshot={snapshot} />);
    expect((await screen.findByTestId("routines-empty")).textContent).toContain("keeps no roster for you");
  });

  it("says what the Lab answered when the list didn't load", async () => {
    view.mockRejectedValue(new Error("store offline"));
    render(<Routines snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByTestId("routines-failure").textContent).toContain("store offline"));
  });

  it("is at /routines, and the old /schedules address still opens it", () => {
    expect(parseRoute("/routines")).toEqual({ level: "routines" });
    expect(parseRoute("/schedules")).toEqual({ level: "routines" });
    expect(pathFor({ level: "routines" })).toBe("/routines");
  });
});
