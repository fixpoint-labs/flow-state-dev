// @vitest-environment happy-dom
/**
 * A teammate's task shows what it came back with. A teammate (researcher,
 * writer) answers a task in text, which the board stores as the row's output
 * as is; a coding run's output carries it as `answer`. The coding board view
 * reads either into the open task's `detail.answer`, on the popup's own read
 * by `taskId` (`packages/harness-manager/test/coding-board.spec.ts` pins both
 * shapes and the cut). Read only from a copy in the conversation's items, a
 * popup opened on a long conversation showed DONE with nothing under it.
 *
 * A task that ends done with nothing written says so in its popup, rather
 * than reading as a plain success with nothing under it.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it } from "vitest";
import { PopupView } from "../src/components/Popups";
import { lookOf } from "../src/lib/looks";
import { codingTask, stubServer, TestProvider } from "./stub-server";

afterEach(cleanup);

const REVIEW = "Here are the 20 newest pull requests, reviewed:\n\n| PR | Verdict |\n| --- | --- |\n| #4735 | ready |";

/** A researcher's task as its run settled it: done, its answer on the open task's detail. */
const doneRow = (answer: string | null, fields: Partial<CodingBoardTask> = {}) =>
  codingTask({ id: "task_r", title: "Review 20 newest FSD pull requests", assignee: "researcher", status: "completed", detail: { answer, answerCut: false }, ...fields });

const openTask = (row: CodingBoardTask) => {
  const server = stubServer({ board: { wks_cos: [row] } });
  render(
    <TestProvider client={server.client}>
      <PopupView popup={{ kind: "task", sessionId: "wks_cos", taskId: "task_r" }} nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} coders={[]} onClose={() => {}} />
    </TestProvider>,
  );
  return { popup: screen.getByRole("dialog"), server };
};

describe("a teammate's finished task's popup", () => {
  it("shows the answer it wrote in its result box, read for that one task", async () => {
    const { popup, server } = openTask(doneRow(REVIEW));
    // The result box draws the answer as Markdown: its table is a table, not pipes.
    const box = await within(popup).findByRole("region", { name: "Result" });
    await waitFor(() => expect([...box.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["#4735", "ready"]));
    expect(box.textContent).toContain("Here are the 20 newest pull requests, reviewed:");
    expect(box.textContent).not.toContain("| --- |");
    expect(within(popup).queryByRole("region", { name: "No result" })).toBeNull();
    // The popup's read names its task: the board's answer for every other screen carries none.
    expect(server.boardReads.every((read) => read.taskId === "task_r")).toBe(true);
  });

  it("says when the answer was cut, so a long one never reads as whole", async () => {
    const { popup } = openTask(doneRow("a".repeat(100), { detail: { answer: "a".repeat(100), answerCut: true } }));
    const box = await within(popup).findByRole("region", { name: "Result" });
    expect(box.textContent).toContain("only its first 20,000 characters show");
  });

  it("says a done task wrote no result, rather than showing a success with nothing in it", async () => {
    const { popup } = openTask(doneRow(null));
    expect((await within(popup).findByRole("region", { name: "No result" })).textContent).toMatch(/researcher finished without writing a result/);
    expect(within(popup).queryByRole("region", { name: "Result" })).toBeNull();
  });

  it("control: a task still running says nothing about a result yet", async () => {
    const { popup } = openTask(doneRow(null, { status: "in_progress" }));
    await within(popup).findByText("Not started yet.");
    expect(within(popup).queryByRole("region", { name: "No result" })).toBeNull();
  });
});

describe("a task's popup before its own read answers", () => {
  // A running task whose line reads "working · 24m": its popup must never say it hasn't started.
  const started = doneRow(null, { status: "in_progress", run: { sessionId: "run_r", requestId: "q1", attempt: 1, startedAt: 1 }, leaseUntil: Date.now() + 60_000 });

  it("says it is loading, never \"Not started yet.\", while the read hasn't answered", async () => {
    const { popup } = openTask(started);
    expect(popup.textContent).not.toContain("Not started yet.");
    expect(within(popup).getByText("Loading…")).toBeTruthy();
    // Once it answers, the task's own state shows: its run started.
    await within(popup).findByText("Starting…");
  });

  it("says the task couldn't be loaded when its read fails, never \"Not started yet.\"", async () => {
    const server = stubServer({ board: { wks_cos: [started] }, boardFails: true });
    render(
      <TestProvider client={server.client}>
        <PopupView popup={{ kind: "task", sessionId: "wks_cos", taskId: "task_r" }} nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} coders={[]} onClose={() => {}} />
      </TestProvider>,
    );
    const popup = screen.getByRole("dialog");
    await within(popup).findByText("This task couldn't be loaded.");
    expect(popup.textContent).not.toContain("Not started yet.");
  });
});

describe("a finished task's popup shows its result once", () => {
  // The run's last message is the answer the board stored: the Result box shows it, so the feed doesn't again.
  const PLAN = "## Plan: keeping PR state from going stale\n\nPoll the pull requests every minute.";
  const ran = (finalText: string) => [
    { id: "m1", type: "message", role: "assistant", status: "completed", requestId: "q_run", content: [{ type: "output_text", text: "Looking at the PR tab first." }] },
    { id: "m2", type: "message", role: "assistant", status: "completed", requestId: "q_run", content: [{ type: "output_text", text: finalText }] },
  ];
  const openRun = (finalText: string) => {
    const task = doneRow(PLAN, { run: { sessionId: "run_r", requestId: "q_run", attempt: 1, startedAt: 1 } });
    const server = stubServer({ board: { wks_cos: [task] }, items: { run_r: ran(finalText) } });
    render(
      <TestProvider client={server.client}>
        <PopupView popup={{ kind: "task", sessionId: "wks_cos", taskId: "task_r" }} nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} coders={[]} onClose={() => {}} />
      </TestProvider>,
    );
    return screen.getByRole("dialog");
  };
  const count = (popup: HTMLElement, text: string) => popup.textContent!.split(text).length - 1;

  it("drops the run's final message when it says what the Result box says, whitespace aside", async () => {
    const popup = openRun(`\n${PLAN.replace("\n\n", "\n\n\n")}  `);
    await within(popup).findByText("Looking at the PR tab first.");
    await within(popup).findByRole("region", { name: "Result" });
    expect(count(popup, "Poll the pull requests every minute.")).toBe(1);
  });

  it("control: keeps a final message that says something else", async () => {
    const popup = openRun("Done. One more thing: the tab also needs a refresh button.");
    await within(popup).findByText("Done. One more thing: the tab also needs a refresh button.");
    await within(popup).findByRole("region", { name: "Result" });
    expect(count(popup, "Poll the pull requests every minute.")).toBe(1);
  });
});
