// @vitest-environment happy-dom
/**
 * Roster, the sidebar, Jump to and Tasks, drawn over one fixed
 * snapshot (V3 to V5; BR-6 to BR-20). The reader is swapped for one that hands back
 * the fixture, so every screen draws exactly what the snapshot holds.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import type { Client } from "@flow-state-dev/client";
import type { LoadedSnapshot } from "../src/lib/derive";
import { GENERAL_TEAM, inboxSection, toBoardRow, toWorker, type Ask, type BoardRow, type ConversationBoards, type LabSnapshot, type Section } from "../src/lib/reads";

let fixture: LabSnapshot;
/** What the user's roster read answers: their own workers and the standard ones. */
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
const worker = (id: string, kind = "worker") => toWorker({ id, kind })!;
const row = (holder: string, id: string, status: string, assignee: string): BoardRow =>
  toBoardRow(`${holder}.tasks`, holder, id, { id, title: `${id} title`, status, assignee });
/** A running row held on a question for you (FIX-2131): what a task waiting on you is. */
const waiting = (holder: string, id: string, assignee: string): BoardRow =>
  toBoardRow(`${holder}.tasks`, holder, id, {
    id,
    title: `${id} title`,
    status: "in_progress",
    assignee,
    holds: [{ id: `q-${id}`, actor: "user", openedAt: 1, source: { kind: "row", closedBy: [{ by: "answer" }] }, ask: { kind: "question", prompt: "Which one?" } }],
  });
const ask = (workerId: string, suspensionId: string, message: string): Ask =>
  ({
    sessionId: `s_${suspensionId}`,
    workerId,
    flowId: workerId,
    parentSessionId: null,
    kind: "approval",
    item: { suspensionId, requestId: `r_${suspensionId}`, reason: "user_approval", message },
    since: 0,
    unanswerable: null,
  }) as unknown as Ask;

/**
 * Two teams and one org worker: eng.coder running (and one held on a question
 * for you), eng.reviewer held on one, ops.asker with a pending ask and a queued
 * row, ops.idle nothing, shift-coordinator nothing.
 */
function lab(options: { asks?: "failed"; boards?: "ops failed"; inventory?: "failed" } = {}): LabSnapshot {
  const workers = [worker("eng.coder", "coder"), worker("eng.reviewer"), worker("ops.asker", "asker"), worker("ops.idle"), worker("shift-coordinator", "shift-coordinator")];
  const ok = (rows: BoardRow[]): Section<ConversationBoards> => ({ ok: true, value: { refs: [rows[0]!.boardRef], rows } });
  const read: Omit<LoadedSnapshot, "inbox"> = {
    readAt: Date.UTC(2026, 9, 1, 9, 30),
    sessions: [],
    orgId: ORG,
    inventory: options.inventory === "failed" ? { ok: false, failure: { message: "inventory offline" } } : { ok: true, value: { workers } },
    boards:
      options.inventory === "failed"
        ? {}
        : {
            s_eng: ok([row("s_eng", "E-1", "in_progress", "coder"), waiting("s_eng", "E-2", "coder"), waiting("s_eng", "E-3", "reviewer")]),
            s_ops: options.boards === "ops failed" ? { ok: false, failure: { message: "board offline" } } : ok([row("s_ops", "O-1", "pending", "asker")]),
          },
    asks: options.asks === "failed" ? { ok: false, failure: { message: "asks offline" } } : { ok: true, value: [ask("ops.asker", "q1", "Approve: ship it")] },
    resources: { ok: true, value: [] },
    projects: { ok: true, value: { rows: [] } },
  };
  return { ...read, inbox: inboxSection(read.asks, read.boards, read.sessions) };
}

async function open(path: string, snapshot: LabSnapshot = lab()) {
  fixture = snapshot;
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://lab.local${path}`);
  // A connection per page, as a fresh load makes: the roster read is shared per connection.
  render(<App connection={{ userId: "u_test" }} />);
  await screen.findByTestId("sidebar");
}

const attrs = (els: HTMLElement[], name: string) => els.map((el) => el.getAttribute(name));

