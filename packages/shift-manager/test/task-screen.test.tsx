// @vitest-environment happy-dom
/**
 * The task screen against a real Lab, in a DOM (V1 to V5). The run-lab hands
 * rows to scripted runs that hold until stopped; what the screen draws is
 * compared with what the Lab's routes and stores hold.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { GAPS } from "../src/gaps";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createLabClients } from "../src/lib/connection";
import { toBoardRow, type BoardRow } from "../src/lib/reads";
import { openRunLab, RUN_LAB_ASK, RUN_LAB_USER_ID } from "../../../goals/shift-manager/it-shows-and-stops-a-task-run/lab/lab.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

type Opened = Awaited<ReturnType<typeof openRunLab>>;
const served: Array<{ lab: Opened; served: ServedLab }> = [];

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const { lab, served: s } of served.splice(0)) {
    // Stop the held runs, so the server closes without waiting on them.
    await lab.stopHeldRuns();
    await s.handle.close();
  }
});

async function openLab(options: Parameters<typeof openRunLab>[0] = {}) {
  const lab = await openRunLab(options);
  const s = await serveLab(lab.flowState);
  served.push({ lab, served: s });
  const clients = createLabClients({ baseUrl: s.baseUrl, userId: RUN_LAB_USER_ID });
  const runtime = await lab.flowState.getRuntime();
  // The oracle reads the store directly: the page's `fetch` is the DOM's, and
  // is not this test's to share.
  const rows = async (): Promise<BoardRow[]> =>
    Promise.all(
      lab.filed.map(async (f) => {
        const stored = (await runtime.stores.resourceState.get("org", DEFAULT_ORG_ID, `${lab.ledger.id}/${f.taskId}`))?.state;
        return toBoardRow(lab.ledger.id, lab.mailbox.id, f.taskId, stored);
      }),
    );
  return { lab, served: s, clients, rows };
}

async function renderAt(baseUrl: string, path: string, devtoolUrl?: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${baseUrl}${path}`);
  const clients = createLabClients({ userId: RUN_LAB_USER_ID });
  render(<App clients={clients} {...(devtoolUrl === undefined ? {} : { devtoolUrl })} />);
  await screen.findByTestId("shell");
}

/** A held row on the drainer's flow (or on a flow of its own), once its run is linked. */
async function heldRow(opened: Awaited<ReturnType<typeof openLab>>, own: boolean): Promise<BoardRow> {
  const seat = opened.lab.seats.find((s) => (own ? s.flow !== undefined : s.flow === undefined && s.policy === "per-task"))!;
  const filed = opened.lab.filed.find((f) => f.kind === "held" && f.seatId === seat.id)!;
  return eventually(async () => (await opened.rows()).find((r) => r.id === filed.taskId && r.run !== null), "the held run's link");
}

const itemIds = () => screen.queryAllByTestId("session-item").map((el) => el.getAttribute("data-item-id"));

describe("opening a task from Tasks (BR-1, BR-5, BR-6)", () => {
  it("clicks through to the run the row names and draws its steps live, in order", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, false);
    await renderAt(opened.served.baseUrl, "/tasks");
    const tasks = await screen.findByTestId("tasks-table");
    fireEvent.click(within(tasks).getAllByTestId("task-row").find((el) => el.getAttribute("data-task-id") === row.id)!);
    const session = await screen.findByTestId("session", {}, { timeout: 10_000 });
    expect(session.getAttribute("data-session-id")).toBe(row.run!.sessionId);
    expect(session.getAttribute("data-request-id")).toBe(row.run!.requestId);
    expect(window.location.pathname).toBe(`/tasks/${row.boardRef}/${row.id}/session`);
    // A new step arrives with no reload.
    await waitFor(() => expect(itemIds().length).toBeGreaterThan(0), { timeout: 5_000 });
    const before = itemIds().length;
    await waitFor(() => expect(itemIds().length).toBeGreaterThan(before), { timeout: 4_000 });
    expect(new Set(itemIds()).size).toBe(itemIds().length);
    expect(screen.queryByTestId("session-shared")).toBeNull();
  }, 30_000);
});

