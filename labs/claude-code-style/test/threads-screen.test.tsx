// @vitest-environment happy-dom
/**
 * Threads mode's screen, on the lab's own host with the models scripted and
 * every coding run on harness-manager's scripted coder: the Projects view,
 * thread cards where the lead filed them, the board's columns, talking inside
 * a thread, review, pins, and a harness thread's tag.
 */
import { execFileSync } from "node:child_process";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { App } from "../src/components/App";
import { shortBranch } from "../src/components/flow-state/review-hold";
import { layOutFeeds } from "./feed-layout";
import { closeApps, openTestApp, vendorScripts, type TestApp } from "./app-host";

// The app keeps what is open in the page's address; each test starts on a bare one.
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  await closeApps();
});

/** Long enough for a read of the in-process host, which hears no push and reads on its timer. */
const SLOW = { timeout: 15_000 };

let lab: TestApp;

const thread = () => screen.getByRole("main", { name: "Main thread" });
const board = () => screen.getByRole("complementary", { name: "Tasks" });
const group = (label: string) => within(board()).getByRole("region", { name: label });
const card = (title: string) => within(thread()).getByRole("region", { name: `Task: ${title}` });
const rowsIn = (label: string) => within(group(label)).getAllByRole("listitem").map((li) => li.textContent ?? "");

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session", undefined, SLOW);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

// Open the Projects view and start a session there, on a project, on a host of its own (`reuse`: the same one, as a reload).
async function startThreadsSession(reuse = false) {
  if (!reuse) lab = await openTestApp({ scripts: vendorScripts().scripts });
  render(lab.wrap(<App />));
  fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }, SLOW));
  await screen.findByLabelText("Message the main session", undefined, SLOW);
}

// The vendor threads, with Vendor C's coding run ready for review and its review read.
async function vendorThreads() {
  await startThreadsSession();
  await ask("Research three vendors for a status page, one thread each.");
  await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("review"), SLOW);
}

// A threads-mode session whose billing threads are filed: a digest that keeps working, an export that failed.
async function billingSession() {
  await startThreadsSession();
  await ask("Triage the billing exports.");
  await waitFor(() => expect(rowsIn("Waiting on you").join()).toMatch(/Export failed invoices/), SLOW);
}

// Opens the thread that is ready for review, as a sheet over the main thread.
async function openReviewThread() {
  await vendorThreads();
  fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "View task" }));
  return screen.getByRole("dialog", { name: "Task: Vendor C · summary" });
}

