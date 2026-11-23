// @vitest-environment happy-dom
/**
 * A coding task's popup is where you stop, steer and re-run it, with no model
 * turn in between. Its buttons follow the row's board status: Cancel and a
 * Steer box while it runs, Retry and one Re-run per other harness once it
 * failed or was cancelled. A failed task's reason shows as an error, never in
 * the Result box. Without these, the only way to stop a run going wrong, or
 * to try a failed task on another harness, is to type it to Lead
 * and hope its turn does what you meant.
 *
 * Each button sends the board's own action on the conversation that filed
 * the task, through orchestration's Inbox client; the stand-in server here
 * plays the board, and a re-run reads the task's brief whole (`getTask`)
 * before it files it again.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { scriptedServer } from "./scripted-server";
import { codingTask, stubServer, TestProvider, type Posted, POPUP_READ } from "./stub-server";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
const BOARD = `conversation:${LEAD}`;
const TASK = "Coding task: Fix the typo in the README's first line";
const BRIEF = "Only the first line. ".repeat(1_200);

/** A coding task of Lead's conversation on `harness`'s worker, with a long brief the board keeps whole. */
const coding = (id: string, harness: string, fields: Partial<CodingBoardTask> = {}) =>
  codingTask({ id, assignee: `teammates.${harness}`, harness, title: "Fix the typo in the README's first line", goal: "Fix the typo in the README's first line.", status: "in_progress", ...fields });

/** The board's action a POST sent, and its input. */
const actionOf = (posted: Posted) => ({ action: posted.path.split("/").at(-1)!, input: posted.body.input as Record<string, any> });

/** The lab on a stand-in board that holds `rows` and answers each action as the board would. */
function onBoard(rows: CodingBoardTask[]) {
  const server = stubServer({
    board: { [BOARD]: rows },
    answer: (posted) => {
      const { action, input } = actionOf(posted);
      const board = server.board[BOARD]!;
      const at = board.findIndex((task) => task.id === input.id);
      if (action === "getTask_tasks") return { ok: true, task: { ...board[at], context: BRIEF, labels: ["docs"], priority: 2 } };
      if (action === "updateTask_tasks" && input.status === "cancelled") board[at] = { ...board[at]!, status: "cancelled", completedAt: Date.now() };
      if (action === "createTask_tasks") {
        const same = board.find((task) => task.assignee === input.assignee && task.goal === input.goal && task.status === "in_progress");
        if (same !== undefined) return { ok: false, error: `already_open: task "${same.title}" (${same.id}) is this same work for ${input.assignee}. Nothing was filed.` };
        board.push(coding(`t${board.length + 1}`, String(input.assignee).replace("teammates.", "")));
        return { ok: true, taskId: `t${board.length}` };
      }
      return { ok: true };
    },
  });
  return server;
}

/** The task's popup, opened by its address over the stand-in board. */
function openTask(server: ReturnType<typeof onBoard>, taskId = "t1") {
  window.history.replaceState(null, "", `/?worker=${LEAD}&session=${BOARD}&task=${taskId}`);
  render(<TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}><App /></TestProvider>);
  return screen.findByRole("dialog", { name: TASK }, POPUP_READ);
}

const buttons = (popup: HTMLElement) => [...popup.querySelectorAll<HTMLElement>('[data-testid="task-action-row"] button')].map((b) => b.textContent ?? "");