describe("Interrupt (BR-11, BR-13, BR-14)", () => {
  it("shows interrupted only after the request record reads aborted, and writes nothing to the row", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, true);
    const runtime = await opened.lab.flowState.getRuntime();
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    const button = await screen.findByTestId("task-interrupt");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    expect(screen.getByTestId("run-state").getAttribute("data-state")).toBe("in_progress");
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId("run-state").getAttribute("data-state")).toBe("aborted"), { timeout: 10_000 });
    const record = (await runtime.stores.request.get(row.run!.requestId)) as { status: string };
    expect(record.status).toBe("aborted");
    expect(screen.getByTestId("run-state").textContent).toBe("interrupted");
    // The link still names the stopped run: Shift Manager wrote nothing to the row.
    expect((await opened.rows()).find((r) => r.id === row.id)!.run).toEqual(row.run);
  }, 30_000);

  it("a refused abort shows by the button and the run is still drawn running", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, false);
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/abort")) return Promise.resolve(new Response(JSON.stringify({ error: "not yours" }), { status: 403 }));
      return real(input, init);
    });
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    const button = await screen.findByTestId("task-interrupt");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    fireEvent.click(button);
    expect((await screen.findByTestId("interrupt-error")).textContent).toMatch(/403/);
    expect(screen.getByTestId("run-state").getAttribute("data-state")).toBe("in_progress");
  }, 30_000);
});

