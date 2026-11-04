// @vitest-environment happy-dom
/**
 * An opened task's action row (FIX-2382), on fixtures: the tasks pane's sheet
 * and a thread's view draw the registry's `task-actions` row by the task's
 * board status. The sheet has no composer, so it carries the Steer box; a
 * thread's view steers through its own composer, so its row has none. A
 * failed task shows its error as an error. The goal check proves the board's
 * rows change at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFakeLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
});

const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
const row = (title: string) => within(pane()).getByRole("button", { name: new RegExp(title), hidden: true });
const sheet = (title: string) => screen.getByRole("dialog", { name: `Work: ${title}` });

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session");
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

// A session-mode session on a project with the vendor script's two tasks, one done and one running.
async function vendorSession() {
  render(<App adapter={createFakeLab({ speed: 0.01 })} />);
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }));
  await ask("Compare Acme and Globex for us.");
  await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"));
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
    await within(work).findByText("Sent to the task.");
    expect(within(work).getByText("Check the EU pricing too.")).toBeTruthy();
  });

  it("cancels once confirmed, then offers Retry, which runs the same task again", async () => {
    await vendorSession();
    fireEvent.click(row("Research Globex"));
    fireEvent.click(within(sheet("Research Globex")).getByRole("button", { name: "Cancel" }));
    expect(row("Research Globex").dataset.taskStatus).toBe("in_progress");
    fireEvent.click(within(sheet("Research Globex")).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("cancelled"));
    const retry = await within(sheet("Research Globex")).findByRole("button", { name: "Retry" });
    expect(within(sheet("Research Globex")).queryByRole("textbox", { name: "Steer this task" })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("in_progress"));
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
  // The older threads-mode session: a running thread and a failed one.
  async function billingTriage(title: string) {
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Sessions" })).getByRole("button", { name: /Billing triage/ }));
    const board = screen.getByRole("complementary", { name: "Tasks" });
    fireEvent.click(await within(board).findByRole("button", { name: new RegExp(title) }));
    return screen.getByRole("complementary", { name: `Task: ${title}` });
  }

  it("offers Cancel on a running thread with no Steer box: its composer steers", async () => {
    const view = await billingTriage("Weekly uptime digest");
    const actions = within(view).getByTestId("task-action-row");
    expect(within(actions).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(view).queryByRole("textbox", { name: "Steer this task" })).toBeNull();
    expect(within(view).getByLabelText("Message this task")).toBeTruthy();
  });

  it("offers Retry on a failed thread, shows its error as an error, and no longer sends you to the main session", async () => {
    const view = await billingTriage("Export failed invoices");
    expect(within(within(view).getByTestId("task-action-row")).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(within(view).getByRole("alert").textContent).toContain("The export timed out after 30s.");
    expect(within(view).queryByText(/ask the main session/)).toBeNull();
    fireEvent.click(within(view).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(view).getByTestId("task-action-row").dataset.status).toBe("in_progress"));
  });
});

describe("a failed task's sheet", () => {
  it("shows its error as an error, beside Retry", async () => {
    // Session mode's fixtures have no failed task: a failed Globex run, as the board would keep it.
    const lab = createFakeLab({ speed: 0.01 });
    render(<App adapter={lab} />);
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }));
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("in_progress"));
    lab.fail("Research Globex", "The pricing page answered 503.");
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("errored"));
    const done = within(pane()).getByText(/Done · /).closest("details")!;
    done.open = true;
    fireEvent.click(row("Research Globex"));
    const work = sheet("Research Globex");
    expect(within(work).getByRole("alert").textContent).toContain("The pricing page answered 503.");
    expect(within(work).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
