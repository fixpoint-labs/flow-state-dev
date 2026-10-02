// @vitest-environment happy-dom
/**
 * Roster, the sidebar and the workstream panel, drawn over one fixed snapshot
 * (V3 to V5; BR-6 to BR-20). The reader is swapped for one that hands back
 * the fixture, so every screen draws exactly what the snapshot holds.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import type { LabClients } from "../src/lib/connection";
import { STAFF_TEAM, toBoardRow, toSeat, toWorkstream, type Ask, type BoardRow, type LabSnapshot, type Section, type WorkstreamBoards } from "../src/lib/reads";

let fixture: LabSnapshot;

vi.mock("../src/lib/reads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/reads")>();
  return {
    ...real,
    createLabReader: () => ({
      read: async () => fixture,
      readBoard: async () => [],
      resume: async () => {},
    }),
  };
});

const ORG = "acme";
const seat = (id: string, kind = "worker") => toSeat({ id, kind }, ORG)!;
const row = (channel: string, id: string, status: string, assignee: string): BoardRow =>
  toBoardRow(`${channel}.work`, channel, id, { id, title: `${id} title`, status, assignee });
const ask = (seatId: string, suspensionId: string, message: string): Ask =>
  ({
    sessionId: `s_${suspensionId}`,
    seatId,
    flowId: seatId,
    parentSessionId: null,
    kind: "approval",
    item: { suspensionId, requestId: `r_${suspensionId}`, reason: "human_approval", message },
    since: 0,
    unanswerable: null,
  }) as unknown as Ask;

/**
 * Two teams and one org seat: eng.coder running (and one parked), eng.reviewer
 * parked, ops.asker with a pending ask and a queued row, ops.idle nothing,
 * chief-of-staff nothing.
 */
function lab(options: { asks?: "failed"; boards?: "ops failed"; inventory?: "failed" } = {}): LabSnapshot {
  const seats = [seat("eng.coder", "coder"), seat("eng.reviewer"), seat("ops.asker", "asker"), seat("ops.idle"), seat("chief-of-staff", "cos")];
  const workstreams = [
    toWorkstream({ id: "eng.desk", kind: "channel", members: ["eng.coder", "eng.reviewer"] })!,
    toWorkstream({ id: "ops.desk", kind: "channel", members: ["ops.asker", "ops.idle"] })!,
  ];
  const ok = (rows: BoardRow[]): Section<WorkstreamBoards> => ({ ok: true, value: { refs: [`${rows[0]!.channelId}.work`], rows } });
  return {
    readAt: Date.UTC(2026, 9, 1, 9, 30),
    sessions: [],
    orgId: ORG,
    inventory: options.inventory === "failed" ? { ok: false, failure: { message: "inventory offline" } } : { ok: true, value: { seats, workstreams } },
    boards:
      options.inventory === "failed"
        ? {}
        : {
            "eng.desk": ok([row("eng.desk", "E-1", "in_progress", "coder"), row("eng.desk", "E-2", "parked", "coder"), row("eng.desk", "E-3", "parked", "reviewer")]),
            "ops.desk": options.boards === "ops failed" ? { ok: false, failure: { message: "board offline" } } : ok([row("ops.desk", "O-1", "pending", "asker")]),
          },
    asks: options.asks === "failed" ? { ok: false, failure: { message: "asks offline" } } : { ok: true, value: [ask("ops.asker", "q1", "Approve: ship it")] },
    resources: { ok: true, value: [] },
  };
}

const clients = { userId: "u_test" } as unknown as LabClients;

async function open(path: string, snapshot: LabSnapshot = lab()) {
  fixture = snapshot;
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://lab.local${path}`);
  render(<App clients={clients} />);
  await screen.findByTestId("sidebar");
}

const attrs = (els: HTMLElement[], name: string) => els.map((el) => el.getAttribute(name));

beforeEach(() => {
  fixture = lab();
});
afterEach(() => cleanup());