describe("Esc interrupts wherever the activity line says so", () => {
  it("stops the run from the composer and from a tab with no Session mounted", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, true);
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/brief`);
    await waitFor(() => expect(screen.getByTestId("run-state").getAttribute("data-state")).toBe("in_progress"), { timeout: 10_000 });
    expect(screen.getByTestId("task-activity").textContent).toContain("esc to interrupt");
    expect(screen.queryByTestId("task-session")).toBeNull();
    const composer = screen.getByTestId("task-composer-input");
    fireEvent.keyDown(composer, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("run-state").getAttribute("data-state")).toBe("aborted"), { timeout: 10_000 });
  }, 30_000);
});

describe("a row with no run (BR-3)", () => {
  it("says no run has started, disables Interrupt, and does not re-read a row that isn't running", async () => {
    const opened = await openLab();
    const waiting = opened.lab.filed.find((f) => f.kind === "waiting")!;
    const seen: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      seen.push(new URL(String(input instanceof Request ? input.url : input), window.location.href).pathname);
      return real(input, init);
    });
    await renderAt(opened.served.baseUrl, `/tasks/${opened.lab.ledger.id}/${waiting.taskId}/session`);
    await screen.findByTestId("session-no-run");
    expect((screen.getByTestId("task-interrupt") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("run-state").textContent).toBe("nothing is running");
    const reads = () => seen.filter((p) => p.endsWith(`/resources/${opened.lab.ledger.id}`)).length;
    const after = reads();
    await act(() => new Promise((r) => setTimeout(r, 2_500)));
    expect(reads()).toBe(after);
  }, 30_000);

  it("re-reads an in-progress row with no link every 2 s, and opens its run once the link arrives, with no reload", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, false);
    // The board answers without this row's link for its first reads, as it
    // does between the claim and the run's start.
    let hidden = 2;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const response = await real(input, init);
      if (!url.includes(`/resources/${opened.lab.ledger.id}`) || hidden <= 0) return response;
      hidden -= 1;
      const body = (await response.json()) as { items: Array<{ clientData: Record<string, unknown> }> };
      for (const item of body.items) if (item.clientData.id === row.id) delete item.clientData.run;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    expect((await screen.findByTestId("session-no-run")).textContent).toMatch(/checks again every 2 seconds/);
    const session = await screen.findByTestId("session", {}, { timeout: 8_000 });
    expect(session.getAttribute("data-request-id")).toBe(row.run!.requestId);
    expect(hidden).toBe(0);
  }, 30_000);

  it("names a board the Lab doesn't attach (BR-2)", async () => {
    const opened = await openLab();
    await renderAt(opened.served.baseUrl, "/tasks/nowhere.none/t1/session");
    expect((await screen.findByTestId("task-missing")).textContent).toMatch(/nowhere\.none/);
  }, 30_000);
});

/** Rewrite one collection's rows as the page reads them, through `edit`, leaving every other read alone. */
function rewriteRows(match: (url: string) => boolean, edit: (rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const response = await real(input, init);
    if (!match(url) || !response.ok) return response;
    const body = (await response.json()) as { items: Array<{ clientData: Record<string, unknown> }> };
    const edited = edit(body.items.map((i) => i.clientData));
    body.items = edited.map((clientData, n) => ({ ...(body.items[n] ?? body.items[0]!), clientData }));
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

/** A per-worker row once it has finished, with its run linked. */
async function finishedRow(opened: Awaited<ReturnType<typeof openLab>>): Promise<BoardRow> {
  const short = opened.lab.filed.find((f) => f.kind === "short")!;
  return eventually(async () => (await opened.rows()).find((r) => r.id === short.taskId && r.status === "completed" && r.run !== null), "a finished row", 20_000);
}

describe("following the row as the board moves it", () => {
  it("follows the task onto its next attempt when the board links a new run, with no reload", async () => {
    const opened = await openLab();
    const first = await finishedRow(opened);
    const next = await heldRow(opened, false);
    // The board hands the task on: queued again with its settled run still
    // linked, then claimed with a new run. The screen must move to that run.
    let boardReads = 0;
    rewriteRows(
      (url) => url.includes(`/resources/${opened.lab.ledger.id}`),
      (rows) => {
        boardReads += 1;
        return rows.map((r) =>
          r.id !== first.id ? r : boardReads < 3 ? { ...r, status: "pending" } : { ...r, status: "in_progress", run: next.run },
        );
      },
    );
    await renderAt(opened.served.baseUrl, `/tasks/${first.boardRef}/${first.id}/session`);
    expect((await screen.findByTestId("session", {}, { timeout: 10_000 })).getAttribute("data-request-id")).toBe(first.run!.requestId);
    await waitFor(() => expect(screen.getByTestId("session").getAttribute("data-request-id")).toBe(next.run!.requestId), { timeout: 12_000 });
  }, 40_000);

  it("shows a failed board read with a Retry that reads the board, never as a missing task", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, false);
    let failing = true;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (failing && url.includes(`/resources/${opened.lab.ledger.id}`)) {
        return new Response(JSON.stringify({ error: "board store unavailable" }), { status: 503 });
      }
      return real(input, init);
    });
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    const failure = await screen.findByTestId("task-board-failure");
    expect(failure.textContent).toMatch(/board store unavailable/);
    expect(screen.queryByTestId("task-missing")).toBeNull();
    failing = false;
    fireEvent.click(within(failure).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("task-title").textContent).toBe(row.title));
    expect(screen.queryByTestId("task-board-failure")).toBeNull();
  }, 30_000);

  it("Retry after a failed read on settling reads the board again and clears the failure", async () => {
    const opened = await openLab();
    const row = await finishedRow(opened);
    // The first read (the page's own) lands; the read taken when the run
    // settles fails; the next one lands with the row as the board holds it now.
    let boardReads = 0;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes(`/resources/${opened.lab.ledger.id}`)) return real(input, init);
      boardReads += 1;
      if (boardReads === 2) return new Response(JSON.stringify({ error: "board store unavailable" }), { status: 503 });
      const response = await real(input, init);
      if (boardReads < 3) return response;
      const body = (await response.json()) as { items: Array<{ clientData: Record<string, unknown> }> };
      for (const item of body.items) if (item.clientData.id === row.id) item.clientData.title = "Renamed after it settled";
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    const failure = await screen.findByTestId("task-board-failure", {}, { timeout: 10_000 });
    fireEvent.click(within(failure).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("task-title").textContent).toBe("Renamed after it settled"));
    expect(screen.queryByTestId("task-board-failure")).toBeNull();
  }, 30_000);
});

describe("what the Session draws of the run's items", () => {
  it("draws what the item renderers draw: a sub-agent's working steps stay out, a keyed snapshot shows once", async () => {
    const opened = await openLab();
    const row = await finishedRow(opened);
    // A sub-agent's message is stored in the session and stamped with the task,
    // but it is working, not history: a chat drawn by the item renderers leaves
    // it out, and so must the Session.
    const working = {
      id: "item_message_subagent_working",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "text", text: "sub-agent scratch" }],
      requestId: row.run!.requestId,
      itemIndex: 1,
      ts: 1,
      taskId: row.id,
      itemVisibility: { client: true, history: false },
    };
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const response = await real(input, init);
      if (!url.includes(`/sessions/${encodeURIComponent(row.run!.sessionId)}/state`) || !response.ok) return response;
      const body = (await response.json()) as { items?: unknown[] };
      body.items?.push(working);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    await screen.findByTestId("session", {}, { timeout: 10_000 });
    await waitFor(() => expect(itemIds()).toContain("item_component_keyed:progress"));
    expect(itemIds()).not.toContain(working.id);
    // The run wrote its progress snapshot twice; it shows once, at its latest.
    expect(itemIds().filter((id) => id === "item_component_keyed:progress")).toHaveLength(1);
  }, 30_000);
});

describe("the Session draws with Shift Manager's registry copies (ER-6)", () => {
  it("draws a run's message, reasoning and tool call with the registry's cards, not the bare fallbacks", async () => {
    const opened = await openLab();
    const row = await finishedRow(opened);
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    await screen.findByTestId("session", {}, { timeout: 10_000 });
    const drawn = (type: string) =>
      screen.queryAllByTestId("session-item").filter((el) => el.getAttribute("data-item-type") === type);
    await waitFor(() => expect(drawn("tool_output").length).toBeGreaterThan(0), { timeout: 5_000 });
    // The registry's message card, and the collapsible reasoning and tool cards.
    expect(drawn("message").every((li) => li.querySelector("[data-testid=message]") !== null)).toBe(true);
    for (const type of ["reasoning", "tool_output"]) {
      expect(drawn(type).length, type).toBeGreaterThan(0);
      expect(drawn(type).every((li) => li.querySelector("[data-slot=collapsible]") !== null), type).toBe(true);
    }
  }, 30_000);
});

describe("the header's worker", () => {
  it("resolves a name two teams share to the seat in this row's mailbox, as the inspector does", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, false);
    const seat = opened.lab.seats.find((s) => s.flow === undefined && s.policy === "per-task")!;
    // Another team's seat with the same short name, listed first.
    rewriteRows(
      (url) => url.includes("/resources/") && !url.includes(opened.lab.ledger.id),
      (rows) => {
        const mine = rows.find((r) => r.id === seat.id);
        return mine === undefined ? rows : [{ ...mine, id: `zz.${seat.name}` }, ...rows];
      },
    );
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    await waitFor(() => expect(screen.getByTestId("inspector-worker-id").getAttribute("data-seat-id")).toBe(seat.id));
    expect(screen.getByTestId("task-status").textContent).toContain(seat.id);
    expect(screen.getByTestId("task-status").textContent).not.toContain(`zz.${seat.name}`);
  }, 30_000);
});

describe("the disabled acts and empty tabs carry their gap lines (BR-15 to BR-17, BR-24)", () => {
  it("every disabled control and empty tab names what arrives", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, false);
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/diff`);
    expect((await screen.findByTestId("task-diff-empty")).textContent).toContain(GAPS.task.diff.body);
    for (const el of screen.getAllByTestId("task-disabled-action")) {
      expect((el as HTMLButtonElement).disabled).toBe(true);
      expect(el.getAttribute("data-gap")).toBe(GAPS.task.handOff);
    }
    // This Lab's kinds declare no door, so the composer says the worker takes
    // no message, once it has read the run (BR-18).
    expect((screen.getByTestId("task-composer-input") as HTMLTextAreaElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId("task-composer-blocked").textContent).toContain(GAPS.turn.noDoor));
    expect((screen.getByTestId("task-also-post") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "checks" }));
    expect((await screen.findByTestId("task-checks-empty")).textContent).toContain(GAPS.task.checks.body);
    fireEvent.click(screen.getByRole("tab", { name: "brief" }));
    expect((await screen.findByTestId("brief-goal")).textContent).toBe(row.goal);
    expect(screen.getByTestId("brief-acceptance-gap").textContent).toBe(GAPS.task.acceptance);
    // Every gap line in the task registry names an owner, or says it is not
    // planned in the first cut. Read off the registry, so a line added there is
    // held to it too; the two tab titles are headings, not gap lines.
    const lines = Object.entries(GAPS.task).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [[`${key}.body`, value.body]],
    );
    expect(lines.length).toBeGreaterThan(8);
    for (const [key, text] of lines) expect(text, key).toMatch(/FIX-\d+|not planned in the first cut/);
  }, 30_000);
});

