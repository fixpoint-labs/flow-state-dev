// @vitest-environment happy-dom
/**
 * An opened task's action row, on the lab's own host: the tasks pane's sheet
 * and a thread's view draw the registry's `task-actions` row by the task's
 * board status. The sheet has no composer, so it carries the Steer box; a
 * thread's view steers through its own composer, so its row has none. A
 * failed task shows its error as an error. The goal check proves the board's
 * rows change at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { closeApps, openTestApp, readUntil, vendorScripts, type TestApp, type VendorControl } from "./app-host";

afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  await closeApps();
});

const SLOW = { timeout: 15_000 };

/** The app on the lab's own host with the vendor scripts; their control. */
let lab: TestApp;
async function vendorApp(): Promise<VendorControl> {
  const { scripts, control } = vendorScripts();
  lab = await openTestApp({ scripts });
  render(lab.wrap(<App />));
  return control;
}

/** Whether every request of every session of the lab's has ended. */
async function nothingRunning(): Promise<boolean> {
  for (const session of await lab.client.sessions.list()) {
    if ((await lab.client.sessions.requests(session.id, { status: "in_progress", limit: 5 })).length > 0) return false;
  }
  return true;
}

const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
const row = (title: string) => within(pane()).getByRole("button", { name: new RegExp(title), hidden: true });
const sheet = (title: string) => screen.getByRole("dialog", { name: `Work: ${title}` });

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session", undefined, SLOW);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

// A session-mode session on a project with the vendor script's two tasks, one done and one running.
async function vendorSession(): Promise<VendorControl> {
  const control = await vendorApp();
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }, SLOW));
  await ask("Compare Acme and Globex for us.");
  await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"), SLOW);
  await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("in_progress"), SLOW);
  return control;
}

describe("the tasks pane's sheet", () => {
  it("offers Cancel and a Steer box on a running task, and no Retry; the read-only note is gone", async () => {
    await vendorSession();
    fireEvent.click(row("Research Globex"));
    const work = sheet("Research Globex");
    const actions = within(work).getByTestId("task-action-row");
    expect(actions.dataset.status).toBe("in_progress");
    expect(within(actions).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(actions).getByRole("textbox", { name: "Steer this task" })).toBeTruthy();
    expect(within(actions).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/ask the main session/)).toBeNull();
  });

  it("sends a steer to the running task, which its work shows", async () => {
    await vendorSession();
    fireEvent.click(row("Research Globex"));
    const work = sheet("Research Globex");
    fireEvent.change(within(work).getByRole("textbox", { name: "Steer this task" }), { target: { value: "Check the EU pricing too." } });
    fireEvent.click(within(work).getByRole("button", { name: "Steer" }));
    await within(work).findByText("Sent to the task.", undefined, SLOW);
  });

  it("cancels once confirmed, then offers Retry, which runs the same task again", async () => {
    const control = await vendorSession();
    fireEvent.click(row("Research Globex"));
    fireEvent.click(within(sheet("Research Globex")).getByRole("button", { name: "Cancel" }));
    expect(row("Research Globex").dataset.taskStatus).toBe("in_progress");
    fireEvent.click(within(sheet("Research Globex")).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("cancelled"), SLOW);
    const retry = await within(sheet("Research Globex")).findByRole("button", { name: "Retry" }, SLOW);
    expect(within(sheet("Research Globex")).queryByRole("textbox", { name: "Steer this task" })).toBeNull();
    // The row can read cancelled before the Cancel press has its answer; until then the press holds
    // every button, Retry included, and a click on it sends nothing. A person waits for the outcome.
    await within(sheet("Research Globex")).findByText("Cancelled.", undefined, SLOW);
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    // Once the cancelled run's turn has ended (a scripted turn doesn't hear the cancel): a retry
    // that lands while it still runs is a race of the board's own, not the screen's.
    control.releaseGlobex();
    await waitFor(() => expect(control.globexRunning()).toBe(0), SLOW);
    await readUntil(nothingRunning, (idle) => idle);
    fireEvent.click(retry);
    // It runs again: the research, released, finishes this time.
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).not.toBe("cancelled"), SLOW);
  });

  it("starts the row afresh when another task is opened, so a draft or a confirm never moves to it", async () => {
    await vendorSession();
    fireEvent.click(row("Research Globex"));
    fireEvent.change(within(sheet("Research Globex")).getByRole("textbox", { name: "Steer this task" }), { target: { value: "Meant for Globex." } });
    fireEvent.click(row("Research Acme"));
    await screen.findByRole("dialog", { name: "Work: Research Acme" });
    fireEvent.click(row("Research Globex"));
    const box = within(sheet("Research Globex")).getByRole("textbox", { name: "Steer this task" }) as HTMLTextAreaElement | HTMLInputElement;
    expect(box.value).toBe("");
  });

  it("offers no action on a completed task", async () => {
    await vendorSession();
    const done = within(pane()).getByText(/Done · 1/).closest("details")!;
    done.open = true;
    fireEvent.click(row("Research Acme"));
    expect(within(sheet("Research Acme")).queryByTestId("task-action-row")).toBeNull();
  });
});