describe("Roster (V3)", () => {
  it("groups every seat, on shift, on call, off shift, with Staff's seat in it", async () => {
    await open("/roster");
    const page = await screen.findByTestId("roster");
    expect(attrs(within(page).getAllByTestId("roster-group"), "data-status")).toEqual(["on shift", "on call", "off shift"]);
    const workers = within(page).getAllByTestId("roster-worker");
    expect(workers.map((w) => [w.getAttribute("data-seat-id"), w.getAttribute("data-status")])).toEqual([
      ["eng.coder", "on shift"],
      ["eng.reviewer", "on call"],
      ["ops.asker", "on call"],
      ["ops.idle", "off shift"],
      ["chief-of-staff", "off shift"],
    ]);
    expect(within(page).getByTestId("roster-summary").textContent).toMatch(/^1 on shift · 2 on call · 2 off shift · 3 waiting on you/);
  });

  it("draws slots as a count and one square per held task, with no free squares (D2)", async () => {
    await open("/roster");
    const coder = (await screen.findAllByTestId("roster-worker")).find((w) => w.getAttribute("data-seat-id") === "eng.coder")!;
    expect(within(coder).getByTestId("roster-slots").textContent).toBe("2 in use");
    expect(within(coder).getAllByTestId("roster-slot")).toHaveLength(2);
    const asker = screen.getAllByTestId("roster-worker").find((w) => w.getAttribute("data-seat-id") === "ops.asker")!;
    // A queued row is not a slot, and an ask is not a slot.
    expect(within(asker).getByTestId("roster-slots").textContent).toBe("0 in use");
    expect(within(asker).queryAllByTestId("roster-slot")).toHaveLength(0);
    expect(within(asker).getByTestId("roster-nothing").textContent).toBe("nothing assigned");
  });

  it("HOLDING chips open their task, and waits-on lists each parked task and each ask", async () => {
    await open("/roster");
    const workers = await screen.findAllByTestId("roster-worker");
    const coder = workers.find((w) => w.getAttribute("data-seat-id") === "eng.coder")!;
    const chips = within(coder).getAllByTestId("roster-holding");
    expect(chips.map((c) => c.getAttribute("data-task-id"))).toEqual(["E-1", "E-2"]);
    expect(attrs(within(coder).getAllByTestId("roster-wait"), "data-id")).toEqual(["E-2"]);
    const asker = workers.find((w) => w.getAttribute("data-seat-id") === "ops.asker")!;
    expect(within(asker).getAllByTestId("roster-wait").map((w) => [w.getAttribute("data-kind"), w.getAttribute("data-id")])).toEqual([["ask", "q1"]]);
    const idle = workers.find((w) => w.getAttribute("data-seat-id") === "ops.idle")!;
    expect(within(idle).getByTestId("roster-no-wait").textContent).toBe("—");

    act(() => fireEvent.click(chips[0]!));
    expect(window.location.pathname).toBe("/tasks/eng.desk.work/E-1/session");
  });

  it("names its gaps: standing watches, which seat holds a task, and the harness", async () => {
    await open("/roster");
    expect((await screen.findByTestId("roster-gap-watches")).textContent).toBe(GAPS.roster.watches);
    expect(screen.getByTestId("roster-gap-seat-match").textContent).toBe(GAPS.roster.seatMatch);
    expect(GAPS.roster.watches).toMatch(/FIX-1675/);
    expect(GAPS.roster.seatMatch).toMatch(/FIX-1672/);
    expect(screen.getAllByTestId("roster-worker-harness")[0]!.getAttribute("title")).toBe(GAPS.harness);
  });

  it("a picked team shows exactly its seats, its counts, and its name in the title", async () => {
    await open("/roster?team=ops");
    const page = await screen.findByTestId("roster");
    expect(attrs(within(page).getAllByTestId("roster-worker"), "data-seat-id")).toEqual(["ops.asker", "ops.idle"]);
    expect(within(page).getByTestId("roster-title").textContent).toMatch(/ops$/);
    expect(within(page).getByTestId("roster-summary").textContent).toMatch(/^0 on shift · 1 on call · 1 off shift · 1 waiting on you/);
    act(() => fireEvent.click(within(page).getAllByTestId("roster-team-option").find((o) => o.getAttribute("data-team") === STAFF_TEAM)!));
    expect(attrs(within(screen.getByTestId("roster")).getAllByTestId("roster-worker"), "data-seat-id")).toEqual(["chief-of-staff"]);
  });

  it("BR-13: a team the inventory doesn't have reads as All", async () => {
    await open("/roster?team=nope");
    expect(await screen.findAllByTestId("roster-worker")).toHaveLength(5);
  });

  it("BR-18: an inventory that did not load shows its failure with Retry and no counts", async () => {
    await open("/roster", lab({ inventory: "failed" }));
    const failure = await screen.findByTestId("roster-inventory-failure");
    expect(within(failure).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByTestId("roster-summary")).toBeNull();
  });

  it("BR-19: a workstream whose boards did not load is named, and none of its tasks counts", async () => {
    await open("/roster", lab({ boards: "ops failed" }));
    expect((await screen.findByTestId("roster-boards-failure")).textContent).toMatch(/ops\.desk/);
    expect(screen.getByTestId("roster-summary").textContent).toMatch(/^1 on shift · 2 on call/);
  });

  it("BR-20: asks that did not load put the partial mark on Roster", async () => {
    await open("/roster", lab({ asks: "failed" }));
    const page = await screen.findByTestId("roster");
    expect(within(page).getByTestId("partial-mark").getAttribute("title")).toBe(GAPS.roster.partial);
    // The asker's only wait was its ask: drawn from the boards, it reads off shift.
    expect(within(page).getAllByTestId("roster-worker").find((w) => w.getAttribute("data-seat-id") === "ops.asker")!.getAttribute("data-status")).toBe("off shift");
  });

  it("BR-20, failure taxonomy: asks that did not load are named on Roster with the Lab's answer and Retry", async () => {
    await open("/roster", lab({ asks: "failed" }));
    const failure = await screen.findByTestId("roster-asks-failure");
    expect(failure.textContent).toMatch(/asks offline/);
    expect(within(failure).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(within(screen.getByTestId("roster")).getByTestId("partial-mark")).toBeTruthy();
  });

  it("draws no partial mark when asks loaded", async () => {
    await open("/roster");
    await screen.findByTestId("roster");
    expect(screen.queryAllByTestId("partial-mark")).toHaveLength(0);
    expect(screen.queryByTestId("roster-asks-failure")).toBeNull();
  });
});

describe("the sidebar (V4)", () => {
  it("has Roster under Tasks with on shift · on call, and the footer says the same", async () => {
    await open("/inbox");
    const nav = within(screen.getByTestId("sidebar")).getAllByRole("button").map((b) => b.getAttribute("data-testid"));
    expect(nav.indexOf("nav-roster")).toBe(nav.indexOf("nav-tasks") + 1);
    expect(screen.getByTestId("nav-roster-count").textContent).toBe("1·2");
    expect(screen.getByTestId("footer-on-shift").textContent).toBe("1 on shift");
    expect(screen.getByTestId("footer-on-call").textContent).toBe("2 on call");
  });

  it("TEAMS is one row per team, Staff first, with a square per seat and its on-shift count; no worker list", async () => {
    await open("/inbox");
    const teams = screen.getAllByTestId("team");
    expect(attrs(teams, "data-team")).toEqual([STAFF_TEAM, "eng", "ops"]);
    expect(teams.map((t) => within(t).getByTestId("team-on-shift").textContent)).toEqual(["0/1", "1/2", "0/2"]);
    const eng = teams[1]!;
    expect(within(eng).getAllByTestId("worker").map((w) => [w.getAttribute("data-seat-id"), w.getAttribute("data-status"), w.getAttribute("title")])).toEqual([
      ["eng.coder", "on shift", "coder · on shift"],
      ["eng.reviewer", "on call", "reviewer · on call"],
    ]);
    expect(screen.queryByTestId("worker-kind")).toBeNull();
  });

  it("a TEAMS row opens Roster for that team, and is marked current", async () => {
    await open("/inbox");
    act(() => fireEvent.click(screen.getAllByTestId("team")[2]!));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/roster?team=ops");
    expect(attrs(await screen.findAllByTestId("roster-worker"), "data-seat-id")).toEqual(["ops.asker", "ops.idle"]);
    expect(screen.getAllByTestId("team")[2]!.getAttribute("aria-current")).toBe("page");
  });

  it("BR-20: the counts and the footer carry the partial mark when asks did not load", async () => {
    await open("/inbox", lab({ asks: "failed" }));
    expect(within(screen.getByTestId("nav-roster")).getByTestId("partial-mark")).toBeTruthy();
    expect(within(screen.getByTestId("sidebar-footer")).getByTestId("partial-mark")).toBeTruthy();
  });
});

describe("the workstream panel and Jump to (V5)", () => {
  it("BR-6: the panel's word for a seat is Roster's", async () => {
    await open("/w/eng.desk/stream");
    const members = await screen.findAllByTestId("panel-member");
    expect(members.map((m) => within(m).getByTestId("status-word").getAttribute("data-status"))).toEqual(["on shift", "on call"]);
    expect(screen.queryAllByTestId("partial-mark")).toHaveLength(0);
  });

  it("BR-20: the panel carries the partial mark when asks did not load", async () => {
    await open("/w/eng.desk/stream", lab({ asks: "failed" }));
    const panel = await screen.findByTestId("panel-team");
    expect(within(panel).getByTestId("partial-mark")).toBeTruthy();
  });

  it("BR-17: a worker found in Jump to opens Roster", async () => {
    await open("/inbox");
    act(() => fireEvent.click(screen.getByTestId("jump-to")));
    act(() => fireEvent.change(screen.getByTestId("jump-input"), { target: { value: "eng.reviewer" } }));
    act(() => fireEvent.click(screen.getAllByTestId("jump-result")[0]!));
    expect(window.location.pathname).toBe("/roster");
  });
});
