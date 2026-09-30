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
import { openRunLab, RUN_LAB_USER_ID } from "../../../goals/app-lab/it-shows-and-stops-a-task-run/lab/lab.mts";
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

async function openLab() {
  const lab = await openRunLab();
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
        return toBoardRow(lab.ledger.id, lab.channel.id, f.taskId, stored);
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
    // The link still names the stopped run: App Lab wrote nothing to the row.
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
    expect((screen.getByTestId("task-composer-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId("task-composer-gap").textContent).toBe(GAPS.task.composer);
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
    expect(within(inspector).getByTestId("inspector-trace-link").getAttribute("href")).toBe("http://127.0.0.1:4000");
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
    expect(within(inspector).getByTestId("inspector-trace-off").textContent).toMatch(/--devtool/);
    // Brief open: no run stream was mounted.
    expect(screen.queryByTestId("session")).toBeNull();
  }, 30_000);
});