describe("the threads-mode screen", () => {
  it("starts a session in the Projects view with the lead and the threads board", async () => {
    await startThreadsSession();
    // The view switch names the mode once; the thread header carries no second, inert label for it.
    expect(within(thread()).queryByText("Tasks")).toBeNull();
    expect(within(thread()).getByText("in project: vendor-notes")).toBeTruthy();
    expect(within(board()).getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Background tasks" })).toBeNull();
  });

  it("marks your line Sent to a task, shows a card per thread, and lists the working one under Working", async () => {
    await startThreadsSession();
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(within(thread()).getAllByRole("region", { name: /^Task: / })).toHaveLength(3), SLOW);
    expect(within(thread()).getByText(/Sent to a task/)).toBeTruthy();
    await waitFor(() => expect(rowsIn("Working").join("\n")).toMatch(/Vendor A · pricing and uptime/), SLOW);
  });

  it("puts a question under Waiting on you and takes your answer in the thread's view", async () => {
    await startThreadsSession();
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(rowsIn("Waiting on you").join()).toMatch(/Which region matters, EU or US\?/), SLOW);
    // The card offers Answer; answering happens in the thread's sheet, over the main thread.
    fireEvent.click(within(card("Vendor B · regions")).getByRole("button", { name: "Answer" }));
    const view = screen.getByRole("dialog", { name: "Task: Vendor B · regions" });
    expect(within(view).getByRole("note").textContent).toMatch(/Waiting on you · Which region matters/);
    fireEvent.change(within(view).getByLabelText("Message this task"), { target: { value: "EU" } });
    fireEvent.click(within(view).getByRole("button", { name: "Answer" }));
    // Answered, it no longer waits on you: it works on with what the answer said, and finishes.
    await waitFor(() => expect(card("Vendor B · regions").dataset.column).not.toBe("waiting"), SLOW);
    await waitFor(() => expect(card("Vendor B · regions").dataset.column).toBe("resolved"), SLOW);
    fireEvent.click(within(view).getByRole("button", { name: "Close" }));
    expect(within(board()).queryByRole("region", { name: "Waiting on you" })).toBeNull();
  });

  it("sends an answer with Cmd+Enter or Ctrl+Enter, keeps plain Enter a new line, and sends nothing from an empty box", async () => {
    await startThreadsSession();
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(rowsIn("Waiting on you").join()).toMatch(/Which region matters/), SLOW);
    fireEvent.click(within(card("Vendor B · regions")).getByRole("button", { name: "Answer" }));
    const view = screen.getByRole("dialog", { name: "Task: Vendor B · regions" });
    const box = within(view).getByLabelText("Message this task");
    // An empty box sends nothing, shortcut or not.
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    // Plain Enter in a longer answer is a new line, never a send.
    fireEvent.change(box, { target: { value: "EU" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(card("Vendor B · regions").dataset.column).toBe("waiting");
    // Cmd+Enter answers, the same as the button.
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(card("Vendor B · regions").dataset.column).not.toBe("waiting"), SLOW);
    // The box clears once the send resolves, which can land after the card moves; or the thread,
    // answered, finished and took its composer away.
    await waitFor(() => expect(box.isConnected ? (box as HTMLTextAreaElement).value : "").toBe(""), SLOW);
  });

  it("requests changes with Ctrl+Enter in the What should change box", async () => {
    await vendorThreads();
    fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "Request changes" }));
    const view = screen.getByRole("dialog", { name: "Task: Vendor C · summary" });
    const box = within(view).getByPlaceholderText("What should change…");
    fireEvent.change(box, { target: { value: "Add the EU pricing." } });
    // The view reads the run's review for itself before its review buttons go live.
    await waitFor(() => expect((within(view).getByRole("button", { name: "Request changes" }) as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    // Back to work with your words: a request for changes, not a line said in passing.
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""), SLOW);
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).not.toBe("review"), SLOW);
  });

  it("resolves a thread ready for review, moving it under Resolved, collapsed to a count", async () => {
    await vendorThreads();
    expect(rowsIn("Ready for review").join()).toMatch(/Vendor C · summary/);
    // A coding review on a host that can't land the work offers a plain Resolve.
    const accept = within(card("Vendor C · summary")).getByRole("button", { name: /^(Resolve|Merge locally)$/ });
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.click(accept);
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("resolved"), SLOW);
    const resolved = within(group("Resolved")).getByRole("button", { name: /Resolved · \d/ });
    expect(resolved.getAttribute("aria-expanded")).toBe("false");
    expect(within(board()).queryByRole("region", { name: "Ready for review" })).toBeNull();
    fireEvent.click(resolved);
    expect(rowsIn("Resolved").join()).toMatch(/Vendor C · summary/);
  });

  it("sends a thread back to work with your words, and it returns for review", async () => {
    await vendorThreads();
    fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "Request changes" }));
    const view = screen.getByRole("dialog", { name: "Task: Vendor C · summary" });
    const change = within(view).getByRole("button", { name: "Request changes" }) as HTMLButtonElement;
    expect(change.disabled).toBe(true);
    fireEvent.change(within(view).getByLabelText("Message this task"), { target: { value: "Add their support hours." } });
    await waitFor(() => expect(change.disabled).toBe(false), SLOW);
    const stops = () => within(view).queryAllByRole("region", { name: "Ready for review" }).length;
    fireEvent.click(change);
    // Back to work with your words, and the run stops for review again.
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).not.toBe("review"), SLOW);
    await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("review"), SLOW);
    expect(stops()).toBeGreaterThan(0);
  });

  it("marks a session in the list with how many of its threads wait on you, so you see it without opening it", async () => {
    await billingSession();
    const row = () => within(screen.getByRole("navigation", { name: "Sessions" })).getByRole("button", { name: /Triage the billing exports/ });
    // The failed export waits on you; the digest is still working and owes you nothing.
    await waitFor(() => expect(row().textContent).toMatch(/1 waiting on you/), SLOW);
    // Its dot says so too, once the lead's turn has ended (a running session's dot says running).
    await waitFor(() => expect(within(row()).getByLabelText("waiting on you")).toBeTruthy(), SLOW);
  });

  it("keeps a pinned thread under Pinned whatever its status, and unpins it", async () => {
    await billingSession();
    // A failed thread waits on you: its view offers Retry (`task-actions.test.tsx`).
    await waitFor(() => expect(rowsIn("Waiting on you").join()).toMatch(/Export failed invoices.*Failed · The export timed out/), SLOW);
    fireEvent.click(within(group("Working")).getByRole("button", { name: /Weekly uptime digest/ }));
    const view = screen.getByRole("dialog", { name: "Task: Weekly uptime digest" });
    fireEvent.click(within(view).getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(rowsIn("Pinned").join()).toMatch(/Weekly uptime digest/), SLOW);
    expect(within(board()).queryByRole("region", { name: "Working" })).toBeNull();

    const unpin = await within(view).findByRole("button", { name: "Unpin" }, SLOW);
    await waitFor(() => expect((unpin as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.click(unpin);
    await within(view).findByRole("button", { name: "Pin" }, SLOW);
    fireEvent.click(within(view).getByRole("button", { name: "Close" }));
    expect(within(board()).queryByRole("region", { name: "Pinned" })).toBeNull();
    expect(rowsIn("Working").join()).toMatch(/Weekly uptime digest/);
  });

  it("lets you dismiss a failed thread: it leaves Waiting on you for Resolved, and the session stops counting it", async () => {
    await billingSession();
    const session = () => within(screen.getByRole("navigation", { name: "Sessions" })).getByRole("button", { name: /Triage the billing exports/ });
    await waitFor(() => expect(session().textContent).toMatch(/1 waiting on you/), SLOW);
    fireEvent.click(await within(group("Waiting on you")).findByRole("button", { name: /Export failed invoices/ }));
    const view = screen.getByRole("dialog", { name: "Task: Export failed invoices" });
    fireEvent.click(await within(view).findByRole("button", { name: "Dismiss" }, SLOW));
    // Nothing else waited on you in this session, so the group goes.
    await waitFor(() => expect(within(board()).queryByRole("region", { name: "Waiting on you" })).toBeNull(), SLOW);
    expect(within(view).queryByRole("button", { name: "Dismiss" })).toBeNull();
    // Still failed, and still retryable from its view: dismissing only stops it waiting on you.
    expect(within(within(view).getByTestId("task-action-row")).getByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(within(view).getByRole("button", { name: "Close" }));
    fireEvent.click(within(board()).getByRole("button", { name: /Resolved · 1/ }));
    expect(rowsIn("Resolved").join()).toMatch(/Export failed invoices.*Failed · The export timed out/);
    await waitFor(() => expect(session().textContent).not.toMatch(/waiting on you/), SLOW);
  });

  it("runs a code change as a thread tagged with its harness, ready for review", async () => {
    await startThreadsSession();
    await ask("Add a CHANGELOG line for the vendor pick");
    await waitFor(() => expect(within(thread()).getAllByRole("region", { name: /^Task: / })).toHaveLength(1), SLOW);
    const coder = () => card("Add a CHANGELOG line for the vendor pick");
    await waitFor(() => expect(within(coder()).getByText("Claude Code")).toBeTruthy(), SLOW);
    await waitFor(() => expect(coder().dataset.column).toBe("review"), SLOW);
    expect(coder().textContent).toMatch(/Ready for review/);
    expect(rowsIn("Ready for review").join()).toMatch(/Claude Code/);
    const accept = within(coder()).getByRole("button", { name: /^(Resolve|Merge locally)$/ });
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.click(accept);
    await waitFor(() => expect(coder().dataset.column).toBe("resolved"), SLOW);
  });

  // What the threads-mode goal's signal 6 grades. A run in a worktree of the project's repository can land
  // there, so its accept is Merge locally, never a bare Resolve (FIX-2543); the judge's line is on the review
  // card in its view (FIX-2380), while the card's one status line is the review's headline.
  it("offers a coding run in the project's repository Merge locally, with the judge's line in its view, and merges it there", async () => {
    lab = await openTestApp({ scripts: vendorScripts().scripts, cutFromProject: true, judge: { choice: "done", confidence: 0.93 } });
    await startThreadsSession(true);
    const git = (...args: string[]) => execFileSync("git", ["-C", lab.repo, ...args], { encoding: "utf8" }).trim();
    const head = git("rev-parse", "HEAD");
    const branch = git("symbolic-ref", "--short", "HEAD");
    await ask("Add a CHANGELOG line for the vendor pick");
    const coder = () => card("Add a CHANGELOG line for the vendor pick");
    await waitFor(() => expect(coder().dataset.column).toBe("review"), SLOW);
    const merge = await within(coder()).findByRole("button", { name: "Merge locally" }, SLOW);
    expect(within(coder()).queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(coder().textContent).not.toMatch(/judge/i);
    fireEvent.click(within(coder()).getByRole("button", { name: "View task" }));
    const view = screen.getByRole("dialog", { name: "Task: Add a CHANGELOG line for the vendor pick" });
    const review = await within(view).findByRole("region", { name: "Ready for review" }, SLOW);
    expect(review.querySelector("[data-review-judge]")!.textContent).toMatch(/^Judge: done, 0\.93/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect((merge as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.click(merge);
    await waitFor(() => expect(coder().dataset.column).toBe("resolved"), SLOW);
    // Landed in the project's checkout: the branch it had checked out is still checked out (not another, not a
    // detached HEAD), moved on from where it was to hold the run's work, with nothing left uncommitted.
    expect(git("symbolic-ref", "-q", "--short", "HEAD")).toBe(branch);
    git("merge-base", "--is-ancestor", head, `refs/heads/${branch}`); // throws unless the branch grew from where it was
    expect(git("rev-parse", `refs/heads/${branch}`)).not.toBe(head);
    expect(git("ls-tree", "--name-only", `refs/heads/${branch}`, "SCRIPTED-RUN.md")).toBe("SCRIPTED-RUN.md");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("turns a thread's composer off once it is finished", async () => {
    await vendorThreads();
    fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "View task" }));
    const view = screen.getByRole("dialog", { name: "Task: Vendor C · summary" });
    expect(within(view).getByLabelText("Message this task")).toBeTruthy();
    const accept = await within(view).findByRole("button", { name: /^(Resolve|Merge locally)$/ }, SLOW);
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.click(accept);
    await waitFor(() => expect(within(view).queryByLabelText("Message this task")).toBeNull(), SLOW);
    expect(within(view).getByText(/This task is finished/)).toBeTruthy();
  });

  it("says a coding task is ready for review once, in short lines that fit the panel", async () => {
    await startThreadsSession();
    await ask("Add a CHANGELOG line for the vendor pick");
    await waitFor(() => expect(card("Add a CHANGELOG line for the vendor pick").dataset.column).toBe("review"), SLOW);
    fireEvent.click(within(card("Add a CHANGELOG line for the vendor pick")).getByRole("button", { name: "View task" }));
    const view = screen.getByRole("dialog", { name: "Task: Add a CHANGELOG line for the vendor pick" });
    const review = await within(view).findByRole("region", { name: "Ready for review" }, SLOW);
    // Said once: the header carries no second copy of the review.
    expect(view.textContent!.match(/Ready for review/g)).toHaveLength(1);
    // The branch, short, with the full name on hover.
    const branch = review.querySelector("[data-review-branch]") as HTMLElement;
    expect(branch.title).toMatch(/\//);
    expect(branch.textContent).toBe(shortBranch(branch.title));
    // The stop's boilerplate is for the prompt, not the card.
    expect(view.textContent).not.toMatch(/information, not approval/);
  });

  it("opens a thread as a sheet over the main thread, with the board still in the pane, as session mode's tasks open", async () => {
    await vendorThreads();
    fireEvent.click(within(card("Vendor C · summary")).getByRole("button", { name: "View task" }));
    // The sheet draws over the main thread; the board is still in the pane beside it.
    expect(screen.getByRole("dialog", { name: "Task: Vendor C · summary" })).toBeTruthy();
    expect(rowsIn("Ready for review").join()).toMatch(/Vendor C · summary/);
    // Esc closes it, and the thread's cards stay where they were.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Task: Vendor C · summary" })).toBeNull());
    expect(within(thread()).getAllByRole("region", { name: /^Task: / })).toHaveLength(3);
  });

  it("scrolls the thread's body to your line when you send from its composer, as the main thread does", async () => {
    // Every scroll the sheet's body is asked for is recorded. Your line rises smoothly, as it does in the main thread.
    const feeds = layOutFeeds();
    onTestFinished(feeds.restore);
    const view = await openReviewThread();
    const body = view.querySelector<HTMLElement>(":scope > .overflow-y-auto")!;
    feeds.scrolls.length = 0;
    fireEvent.change(within(view).getByLabelText("Message this task"), { target: { value: "Shorter, please." } });
    const change = within(view).getByRole("button", { name: "Request changes" }) as HTMLButtonElement;
    await waitFor(() => expect(change.disabled).toBe(false), SLOW);
    fireEvent.click(change);
    // The line lands after a round trip to the server, which takes as long as the machine is busy:
    // wait for it in the body, then for the rise it brings.
    await within(body).findByText("Shorter, please.", undefined, SLOW);
    await waitFor(() => expect(feeds.scrolls.some((s) => s.feed === body && s.behavior === "smooth")).toBe(true));
  });

  it("keeps the thread open when Esc only ends an IME composition in its box", async () => {
    const view = await openReviewThread();
    const box = within(view).getByLabelText("Message this task");
    fireEvent.keyDown(box, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog", { name: "Task: Vendor C · summary" })).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Task: Vendor C · summary" })).toBeNull());
  });

  it("lets Esc close the keys sheet opened over a thread, and leaves the thread open", async () => {
    const view = await openReviewThread();
    fireEvent.keyDown(document.body, { key: "?" });
    const keys = await screen.findByRole("dialog", { name: "Keys" });
    await waitFor(() => expect(keys.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keys" })).toBeNull());
    expect(view.isConnected).toBe(true);
    expect(screen.getByRole("dialog", { name: "Task: Vendor C · summary" })).toBeTruthy();
  });

  it("widens the sessions list from its right edge and remembers the width", async () => {
    localStorage.clear();
    await startThreadsSession();
    const edge = screen.getByRole("separator", { name: "Resize the sessions list" });
    // The window here is narrow, so the list opens at the narrow default.
    expect(edge.getAttribute("aria-valuenow")).toBe("240");
    // Its edge is on its right, so Right widens it (the side panel's is the other way round).
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(edge.getAttribute("aria-valuenow")).toBe("272");
    expect(localStorage.getItem("claude-code-style:sidebar-width")).toBe("272");
    cleanup();
    await startThreadsSession(true);
    expect(screen.getByRole("separator", { name: "Resize the sessions list" }).getAttribute("aria-valuenow")).toBe("272");
    localStorage.clear();
  });

  it("widens the side panel from its edge and remembers the width", async () => {
    localStorage.clear();
    await startThreadsSession();
    const edge = screen.getByRole("separator", { name: "Resize the side panel" });
    expect(edge.getAttribute("aria-valuenow")).toBe("304");
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(edge.getAttribute("aria-valuenow")).toBe("336");
    expect(localStorage.getItem("claude-code-style:pane-width")).toBe("336");
    cleanup();
    // A reload opens at the width you left.
    await startThreadsSession(true);
    expect(screen.getByRole("separator", { name: "Resize the side panel" }).getAttribute("aria-valuenow")).toBe("336");
    localStorage.clear();
  });
});