// A wide window: the right panel is drawn beside the centre only from 1180px.
beforeEach(() => (window as unknown as { happyDOM: { setViewport(viewport: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 1600, height: 900 }));
beforeEach(() => {
  fixture = lab();
  rosterRead = async () => [];
});
afterEach(() => cleanup());

describe("Roster (V3)", () => {
  it("groups every worker, on shift, off shift, with General's worker in it", async () => {
    await open("/roster");
    const page = await screen.findByTestId("roster");
    expect(attrs(within(page).getAllByTestId("roster-group"), "data-status")).toEqual(["on shift", "off shift"]);
    const workers = within(page).getAllByTestId("roster-worker");
    expect(workers.map((w) => [w.getAttribute("data-worker-id"), w.getAttribute("data-status")])).toEqual([
      ["eng.coder", "on shift"],
      ["eng.reviewer", "on shift"],
      ["ops.asker", "on shift"],
      // The Shift Coordinator first in its group: the coordinator the user's work goes through (FIX-1791 BR-33).
      ["shift-coordinator", "off shift"],
      ["ops.idle", "off shift"],
    ]);
    expect(within(page).getByTestId("roster-summary").textContent).toMatch(/^3 on shift · 2 off shift · 3 waiting on you/);
  });

  it("names the shift-coordinator worker Shift Coordinator, keeping its id, and a worker with no display name by its id", async () => {
    await open("/roster");
    const page = await screen.findByTestId("roster");
    const row = (id: string) => within(page).getAllByTestId("roster-worker").find((w) => w.getAttribute("data-worker-id") === id)!;
    expect(row("shift-coordinator").querySelector(".font-medium")!.textContent).toBe("Shift Coordinator");
    expect(row("eng.coder").querySelector(".font-medium")!.textContent).toBe("eng.coder");
    // The id is wire data; nothing a user reads on the screen says Shift Coordinator.
    expect(document.body.textContent).not.toMatch(/chief[ -]of[ -]staff/i);
  });

  it("draws the user's own workers from their roster, marked as theirs, beside the inventory's (S12)", async () => {
    rosterRead = async () => [
      { id: "amber-1f2e", flow: "coder", standard: false, description: "Alice's own" },
      { id: "eng.coder", flow: "coder", standard: true, description: null },
    ];
    await open("/roster");
    const page = await screen.findByTestId("roster");
    await within(page).findByTestId("roster-worker-own");
    const workers = within(page).getAllByTestId("roster-worker");
    const own = workers.filter((w) => w.getAttribute("data-own") === "true").map((w) => w.getAttribute("data-worker-id"));
    expect(own).toEqual(["amber-1f2e"]);
    // The standard ones are the inventory's rows, drawn once each.
    expect(workers.filter((w) => w.getAttribute("data-worker-id") === "eng.coder")).toHaveLength(1);
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
    expect(within(page).getAllByTestId("roster-worker").map((w) => w.getAttribute("data-worker-id")).sort()).toEqual(["amber-1f2e", "eng.coder"]);
    expect(within(page).getByTestId("roster-inventory-failure").textContent).toContain("inventory offline");
  });

  it("says so when the user's own workers didn't load, and still draws the inventory's", async () => {
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
    const coder = (await screen.findAllByTestId("roster-worker")).find((w) => w.getAttribute("data-worker-id") === "eng.coder")!;
    expect(within(coder).getByTestId("roster-slots").textContent).toBe("2 in use");
    expect(within(coder).getAllByTestId("roster-slot")).toHaveLength(2);
    const asker = screen.getAllByTestId("roster-worker").find((w) => w.getAttribute("data-worker-id") === "ops.asker")!;
    // A queued row is not a slot, and an ask is not a slot.
    expect(within(asker).getByTestId("roster-slots").textContent).toBe("0 in use");
    expect(within(asker).queryAllByTestId("roster-slot")).toHaveLength(0);
    expect(within(asker).getByTestId("roster-nothing").textContent).toBe("nothing assigned");
  });

  it("HOLDING chips open their task, and waits-on lists each parked task and each ask", async () => {
    await open("/roster");
    const workers = await screen.findAllByTestId("roster-worker");
    const coder = workers.find((w) => w.getAttribute("data-worker-id") === "eng.coder")!;
    const chips = within(coder).getAllByTestId("roster-holding");
    expect(chips.map((c) => c.getAttribute("data-task-id"))).toEqual(["E-1", "E-2"]);
    expect(attrs(within(coder).getAllByTestId("roster-wait"), "data-id")).toEqual(["E-2"]);
    const asker = workers.find((w) => w.getAttribute("data-worker-id") === "ops.asker")!;
    expect(within(asker).getAllByTestId("roster-wait").map((w) => [w.getAttribute("data-kind"), w.getAttribute("data-id")])).toEqual([["ask", "q1"]]);
    const idle = workers.find((w) => w.getAttribute("data-worker-id") === "ops.idle")!;
    expect(within(idle).getByTestId("roster-no-wait").textContent).toBe("—");

    act(() => fireEvent.click(chips[0]!));
    expect(window.location.pathname).toBe("/tasks/s_eng.tasks/E-1/session");
  });

  it("names its gaps: which worker holds a task, and the harness", async () => {
    await open("/roster");
    expect((await screen.findByTestId("roster-gap-worker-match")).textContent).toBe(GAPS.roster.workerMatch);
    expect(screen.queryByTestId("roster-gap-watches")).toBeNull();
    expect(GAPS.roster.workerMatch).toMatch(/FIX-1672/);
    expect(screen.getAllByTestId("roster-worker-harness")[0]!.getAttribute("title")).toBe(GAPS.harness);
  });

  it("a picked team shows exactly its workers, its counts, and its name in the title", async () => {
    await open("/roster?team=ops");
    const page = await screen.findByTestId("roster");
    expect(attrs(within(page).getAllByTestId("roster-worker"), "data-worker-id")).toEqual(["ops.asker", "ops.idle"]);
    expect(within(page).getByTestId("roster-title").textContent).toMatch(/ops$/);
    expect(within(page).getByTestId("roster-summary").textContent).toMatch(/^1 on shift · 1 off shift · 1 waiting on you/);
    act(() => fireEvent.click(within(page).getAllByTestId("roster-team-option").find((o) => o.getAttribute("data-team") === GENERAL_TEAM)!));
    expect(attrs(within(screen.getByTestId("roster")).getAllByTestId("roster-worker"), "data-worker-id")).toEqual(["shift-coordinator"]);
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

  it("BR-19: a conversation whose board did not load is named, and none of its tasks counts", async () => {
    await open("/roster", lab({ boards: "ops failed" }));
    expect((await screen.findByTestId("roster-boards-failure")).textContent).toMatch(/s_ops/);
    expect(screen.getByTestId("roster-summary").textContent).toMatch(/^3 on shift · 2 off shift/);
  });

  it("BR-20: asks that did not load put the partial mark on Roster", async () => {
    await open("/roster", lab({ asks: "failed" }));
    const page = await screen.findByTestId("roster");
    expect(within(page).getByTestId("partial-mark").getAttribute("title")).toBe(GAPS.roster.partial);
    // The asker's only wait was its ask: drawn from the boards, it reads off shift.
    expect(within(page).getAllByTestId("roster-worker").find((w) => w.getAttribute("data-worker-id") === "ops.asker")!.getAttribute("data-status")).toBe("off shift");
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
    expect(within(page).getByTestId("roster-columns").textContent).toBe("WORKERSLOTSHOLDINGWAITING ON YOU");
    expect(within(page).getAllByTestId("roster-group").map((g) => [g.getAttribute("data-status"), within(g).getByTestId("roster-group-sub").textContent])).toEqual([
      ["on shift", "holding live work, running or waiting on you"],
      ["off shift", "nothing assigned"],
    ]);
  });

  it("tags each task and ask waiting on you WAITING, with what on one line and when on the next", async () => {
    await open("/roster");
    const workers = await screen.findAllByTestId("roster-worker");
    const waits = (workerId: string) =>
      within(workers.find((w) => w.getAttribute("data-worker-id") === workerId)!)
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

  it("links each row's title to its task, reachable by Tab, and leaves a modified click to the browser (FIX-2414)", async () => {
    await open("/tasks");
    await screen.findByTestId("tasks-table");
    const row = screen.getAllByTestId("task-row").find((r) => r.getAttribute("data-task-id") === "E-1")!;
    const link = within(row).getByTestId("task-row-link");
    const href = `/tasks/${encodeURIComponent(row.getAttribute("data-board-ref")!)}/E-1/session`;
    // A real address: it opens in a new tab, and Tab reaches it.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(href);
    // Cmd-click is the browser's (a new tab): the row doesn't take this tab there too.
    // Happy DOM would follow the link in this window, so the browser's part is stopped here.
    const browser = (event: Event) => event.preventDefault();
    document.addEventListener("click", browser);
    act(() => void fireEvent.click(link, { metaKey: true }));
    act(() => void fireEvent.click(within(row).getByTestId("task-row-worker"), { ctrlKey: true }));
    document.removeEventListener("click", browser);
    expect(window.location.pathname).toBe("/tasks");
    // A plain click on the link, or anywhere on the row, goes there in this tab.
    act(() => void fireEvent.click(link));
    expect(window.location.pathname).toBe(href);
  });

  it("opens a row's task from a plain click outside its title", async () => {
    await open("/tasks");
    await screen.findByTestId("tasks-table");
    const row = screen.getAllByTestId("task-row").find((r) => r.getAttribute("data-task-id") === "E-1")!;
    act(() => void fireEvent.click(within(row).getByTestId("task-row-worker")));
    expect(window.location.pathname).toBe(within(row).getByTestId("task-row-link").getAttribute("href"));
  });

  it("with nothing queued the toggle says 0 and hides nothing", async () => {
    const snapshot = lab();
    const ops = snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot.boards["s_ops"] : undefined;
    if (ops?.ok === true) ops.value.rows = ops.value.rows.map((r) => ({ ...r, status: "in_progress" }));
    await open("/tasks", snapshot);
    await screen.findByTestId("tasks-table");
    expect(screen.getByTestId("tasks-queued-count").textContent).toBe("0");
    // A task held on a question for you is running (FIX-2131): no column of its own.
    expect(shown()).toEqual(["E-1", "E-2", "E-3", "O-1"]);
  });

  it("draws v2's columns in v2's order, each row's id, and TIME from the row's start for a running row only", async () => {
    const snapshot = lab();
    const eng = snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot.boards["s_eng"] : undefined;
    if (eng?.ok === true) eng.value.rows = eng.value.rows.map((r) => ({ ...r, startedAt: Date.now() - 400_000 }));
    await open("/tasks", snapshot);
    const table = await screen.findByTestId("tasks-table");
    expect(within(table).getAllByRole("columnheader").slice(0, 8).map((th) => th.textContent)).toEqual(["", "ID", "TASK", "NOW", "STREAM", "WORKER", "TIME", "COST"]);
    const cell = (id: string, testId: string) => within(screen.getAllByTestId("task-row").find((r) => r.getAttribute("data-task-id") === id)!).getByTestId(testId).textContent;
    expect(cell("E-1", "task-row-id")).toBe("E-1");
    expect(cell("E-1", "task-row-stream")).toBe("#s_eng");
    // No display name on this row, so the worker reads as its id.
    expect(cell("E-1", "task-row-worker")).toBe("eng.coder");
    expect(cell("E-1", "task-row-time")).toMatch(/^6m 4\ds$/);
  });

  it("names a task the shift-coordinator worker holds as the Shift Coordinator's, in its row and its worker group", async () => {
    const snapshot = lab();
    const eng = snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot.boards["s_eng"] : undefined;
    if (eng?.ok === true) eng.value.rows = [...eng.value.rows, row("s_eng", "E-4", "in_progress", "shift-coordinator")];
    await open("/tasks", snapshot);
    const table = await screen.findByTestId("tasks-table");
    const e4 = within(table).getAllByTestId("task-row").find((r) => r.getAttribute("data-task-id") === "E-4")!;
    expect(within(e4).getByTestId("task-row-worker").textContent).toBe("Shift Coordinator");
    act(() => fireEvent.click(screen.getAllByRole("tab").find((t) => t.getAttribute("data-grouping") === "worker")!));
    const group = screen.getAllByTestId("tasks-group").find((g) => g.getAttribute("data-group") === "shift-coordinator")!;
    expect(group.textContent).toMatch(/^Shift Coordinator/);
    expect(screen.getByTestId("tasks-table").textContent).not.toMatch(/chief[ -]of[ -]staff/i);
  });

  it("groups by stream one group per workstream, not per lead, when one worker leads two (BR-40)", async () => {
    const snapshot = lab();
    if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("the fixture loads");
    const session = (id: string, state: Record<string, unknown>) => ({ id, state }) as unknown as (typeof snapshot.sessions)[number];
    snapshot.sessions = [
      session("s_checkout", { workerId: "eng.em", workstreamId: "shared/apollo/checkout" }),
      session("s_search", { workerId: "eng.em", workstreamId: "shared/apollo/search" }),
      session("s_eng", { workerId: "eng.em" }),
    ];
    const ok = (rows: BoardRow[]): Section<ConversationBoards> => ({ ok: true, value: { refs: [rows[0]!.boardRef], rows } });
    snapshot.boards = {
      s_checkout: ok([row("s_checkout", "C-1", "in_progress", "coder")]),
      s_search: ok([row("s_search", "S-1", "in_progress", "coder")]),
      s_eng: ok([row("s_eng", "E-1", "in_progress", "coder")]),
    };
    await open("/tasks?by=stream", snapshot);
    await screen.findByTestId("tasks-table");
    const groups = screen.getAllByTestId("tasks-group");
    expect(groups.map((g) => [g.getAttribute("data-group"), attrs(within(g).getAllByTestId("task-row"), "data-task-id")])).toEqual([
      // The EM's conversation outside any workstream still reads as the EM.
      ["@eng.em", ["E-1"]],
      ["shared/apollo/checkout", ["C-1"]],
      ["shared/apollo/search", ["S-1"]],
    ]);
    const cell = (id: string) => within(screen.getAllByTestId("task-row").find((r) => r.getAttribute("data-task-id") === id)!).getByTestId("task-row-stream").textContent;
    expect([cell("C-1"), cell("S-1"), cell("E-1")]).toEqual(["#shared/apollo/checkout", "#shared/apollo/search", "@eng.em"]);
  });

  it("sums up what is in flight, what waits on you, the shift and the streams", async () => {
    await open("/tasks");
    // What needs you is the Inbox's count: the two tasks held on a question, and the ask.
    expect((await screen.findByTestId("tasks-summary")).textContent).toBe("3 in flight · 3 need you · 3 on shift · 1 stream");
  });
});

describe("the sidebar (V4)", () => {
  it("has Roster under Tasks with its on-shift count, and the footer says the same; nothing reads on call", async () => {
    await open("/inbox");
    const nav = within(screen.getByTestId("sidebar")).getAllByRole("link").map((b) => b.getAttribute("data-testid"));
    expect(nav.indexOf("nav-roster")).toBe(nav.indexOf("nav-tasks") + 1);
    expect(screen.getByTestId("nav-roster-count").textContent).toBe("3");
    expect(screen.getByTestId("footer-on-shift").textContent).toBe("3 on shift");
    expect(screen.queryByTestId("footer-on-call")).toBeNull();
    expect(screen.getByTestId("sidebar").textContent).not.toMatch(/on call/i);
  });

  it("TEAMS is one row per team, General first, with a square per worker and its on-shift count; no worker list", async () => {
    await open("/inbox");
    const teams = screen.getAllByTestId("team");
    expect(attrs(teams, "data-team")).toEqual([GENERAL_TEAM, "eng", "ops"]);
    expect(teams.map((t) => within(t).getByTestId("team-on-shift").textContent)).toEqual(["0/1", "2/2", "1/2"]);
    const eng = teams[1]!;
    expect(within(eng).getAllByTestId("worker").map((w) => [w.getAttribute("data-worker-id"), w.getAttribute("data-status"), w.getAttribute("title")])).toEqual([
      ["eng.coder", "on shift", "eng.coder · on shift"],
      ["eng.reviewer", "on shift", "eng.reviewer · on shift"],
    ]);
    expect(screen.queryByTestId("worker-flow")).toBeNull();
  });

  it("a TEAMS row opens Roster for that team, and is marked current", async () => {
    await open("/inbox");
    act(() => fireEvent.click(screen.getAllByTestId("team")[2]!));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/roster?team=ops");
    expect(attrs(await screen.findAllByTestId("roster-worker"), "data-worker-id")).toEqual(["ops.asker", "ops.idle"]);
    expect(screen.getAllByTestId("team")[2]!.getAttribute("aria-current")).toBe("page");
  });

  it("TEAMS lists the user's own workers from their roster, under the team their id names, as Roster does", async () => {
    rosterRead = async () => [
      { id: "amber-1f2e", flow: "coder", standard: false, description: null },
      { id: "eng.mine", flow: "coder", standard: false, description: null },
      { id: "eng.coder", flow: "coder", standard: true, description: null },
    ];
    await open("/inbox");
    // The inventory alone has no row for either: they show only once the roster read lands.
    await waitFor(() => expect(screen.getByTestId("teams").querySelector('[data-worker-id="amber-1f2e"]')).not.toBeNull());
    const teams = screen.getAllByTestId("team");
    expect(attrs(teams, "data-team")).toEqual([GENERAL_TEAM, "eng", "ops"]);
    expect(attrs(within(teams[0]!).getAllByTestId("worker"), "data-worker-id")).toEqual(["shift-coordinator", "amber-1f2e"]);
    // A standard worker the inventory already has is drawn once.
    expect(attrs(within(teams[1]!).getAllByTestId("worker"), "data-worker-id")).toEqual(["eng.coder", "eng.reviewer", "eng.mine"]);
    expect(teams.map((t) => within(t).getByTestId("team-on-shift").textContent)).toEqual(["0/2", "2/3", "1/2"]);
  });

  it("with the inventory unread, TEAMS still lists the roster's workers beside the failure", async () => {
    rosterRead = async () => [{ id: "amber-1f2e", flow: "coder", standard: false, description: null }];
    await open("/inbox", lab({ inventory: "failed" }));
    const teams = within(screen.getByTestId("teams"));
    await teams.findByTestId("worker");
    expect(attrs(teams.getAllByTestId("worker"), "data-worker-id")).toEqual(["amber-1f2e"]);
    expect(teams.getByTestId("teams-failure").textContent).toContain("inventory offline");
  });

  it("says so under TEAMS when the user's own workers didn't load, and still lists the inventory's teams", async () => {
    rosterRead = async () => {
      throw new Error("roster offline");
    };
    await open("/inbox");
    expect((await screen.findByTestId("teams-own-failure")).textContent).toContain("roster offline");
    expect(attrs(screen.getAllByTestId("team"), "data-team")).toEqual([GENERAL_TEAM, "eng", "ops"]);
  });

  it("Roster and TEAMS share one roster read per snapshot", async () => {
    let reads = 0;
    rosterRead = async () => {
      reads += 1;
      return [{ id: "amber-1f2e", flow: "coder", standard: false, description: null }];
    };
    await open("/roster");
    await within(await screen.findByTestId("roster")).findByTestId("roster-worker-own");
    await waitFor(() => expect(screen.getByTestId("teams").querySelector('[data-worker-id="amber-1f2e"]')).not.toBeNull());
    expect(reads).toBe(1);
  });

  it("BR-20: the counts and the footer carry the partial mark when asks did not load", async () => {
    await open("/inbox", lab({ asks: "failed" }));
    expect(within(screen.getByTestId("nav-roster")).getByTestId("partial-mark")).toBeTruthy();
    expect(within(screen.getByTestId("sidebar-footer")).getByTestId("partial-mark")).toBeTruthy();
  });
});

describe("Jump to (V5)", () => {
  it("BR-17: a worker found in Jump to opens Roster", async () => {
    await open("/inbox");
    act(() => void fireEvent.keyDown(document.body, { key: "k", metaKey: true }));
    act(() => fireEvent.change(screen.getByTestId("jump-input"), { target: { value: "eng.reviewer" } }));
    act(() => fireEvent.click(screen.getAllByTestId("jump-result")[0]!));
    expect(window.location.pathname).toBe("/roster");
  });
});
