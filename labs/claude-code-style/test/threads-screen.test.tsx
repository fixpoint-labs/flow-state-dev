// @vitest-environment happy-dom
/**
 * Threads mode's screen, on fixtures. These prove the UI only: the Projects
 * view, thread cards where the lead filed them, the board's columns, talking
 * inside a thread, review, pins, and a harness thread's tag. The goal check
 * proves the package at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFakeLab } from "./fake-lab";

afterEach(cleanup);

const thread = () => screen.getByRole("main", { name: "Main thread" });
const board = () => screen.getByRole("complementary", { name: "Tasks" });
const group = (label: string) => within(board()).getByRole("region", { name: label });
const card = (title: string) => within(thread()).getByRole("region", { name: `Task: ${title}` });
const rowsIn = (label: string) => within(group(label)).getAllByRole("listitem").map((li) => li.textContent ?? "");

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session");
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

// Open the Projects view and start a session there, on a project.
async function startThreadsSession(speed: number) {
  render(<App adapter={createFakeLab({ speed })} />);
  fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }));
  await screen.findByLabelText("Message the main session");
}

describe("the threads-mode screen", () => {
  it("starts a session in the Projects view with the lead and the threads board", async () => {
    await startThreadsSession(0.01);
    expect(within(thread()).getByText("Tasks")).toBeTruthy();
    expect(within(thread()).getByText("in project: vendor-notes")).toBeTruthy();
    expect(within(board()).getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Background tasks" })).toBeNull();
  });

  it("marks your line Sent to a task, shows a card per thread, and three rows under Working", async () => {
    // A fifth of real time: three rows stay under Working for about 300ms before one asks.
    await startThreadsSession(0.2);
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(within(thread()).getAllByRole("region", { name: /^Task: / })).toHaveLength(3));
    expect(within(thread()).getByText(/Sent to a task/)).toBeTruthy();
    expect(within(board()).getByRole("button", { name: /Working · 3/ })).toBeTruthy();
    expect(rowsIn("Working").join("\n")).toMatch(/0\/7 · Reading pricing pages/);
  });

  it("puts a question under Waiting on you and takes your answer in the thread's view", async () => {
    await startThreadsSession(0.01);
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(rowsIn("Waiting on you").join()).toMatch(/Which region matters, EU or US\?/));
    // The card offers Answer; answering happens in the thread's view, which replaces the board.
    fireEvent.click(within(card("Vendor B · regions")).getByRole("button", { name: "Answer" }));
    const view = screen.getByRole("complementary", { name: "Task: Vendor B · regions" });
    expect(within(view).getByRole("note").textContent).toMatch(/Waiting on you · Which region matters/);
    fireEvent.change(within(view).getByLabelText("Message this task"), { target: { value: "EU" } });
    fireEvent.click(within(view).getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(card("Vendor B · regions").dataset.column).toBe("working"));
    // It comes back for review with what the answer asked for.
    await waitFor(() => expect(card("Vendor B · regions").dataset.column).toBe("review"));
    expect(card("Vendor B · regions").textContent).toMatch(/Summary for EU ready/);
    fireEvent.click(within(view).getByRole("button", { name: "Back to tasks" }));
    expect(rowsIn("Ready for review").join()).toMatch(/Vendor B · regions/);
  });

  it("resolves a thread ready for review, moving it under Resolved, collapsed to a count", async () => {
    await startThreadsSession(0.01);
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("review"));
    expect(rowsIn("Ready for review").join()).toMatch(/Vendor C · summary/);
    fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("resolved"));
    const resolved = within(group("Resolved")).getByRole("button", { name: /Resolved · 1/ });
    expect(resolved.getAttribute("aria-expanded")).toBe("false");
    expect(within(board()).queryByRole("region", { name: "Ready for review" })).toBeNull();
    fireEvent.click(resolved);
    expect(rowsIn("Resolved").join()).toMatch(/Vendor C · summary/);
  });

  it("sends a thread back to work with your words, and it returns for review", async () => {
    await startThreadsSession(0.01);
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("review"));
    fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "Request changes" }));
    const view = screen.getByRole("complementary", { name: "Task: Vendor C · summary" });
    const change = within(view).getByRole("button", { name: "Request changes" }) as HTMLButtonElement;
    expect(change.disabled).toBe(true);
    fireEvent.change(within(view).getByLabelText("Message this task"), { target: { value: "Add their support hours." } });
    fireEvent.click(change);
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("working"));
    expect(within(view).getByText("Add their support hours.")).toBeTruthy();
    await waitFor(() => expect(card("Vendor C · summary").textContent).toMatch(/Revised draft attached/));
  });

  it("marks a session in the list with how many of its threads wait on you, so you see it without opening it", async () => {
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
    const row = within(screen.getByRole("navigation", { name: "Sessions" })).getByRole("button", { name: /Billing triage/ });
    // The failed export waits on you; the pinned digest is still working, and done threads owe you nothing.
    expect(row.textContent).toMatch(/1 waiting on you/);
    expect(within(row).getByLabelText("waiting on you")).toBeTruthy();
  });

  it("keeps a pinned thread under Pinned whatever its status, and unpins it", async () => {
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Sessions" })).getByRole("button", { name: /Billing triage/ }));
    await waitFor(() => expect(rowsIn("Pinned").join()).toMatch(/Weekly uptime digest/));
    expect(within(board()).queryByRole("region", { name: "Working" })).toBeNull();
    // A failed thread waits on you; there is no retry button, you ask the main session.
    expect(rowsIn("Waiting on you").join()).toMatch(/Export failed invoices.*Failed · The export timed out/);
    // A harness run that completed at its review deadline is resolved, marked so it never reads as approved.
    fireEvent.click(within(board()).getByRole("button", { name: /Resolved · 3/ }));
    const unreviewed = rowsIn("Resolved").find((row) => row.includes("Retry webhook on 502")) ?? "";
    expect(unreviewed).toMatch(/Not reviewed/);
    expect(rowsIn("Resolved").filter((row) => /Not reviewed/.test(row))).toHaveLength(1);

    fireEvent.click(within(group("Pinned")).getByRole("button", { name: /Weekly uptime digest/ }));
    const view = screen.getByRole("complementary", { name: "Task: Weekly uptime digest" });
    fireEvent.click(within(view).getByRole("button", { name: "Unpin" }));
    await within(view).findByRole("button", { name: "Pin" });
    fireEvent.click(within(view).getByRole("button", { name: "Back to tasks" }));
    expect(within(board()).queryByRole("region", { name: "Pinned" })).toBeNull();
    expect(rowsIn("Working").join()).toMatch(/Weekly uptime digest/);
  });

  it("runs a code change as a thread tagged Claude Code, ready for review with the judge's verdict", async () => {
    await startThreadsSession(0.01);
    await ask("Add a CHANGELOG line for the vendor pick");
    await waitFor(() => expect(within(thread()).getAllByRole("region", { name: /^Task: / })).toHaveLength(1));
    const coder = card("Add a CHANGELOG line for the vendor pick");
    expect(within(coder).getByText("Claude Code")).toBeTruthy();
    await waitFor(() => expect(coder.dataset.column).toBe("review"));
    expect(coder.textContent).toMatch(/Ready for review · 1 commit on conductor\//);
    // The model and tokens its Claude Code run reported, read off the board's row.
    expect(within(coder).getByText("claude-sonnet-4-5 · 13.6k tokens")).toBeTruthy();
    expect(rowsIn("Ready for review").join()).toMatch(/Claude Code/);
    fireEvent.click(within(coder).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(coder.dataset.column).toBe("resolved"));
  });

  it("turns a thread's composer off once it is finished, and points you to the main session", async () => {
    await startThreadsSession(0.01);
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("review"));
    fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "View task" }));
    const view = screen.getByRole("complementary", { name: "Task: Vendor C · summary" });
    expect(within(view).getByLabelText("Message this task")).toBeTruthy();
    fireEvent.click(within(view).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(within(view).queryByLabelText("Message this task")).toBeNull());
    expect(within(view).getByText(/This task is finished/)).toBeTruthy();
  });

  it("says a coding task is ready for review once, in short lines that fit the panel", async () => {
    await startThreadsSession(0.01);
    await ask("Add a CHANGELOG line for the vendor pick");
    const coder = await waitFor(() => card("Add a CHANGELOG line for the vendor pick"));
    await waitFor(() => expect(coder.dataset.column).toBe("review"));
    fireEvent.click(within(coder).getByRole("button", { name: "View task" }));
    const view = screen.getByRole("complementary", { name: "Task: Add a CHANGELOG line for the vendor pick" });
    const review = await within(view).findByRole("region", { name: "Ready for review" });
    // Said once: the header carries no second copy of the review.
    expect(view.textContent!.match(/Ready for review/g)).toHaveLength(1);
    // The branch, short, with the full name on hover.
    const branch = review.querySelector("[data-review-branch]") as HTMLElement;
    expect(branch.textContent).toBe("…/t-7f3c2e1a9b--code");
    expect(branch.title).toMatch(/^conductor\/t0\/ha62422c.*--code$/);
    expect(review.textContent).toMatch(/1 commit/);
    expect(review.querySelector("[data-review-judge]")!.textContent).toMatch(/^Judge: done, 0\.91The CHANGELOG gains one line/);
    // The stop's boilerplate is for the prompt, not the card.
    expect(view.textContent).not.toMatch(/information, not approval/);
    expect(within(view).getByRole("button", { name: "Resolve" })).toBeTruthy();
  });

  it("widens the side panel from its edge and remembers the width", async () => {
    localStorage.clear();
    await startThreadsSession(0.01);
    const edge = screen.getByRole("separator", { name: "Resize the side panel" });
    expect(edge.getAttribute("aria-valuenow")).toBe("304");
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(edge.getAttribute("aria-valuenow")).toBe("336");
    expect(localStorage.getItem("claude-code-style:pane-width")).toBe("336");
    cleanup();
    // A reload opens at the width you left.
    await startThreadsSession(0.01);
    expect(screen.getByRole("separator", { name: "Resize the side panel" }).getAttribute("aria-valuenow")).toBe("336");
    localStorage.clear();
  });
});