describe("the inspector (BR-18 to BR-23)", () => {
  it("shows the worker, started, the harness gap, what a recording run recorded, and the trace link with the session beside it", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, true);
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`, "http://127.0.0.1:4000");
    const inspector = await screen.findByTestId("task-inspector");
    const seat = opened.lab.seats.find((s) => s.flow !== undefined)!;
    expect(within(inspector).getByTestId("inspector-worker-id").getAttribute("data-seat-id")).toBe(seat.id);
    expect(within(inspector).getByTestId("inspector-started-at").getAttribute("data-started-at")).toBe(String(row.startedAt));
    expect(within(inspector).getByTestId("inspector-harness-gap").textContent).toBe(GAPS.task.harness);
    const files = await within(inspector).findAllByTestId("inspector-file", {}, { timeout: 10_000 });
    expect(files.map((f) => [f.getAttribute("data-path"), f.getAttribute("data-kind")])).toEqual([["notes/audit.md", "created"]]);
    expect(within(inspector).getAllByTestId("inspector-plan-step").map((s) => s.getAttribute("data-status"))).toEqual(["completed", "in_progress"]);
    // The link opens this run's session in the devtool: no paste step (FIX-1691).
    expect(within(inspector).getByTestId("inspector-trace-link").getAttribute("href")).toBe(
      `http://127.0.0.1:4000/?session=${encodeURIComponent(row.run!.sessionId)}`,
    );
    expect(within(inspector).getByTestId("inspector-trace-session").textContent).toBe(row.run!.sessionId);
  }, 30_000);

  it("links the rows a task waits on and the rows waiting on it, from the one board read (BR-22)", async () => {
    const opened = await openLab();
    const held = await heldRow(opened, false);
    const waiting = opened.lab.filed.find((f) => f.kind === "waiting")!;
    // This board's filing action takes no dependencies, so the read is given one.
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const response = await real(input, init);
      if (!url.includes(`/resources/${opened.lab.ledger.id}`)) return response;
      const body = (await response.json()) as { items: Array<{ clientData: Record<string, unknown> }> };
      for (const item of body.items) if (item.clientData.id === waiting.taskId) item.clientData.deps = [held.id];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await renderAt(opened.served.baseUrl, `/tasks/${held.boardRef}/${waiting.taskId}/brief`);
    const after = await screen.findByTestId("inspector-after");
    expect(within(after).getAllByRole("listitem").map((li) => li.getAttribute("data-task-id"))).toEqual([held.id]);
    fireEvent.click(within(after).getByRole("button"));
    await waitFor(() => expect(window.location.pathname).toBe(`/tasks/${held.boardRef}/${held.id}/session`));
    const blocks = await screen.findByTestId("inspector-blocks");
    expect(within(blocks).getAllByRole("listitem").map((li) => li.getAttribute("data-task-id"))).toEqual([waiting.taskId]);
  }, 30_000);

  it("says a harness that records nothing records none, and turns the trace link off with no devtool", async () => {
    const opened = await openLab();
    const row = await heldRow(opened, false);
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/brief`);
    const inspector = await screen.findByTestId("task-inspector");
    expect((await within(inspector).findByTestId("inspector-plan-none", {}, { timeout: 10_000 })).textContent).toBe(GAPS.task.recordsNoPlan);
    expect(within(inspector).getByTestId("inspector-files-none").textContent).toBe(GAPS.task.recordsNoFiles);
    // It names what to install, and no flag the command doesn't have.
    const off = within(inspector).getByTestId("inspector-trace-off").textContent;
    expect(off).toMatch(/@flow-state-dev\/devtool/);
    expect(off).not.toMatch(/--devtool/);
    // Brief open: no run stream was mounted.
    expect(screen.queryByTestId("session")).toBeNull();
  }, 30_000);
});

describe("a task whose run waits on a person (BR-17)", () => {
  it("draws the ask inline in the Session, on the highlighter in the activity line and the inspector, and no Inbox detour", async () => {
    const opened = await openLab({ asking: true });
    const filed = opened.lab.filed.find((f) => f.kind === "asking")!;
    const row = await eventually(async () => (await opened.rows()).find((r) => r.id === filed.taskId && r.run !== null), "the asking run's link");
    // Render once the run has stopped to ask, so the first read holds the ask.
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(opened.served.baseUrl);
    await eventually(async () => {
      const state = await opened.clients.sessions.getSessionState(row.run!.sessionId, { includeItems: true, itemTypes: ["suspension"] });
      return (state.items ?? []).length > 0 ? true : undefined;
    }, "the run's ask");
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);

    const ask = await screen.findByTestId("session-ask", {}, { timeout: 10_000 });
    // Its kind on the highlighter, and the one ask card Inbox draws.
    expect(within(ask).getByText("APPROVAL").getAttribute("data-look")).toBe("ask-kind");
    expect(within(ask).getByTestId("ask-card").textContent).toContain(RUN_LAB_ASK);
    expect(screen.queryByText("Waiting on you: answer it in Inbox")).toBeNull();
    // The activity line's mark is the needs square; the inspector says what waits, and links to it in Inbox.
    expect(within(screen.getByTestId("task-activity")).getByText("", { selector: "[data-state-square]" }).getAttribute("data-state-square")).toBe("needs");
    const banner = screen.getByTestId("inspector-needs");
    expect(banner.textContent).toMatch(/^approval waiting \d+[smhd]inbox ↗$/);
    expect(banner.getAttribute("data-suspension-id")).toBe(ask.getAttribute("data-suspension-id"));
  });

  it("draws the ask as soon as an open task's run stops to ask, with no reload", async () => {
    const opened = await openLab({ asking: true, holdAsk: true });
    const filed = opened.lab.filed.find((f) => f.kind === "asking")!;
    const row = await eventually(async () => (await opened.rows()).find((r) => r.id === filed.taskId && r.run !== null), "the asking run's link");
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    // Open, and the Lab read, while the run is still running and asks nothing.
    await waitFor(() => expect(screen.getByTestId("run-state").getAttribute("data-state")).toBe("in_progress"), { timeout: 10_000 });
    await screen.findByTestId("session");
    expect(screen.queryByTestId("session-ask")).toBeNull();
    expect(screen.queryByTestId("inspector-needs")).toBeNull();

    opened.lab.releaseAsk();
    const ask = await screen.findByTestId("session-ask", {}, { timeout: 10_000 });
    expect(within(ask).getByTestId("ask-card").textContent).toContain(RUN_LAB_ASK);
    expect(screen.queryByText("Answer it in Inbox")).toBeNull();
    expect(within(screen.getByTestId("task-activity")).getByText("", { selector: "[data-state-square]" }).getAttribute("data-state-square")).toBe("needs");
    expect(screen.getByTestId("inspector-needs").getAttribute("data-suspension-id")).toBe(ask.getAttribute("data-suspension-id"));
  }, 30_000);

  it("marks nothing as waiting on a task whose run asks nothing", async () => {
    const opened = await openLab({ asking: true });
    const row = await heldRow(opened, true);
    await renderAt(opened.served.baseUrl, `/tasks/${row.boardRef}/${row.id}/session`);
    await waitFor(() => expect(screen.getByTestId("run-state").getAttribute("data-state")).toBe("in_progress"));
    expect(screen.queryByTestId("session-ask")).toBeNull();
    expect(screen.queryByTestId("inspector-needs")).toBeNull();
    expect(within(screen.getByTestId("task-activity")).getByText("", { selector: "[data-state-square]" }).getAttribute("data-state-square")).toBe("run");
  });
});