describe("a coding task's popup has its buttons", () => {
  it("while it runs: Cancel, and the Steer compose at the popup's foot; once cancelled: Retry and a Re-run on each other harness, never its own", async () => {
    const server = onBoard([coding("t1", "cursor")]);
    const popup = await openTask(server);
    await waitFor(() => expect(buttons(popup)).toEqual(["Cancel"]), { timeout: 2000 });

    // Steer: a compose at the foot, below the feed, not in the row at the top.
    const steer = within(popup).getByRole("region", { name: "Steer" });
    expect(steer.closest("footer")).not.toBeNull();
    // The words go to the board's updateTask on the conversation that filed it; Enter sends.
    fireEvent.change(within(steer).getByLabelText("Steer this task"), { target: { value: "Keep the old wording." } });
    fireEvent.keyDown(within(steer).getByLabelText("Steer this task"), { key: "Enter" });
    expect((await within(popup).findByTestId("task-action-outcome")).textContent).toBe("Sent to the task.");
    expect(server.posts.map(actionOf)).toContainEqual({ action: "updateTask_tasks", input: { id: "t1", message: "Keep the old wording." } });
    expect(server.posts.every((posted) => posted.path.startsWith(`/api/flows/agent/${encodeURIComponent(BOARD)}/actions/`))).toBe(true);

    // Cancel asks once, then the row reads cancelled, and the buttons follow it.
    fireEvent.click(within(popup).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(popup).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(popup.querySelector("[data-overlay-status]")?.textContent).toBe("cancelled"));
    expect(buttons(popup)).toEqual(["Retry", "Re-run on Claude Code", "Re-run on Codex"]);
    // An ended task can't be steered: the compose is gone.
    expect(within(popup).queryByRole("region", { name: "Steer" })).toBeNull();
  });

  it("starts the row afresh when the popup moves to another task, so a draft never carries to it", async () => {
    const server = onBoard([coding("t1", "cursor"), coding("t2", "codex", { title: "Bump the version" })]);
    window.history.replaceState(null, "", `/?worker=${LEAD}&session=${BOARD}&task=t2`);
    render(<TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}><App /></TestProvider>);
    const popup = await screen.findByRole("dialog", { name: "Coding task: Bump the version" }, POPUP_READ);
    await waitFor(() => expect(buttons(popup)).toEqual(["Cancel"]), { timeout: 2000 });
    fireEvent.change(within(popup).getByLabelText("Steer this task"), { target: { value: "Meant for Codex." } });

    // The conversation's other task opens in the same popup, which keeps no draft of the first.
    const panel = screen.getByRole("complementary", { name: "Lead's panel" });
    fireEvent.click(within(panel).getByRole("button", { name: `${TASK}, on Cursor` }));
    await waitFor(() => expect(popup.textContent).toMatch(/Cursor/));
    expect((within(popup).getByLabelText("Steer this task") as HTMLTextAreaElement | HTMLInputElement).value).toBe("");
  });

  it("a failed task shows its reason as an error, not as its result", async () => {
    const server = onBoard([coding("t1", "cursor", { status: "errored", error: "Cursor isn't set up on this machine: no sign-in found." })]);
    const popup = await openTask(server);
    const error = await within(popup).findByRole("alert", { name: "Error" }, { timeout: 2000 });
    expect(error.textContent).toMatch(/Cursor isn't set up on this machine/);
    expect(within(popup).queryByRole("region", { name: "Result" })).toBeNull();
    expect(buttons(popup)).toEqual(["Retry", "Re-run on Claude Code", "Re-run on Codex"]);
  });

  it("Re-run reads the brief whole and files one new task on that harness's worker, the old one unchanged; pressed again, the board's refusal shows", async () => {
    const server = onBoard([coding("t1", "codex", { status: "errored", error: "Codex has no credential." })]);
    const popup = await openTask(server);
    await within(popup).findByRole("alert", { name: "Error" }, { timeout: 2000 });
    const old = { ...server.board[BOARD]![0]! };

    fireEvent.click(within(popup).getByRole("button", { name: "Re-run on Claude Code" }));
    expect((await within(popup).findByTestId("task-action-outcome")).textContent).toBe("Filed again on Claude Code.");
    const sent = server.posts.map(actionOf);
    // The brief is read whole first, then filed again with it, a line naming the task it re-runs added.
    expect(sent.map((s) => s.action)).toEqual(["getTask_tasks", "createTask_tasks"]);
    const filed = sent[1]!.input;
    expect(filed).toMatchObject({ goal: old.goal, title: old.title, assignee: "teammates.claude-code", labels: ["docs"], priority: 2 });
    expect(filed.context.startsWith(BRIEF)).toBe(true);
    expect(filed.context.slice(BRIEF.length)).toBe('\n\nThis re-runs the task "Fix the typo in the README\'s first line", which failed on Codex.');
    const [before, ...after] = server.board[BOARD]!;
    expect(before).toEqual(old);
    expect(after).toHaveLength(1);

    // The same work is open on Claude Code now: the board refuses, and nothing is filed.
    fireEvent.click(within(popup).getByRole("button", { name: "Re-run on Claude Code" }));
    expect((await within(popup).findByTestId("task-action-refusal")).textContent).toMatch(/^already_open: /);
    expect(server.board[BOARD]).toHaveLength(2);
  });
});
