// @vitest-environment happy-dom
/**
 * A coding task's popup is where you stop, steer and re-run it, with no model
 * turn in between. Its buttons follow the row's board status: Cancel and a
 * Steer box while it runs, Retry and one Re-run per other harness once it
 * failed or was cancelled. A failed task's reason shows as an error, never in
 * the Result box. Without these, the only way to stop a run going wrong, or
 * to try a failed task on another harness, is to type it to Lead
 * and hope its turn does what you meant.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardTask } from "../src/adapter";
import { App } from "../src/App";
import { createFixtureLab, type FixtureLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const TASK = "Coding task: Fix the typo in the README's first line";
const LEAD_CONVERSATION = "conversation:teammates.lead";

/** Ask Lead to have `agent` fix the typo, then open the task's popup from its line. */
async function openCodingTask(agent: string) {
  const box = await screen.findByLabelText("Message Lead");
  await act(async () => {
    fireEvent.change(box, { target: { value: `Have ${agent} fix the typo in the README's first line.` } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  const conversation = screen.getByRole("main", { name: "Conversation" });
  fireEvent.click(await within(conversation).findByRole("button", { name: new RegExp(`^${TASK}, on ${agent}`) }, { timeout: 3000 }));
  return screen.findByRole("dialog", { name: TASK });
}

const buttons = (popup: HTMLElement) =>
  [...popup.querySelectorAll<HTMLElement>('[data-testid="task-action-row"] button')].map((b) => b.textContent ?? "");

/** Lead's conversation's rows, as the adapter reads them. */
function rowsOf(lab: FixtureLab): BoardTask[] {
  let rows: BoardTask[] = [];
  lab.watchTasks(LEAD_CONVERSATION, (tasks) => (rows = tasks))();
  return rows;
}

describe("a coding task's popup has its buttons", () => {
  it("while it runs: Cancel and Steer; once cancelled: Retry and a Re-run on each other harness, never its own", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.3, asks: true })} />);
    const popup = await openCodingTask("Cursor");
    await waitFor(() => expect(buttons(popup)).toEqual(["Cancel", "Steer"]), { timeout: 2000 });

    // Steer: the line reaches the run, which shows it as given to it.
    fireEvent.change(within(popup).getByLabelText("Steer this task"), { target: { value: "Keep the old wording." } });
    fireEvent.click(within(popup).getByRole("button", { name: "Steer" }));
    expect((await within(popup).findByTestId("task-action-outcome")).textContent).toBe("Sent to the task.");
    await waitFor(() => expect(popup.textContent).toMatch(/Keep the old wording\./));

    // Cancel asks once, then the row reads cancelled, and the buttons follow it.
    fireEvent.click(within(popup).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(popup).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(popup.querySelector("[data-overlay-status]")?.textContent).toBe("cancelled"));
    expect(buttons(popup)).toEqual(["Retry", "Re-run on Claude Code", "Re-run on Codex"]);
  });

  it("starts the row afresh when the popup moves to another task, so a draft never carries to it", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.3, asks: true })} />);
    const cursor = await openCodingTask("Cursor");
    fireEvent.click(within(cursor).getByRole("button", { name: "Close" }));
    const codex = await openCodingTask("Codex");
    await waitFor(() => expect(buttons(codex)).toEqual(["Cancel", "Steer"]), { timeout: 2000 });
    fireEvent.change(within(codex).getByLabelText("Steer this task"), { target: { value: "Meant for Codex." } });

    // The conversation's other task opens in the same popup, which keeps no draft of the first.
    const conversation = screen.getByRole("main", { name: "Conversation" });
    fireEvent.click(within(conversation).getByRole("button", { name: new RegExp(`^${TASK}, on Cursor`) }));
    await waitFor(() => expect(within(codex).getByLabelText("Steer this task")).toBeTruthy());
    expect(codex.textContent).toMatch(/Cursor/);
    expect((within(codex).getByLabelText("Steer this task") as HTMLTextAreaElement | HTMLInputElement).value).toBe("");
  });

  it("a failed task shows its reason as an error, not as its result", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05, notSetUp: ["cursor"] })} />);
    const popup = await openCodingTask("Cursor");
    const error = await within(popup).findByRole("alert", { name: "Error" }, { timeout: 2000 });
    expect(error.textContent).toMatch(/Cursor isn't set up on this machine/);
    expect(within(popup).queryByRole("region", { name: "Result" })).toBeNull();
    expect(buttons(popup)).toEqual(["Retry", "Re-run on Claude Code", "Re-run on Codex"]);
  });

  it("Re-run files one new task on that harness's worker, the old one unchanged; pressed again, the board's refusal shows", async () => {
    const lab = createFixtureLab({ speed: 0.5, notSetUp: ["codex"] });
    render(<App adapter={lab} />);
    const popup = await openCodingTask("Codex");
    await within(popup).findByRole("alert", { name: "Error" }, { timeout: 2000 });
    const [old] = rowsOf(lab);

    fireEvent.click(within(popup).getByRole("button", { name: "Re-run on Claude Code" }));
    expect((await within(popup).findByTestId("task-action-outcome")).textContent).toBe("Filed again on Claude Code.");
    const [before, filed, ...more] = rowsOf(lab);
    expect(more).toEqual([]);
    expect(before).toEqual(old);
    expect(filed).toMatchObject({ to: "teammates.claude-code", goal: old!.goal, status: "running" });
    expect(filed!.context).toMatch(/"Fix the typo in the README's first line", which failed on Codex/);

    // The same work is open on Claude Code now: the board refuses, and nothing is filed.
    fireEvent.click(within(popup).getByRole("button", { name: "Re-run on Claude Code" }));
    expect((await within(popup).findByTestId("task-action-refusal")).textContent).toMatch(/^already_open: /);
    expect(rowsOf(lab)).toHaveLength(2);
  });
});