describe("a thread's view", () => {
  // A threads-mode session with a running thread and a failed one.
  async function billingTriage(title: string) {
    const control = await vendorApp();
    fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }, SLOW));
    await ask("Triage the billing exports.");
    const board = await screen.findByRole("complementary", { name: "Tasks" }, SLOW);
    await waitFor(() => expect(within(board).getByRole("button", { name: /Export failed invoices/ })).toBeTruthy(), SLOW);
    // The failed one is listed failed, with its error read.
    await waitFor(() => expect(board.querySelector('[data-column="waiting"]')?.textContent ?? "").toContain("Export failed invoices"), SLOW);
    fireEvent.click(within(board).getByRole("button", { name: new RegExp(title) }));
    const view = screen.getByRole("dialog", { name: `Task: ${title}` });
    await within(view).findByTestId("task-action-row", undefined, SLOW);
    return { view, control };
  }

  it("offers Cancel on a running thread with no Steer box: its composer steers", async () => {
    const { view } = await billingTriage("Weekly uptime digest");
    const actions = within(view).getByTestId("task-action-row");
    expect(within(actions).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(view).queryByRole("textbox", { name: "Steer this task" })).toBeNull();
    expect(within(view).getByLabelText("Message this task")).toBeTruthy();
  });

  it("offers Retry on a failed thread, shows its error as an error, and no longer sends you to the main session", async () => {
    const { view, control } = await billingTriage("Export failed invoices");
    await waitFor(() => expect(within(within(view).getByTestId("task-action-row")).getByRole("button", { name: "Retry" })).toBeTruthy(), SLOW);
    expect(within(view).getByRole("alert").textContent).toContain("The export timed out after 30s.");
    // The alert says why it failed, once: no status line repeats it under the alert.
    expect(within(view).queryByText(/^Failed · /)).toBeNull();
    expect(within(view).queryByText(/ask the main session/)).toBeNull();
    control.fixExports();
    fireEvent.click(within(view).getByRole("button", { name: "Retry" }));
    // Run again, and this time it works.
    await waitFor(() => expect(within(view).queryByTestId("task-action-row")?.dataset.status ?? "completed").not.toBe("errored"), SLOW);
  });
});

describe("a failed task's sheet", () => {
  it("shows its error as an error, beside Retry", async () => {
    // Globex's research fails while it runs.
    const control = await vendorSession();
    control.failGlobex("The pricing page answered 503.");
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("errored"), SLOW);
    const done = within(pane()).getByText(/Done · /).closest("details")!;
    done.open = true;
    fireEvent.click(row("Research Globex"));
    const work = sheet("Research Globex");
    await waitFor(() => expect(within(work).getByRole("alert").textContent).toContain("The pricing page answered 503."), SLOW);
    expect(within(work).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
