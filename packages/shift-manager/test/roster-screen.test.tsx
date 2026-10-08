// @vitest-environment happy-dom
/**
 * Roster, the sidebar, the workstream panel and Tasks, drawn over one fixed
 * snapshot (V3 to V5; BR-6 to BR-20). The reader is swapped for one that hands back
 * the fixture, so every screen draws exactly what the snapshot holds.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import type { LabClients } from "../src/lib/connection";
import { STAFF_TEAM, toBoardRow, toSeat, toWorkstream, type Ask, type BoardRow, type LabSnapshot, type Section, type WorkstreamBoards } from "../src/lib/reads";

let fixture: LabSnapshot;
/** What the person's roster read answers: their own workers and the standard ones. */
let rosterRead: () => Promise<Array<{ id: string; flow: string; standard: boolean; description: string | null }>> = async () => [];

vi.mock("../src/lib/workforce", () => ({
  useWorkforce: () => ({ roster: () => rosterRead() }),
}));

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
const seat = (id: string, kind = "worker") => toSeat({ id, kind })!;
const row = (mailbox: string, id: string, status: string, assignee: string): BoardRow =>
  toBoardRow(`${mailbox}.work`, mailbox, id, { id, title: `${id} title`, status, assignee });
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
    toWorkstream({ id: "eng.desk", kind: "mailbox", members: ["eng.coder", "eng.reviewer"] })!,
    toWorkstream({ id: "ops.desk", kind: "mailbox", members: ["ops.asker", "ops.idle"] })!,
  ];
  const ok = (rows: BoardRow[]): Section<WorkstreamBoards> => ({ ok: true, value: { refs: [`${rows[0]!.mailboxId}.work`], rows } });
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
    projects: { ok: true, value: { rows: [] } },
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
  rosterRead = async () => [];
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

  it("draws the person's own workers from their roster, marked as theirs, beside the inventory's (S12)", async () => {
    rosterRead = async () => [
      { id: "amber-1f2e", flow: "coder", standard: false, description: "Alice's own" },
      { id: "eng.coder", flow: "coder", standard: true, description: null },
    ];
    await open("/roster");
    const page = await screen.findByTestId("roster");
    await within(page).findByTestId("roster-worker-own");
    const workers = within(page).getAllByTestId("roster-worker");
    const own = workers.filter((w) => w.getAttribute("data-own") === "true").map((w) => w.getAttribute("data-seat-id"));
    expect(own).toEqual(["amber-1f2e"]);
    // The standard ones are the inventory's rows, drawn once each.
    expect(workers.filter((w) => w.getAttribute("data-seat-id") === "eng.coder")).toHaveLength(1);
    expect(workers).toHaveLength(6);
  });

  it("with the inventory unread, still draws the roster's workers, and says the inventory failed", async () => {
    rosterRead = async () => [
      { id: "amber-1f2e", flow: "coder", standard: false, description: null },
      { id: "eng.coder", flow: "coder", standard: true, description: null },
    ];
    await open("/roster", lab({ inventory: "failed" }));
    const page = await screen.findByTestId("roster");
    await within(page).findByTestId("roster-worker-own");
    expect(within(page).getAllByTestId("roster-worker").map((w) => w.getAttribute("data-seat-id")).sort()).toEqual(["amber-1f2e", "eng.coder"]);
    expect(within(page).getByTestId("roster-inventory-failure").textContent).toContain("inventory offline");
  });

  it("says so when the person's own workers didn't load, and still draws the inventory's", async () => {
    rosterRead = async () => {
      throw new Error("roster offline");
    };
    await open("/roster");
    const page = await screen.findByTestId("roster");
    expect((await within(page).findByTestId("roster-own-failure")).textContent).toContain("roster offline");
    expect(within(page).getAllByTestId("roster-worker")).toHaveLength(5);
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

describe("Roster in design v2's form", () => {
  it("heads its columns as v2 does and says what each group's status means", async () => {
    await open("/roster");
    const page = await screen.findByTestId("roster");
    expect(within(page).getByTestId("roster-columns").textContent).toBe("WORKERSLOTSHOLDINGON CALL FOR");
    expect(within(page).getAllByTestId("roster-group").map((g) => [g.getAttribute("data-status"), within(g).getByTestId("roster-group-sub").textContent])).toEqual([
      ["on shift", "holding live work"],
      ["on call", "subscribed and waiting · wakes on a trigger"],
      ["off shift", "nothing assigned, nothing subscribed"],
    ]);
  });

  it("tags each task and ask waiting on you WAITING, with what on one line and when on the next", async () => {
    await open("/roster");
    const workers = await screen.findAllByTestId("roster-worker");
    const waits = (seatId: string) =>
      within(workers.find((w) => w.getAttribute("data-seat-id") === seatId)!)
        .getAllByTestId("roster-wait")
        .map((w) => [within(w).getByTestId("roster-wait-tag").textContent, within(w).getByTestId("roster-wait-what").textContent, within(w).getByTestId("roster-wait-when").textContent]);
    expect(waits("eng.coder")).toEqual([["WAITING", "you · E-2", "E-2 title"]]);
    expect(waits("ops.asker")).toEqual([["WAITING", "you · approval", "Approve: ship it"]]);
  });
});

describe("Tasks (BR-14)", () => {
  const shown = () => attrs(screen.getAllByTestId("task-row"), "data-task-id");

  it("hides queued rows until the toggle is on, and the toggle says how many it hides", async () => {
    await open("/tasks");
    await screen.findByTestId("tasks-table");
    // O-1 is pending: the one queued row. Everything else open is in flight.
    expect(shown()).toEqual(["E-1", "E-2", "E-3"]);
    const toggle = screen.getByTestId("tasks-queued-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(within(toggle).getByTestId("tasks-queued-count").textContent).toBe("1");
    act(() => fireEvent.click(toggle));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(shown()).toEqual(["O-1", "E-1", "E-2", "E-3"]);
    act(() => fireEvent.click(toggle));
    expect(shown()).toEqual(["E-1", "E-2", "E-3"]);
  });

  it("with nothing queued the toggle says 0 and hides nothing", async () => {
    const snapshot = lab();
    const ops = snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot.boards["ops.desk"] : undefined;
    if (ops?.ok === true) ops.value.rows = ops.value.rows.map((r) => ({ ...r, status: "in_progress" }));
    await open("/tasks", snapshot);
    await screen.findByTestId("tasks-table");
    expect(screen.getByTestId("tasks-queued-count").textContent).toBe("0");
    expect(shown()).toEqual(["E-1", "O-1", "E-2", "E-3"]);
  });

  it("draws v2's columns in v2's order, each row's id, and TIME from the row's start for a running row only", async () => {
    const snapshot = lab();
    const eng = snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot.boards["eng.desk"] : undefined;
    if (eng?.ok === true) eng.value.rows = eng.value.rows.map((r) => ({ ...r, startedAt: Date.now() - 400_000 }));
    await open("/tasks", snapshot);
    const table = await screen.findByTestId("tasks-table");
    expect(within(table).getAllByRole("columnheader").slice(0, 8).map((th) => th.textContent)).toEqual(["", "ID", "TASK", "NOW", "STREAM", "WORKER", "TIME", "COST"]);
    const cell = (id: string, testId: string) => within(screen.getAllByTestId("task-row").find((r) => r.getAttribute("data-task-id") === id)!).getByTestId(testId).textContent;
    expect(cell("E-1", "task-row-id")).toBe("E-1");
    expect(cell("E-1", "task-row-stream")).toBe("#eng.desk");
    expect(cell("E-1", "task-row-worker")).toBe("coder");
    expect(cell("E-1", "task-row-time")).toMatch(/^6m 4\ds$/);
    // E-2 is parked: it waits on you, so its clock isn't running.
    expect(cell("E-2", "task-row-time")).toBe("—");
  });

  it("sums up what is in flight, what waits on you, the shift and the streams", async () => {
    await open("/tasks");
    expect((await screen.findByTestId("tasks-summary")).textContent).toBe("3 in flight · 1 needs you · 1 on shift · 2 on call · 1 stream");
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
