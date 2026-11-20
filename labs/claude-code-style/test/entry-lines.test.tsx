// @vitest-environment happy-dom
/**
 * What a task's ending and its tool calls look like in a thread. A finished
 * background task is one short line, its title and status, because the task's
 * whole reply is already in its own view: printed again in the main thread it
 * buried the conversation. The line opens to show the reply. A tool call reads
 * as plain words naming what it acted on and whether it worked, never a tool's
 * name, a task id or `null`, which mean nothing to whoever reads it. Each is
 * drawn from React's conversation model and the lab's registry, as the thread
 * draws it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationLines, FlowProvider } from "@flow-state-dev/react";
import { FILED_TASK_DATA_TYPE, TASK_RESULT_DATA_TYPE } from "@flow-state-dev/workforce/browser";
import type { AppTask } from "../src/app";

// The board's tasks the lines read, stood in for: a line reads the same view the pane does.
const board = vi.hoisted(() => ({ tasks: [] as AppTask[] }));
vi.mock("../src/app/tasks", async (original) => ({
  ...(await original<typeof import("../src/app/tasks")>()),
  useTasks: (sessionId: string | undefined) => ({ value: sessionId === undefined ? undefined : board.tasks, stale: false }),
}));

import { LineContext } from "../src/components/flow-state/conversation-lines";
import { claudeCodeRenderers, WorkLines } from "../src/components/lines";

afterEach(() => {
  cleanup();
  board.tasks = [];
});

const REPLY = "## Findings\n\nThe toggle flips the page between light and dark, and the choice is kept across reloads.";

/** A `data` line of `dataType`, as workforce writes one. */
const data = (id: string, dataType: string, value: unknown, requestId = "r2") => ({ id, type: "data", dataType, value, requestId, status: "completed", provenance: { blockInstanceId: `${requestId}:x:0` } });
const result = (ending: string) => data("r1", TASK_RESULT_DATA_TYPE, { taskId: "task_1", from: "desk.coder", title: "Fix the login copy", text: REPLY, ending });
const started = data("s1", FILED_TASK_DATA_TYPE, { taskId: "task_1", title: "Fix the login copy", assignee: "desk.coder" }, "r1");

/** Draw `items` as the thread does: in session `s1`, opening tasks with `openTask` when given. */
function drawn(items: object[], openTask?: (taskId: string) => void) {
  const lines = conversationLines(items as never, [], { renderers: claudeCodeRenderers });
  const view = render(
    <FlowProvider sessionId="s1">
      <LineContext.Provider value={openTask === undefined ? {} : { openTask }}>
        <WorkLines lines={lines} />
      </LineContext.Provider>
    </FlowProvider>,
  );
  return { lines, container: view.container };
}

describe("a background result in the thread", () => {
  it("is one collapsed line with its title and status, which opens to the reply", () => {
    const { container } = drawn([result("completed")]);
    const line = screen.getByRole("button", { name: /Fix the login copy/ });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(line.textContent).toMatch(/Fix the login copy.*done/);
    expect(container.textContent).not.toMatch(/toggle flips the page/);
    expect(container.textContent).not.toMatch(/task_1/);
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toMatch(/toggle flips the page/);
    fireEvent.click(line);
    expect(container.textContent).not.toMatch(/toggle flips the page/);
  });
});

describe("a tool call in a thread or a task's work", () => {
  /** A finished `tool_output` item of turn `requestId`, as the session holds it. */
  const call = (id: string, name: string, args: unknown, output: unknown, requestId = "r1", status = "completed") => ({
    id,
    type: "tool_output",
    requestId,
    blockName: name,
    status,
    toolCall: { name, callId: `c_${id}`, arguments: JSON.stringify(args) },
    output,
    provenance: { blockInstanceId: `${requestId}:gen:0` },
  });
  const steps = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-line="steps"]')];

  it("names what it acted on and what it found, from the call and its result", () => {
    const { container } = drawn([
      call("t1", "readProjectSource", { path: "src/billing/ledger.ts" }, { kind: "read", status: "ok", text: "…" }),
      call("t2", "grepProjectSource", { pattern: "LEDGER_CODE" }, { kind: "grep", matches: [] }, "r2"),
    ]);
    expect(steps(container).map((el) => el.textContent)).toEqual(["Read src/billing/ledger.ts", 'Search "LEDGER_CODE" · no matches']);
  });

  it("says a read the project refused failed, in words and in red, and a search that found nothing did not", () => {
    const { container } = drawn([
      call("t1", "readProjectSource", { path: "README.md" }, { kind: "refused", reason: "not-a-member", message: "…" }),
      call("t2", "grepProjectSource", { pattern: "NOWHERE" }, { kind: "grep", matches: [] }, "r2"),
    ]);
    const [refused, empty] = steps(container);
    expect(refused!.textContent).toBe("Read README.md (failed)");
    expect(refused!.className).toMatch(/text-destructive/);
    expect(empty!.textContent).not.toMatch(/failed/);
    expect(empty!.className).not.toMatch(/text-destructive/);
  });

  it("says a call waiting on you is waiting, not failed", () => {
    // A worker that stops for your review is recorded as a failed call whose error is the suspension.
    const { container } = drawn([
      { ...call("t1", "suspendForUser", { kind: "review", title: "Check the copy" }, undefined, "r1", "failed"), error: { code: "SUSPENSION", message: "suspended" } },
    ]);
    const [line] = steps(container);
    expect(line!.dataset.state).toBe("waiting");
    expect(line!.textContent).not.toMatch(/failed/);
    expect(line!.className).not.toMatch(/text-destructive/);
  });

  it("folds a finished turn's run of calls into one line, which opens to each call", () => {
    const { lines, container } = drawn([
      call("t1", "readProjectSource", { path: "src/a.ts" }, { kind: "read", status: "ok" }),
      call("t2", "grepProjectSource", { pattern: "LEDGER" }, { kind: "grep", matches: [] }),
      call("t3", "readProjectSource", { path: "src/b.ts" }, { kind: "read", status: "missing" }),
    ]);
    expect(lines).toHaveLength(1);
    const [run] = steps(container);
    expect((run as HTMLDetailsElement).open).toBe(false);
    expect(run!.querySelector("summary")!.textContent).toMatch(/\(1 failed\)$/);
    expect([...run!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["· Read src/a.ts", '· Search "LEDGER" · no matches', "· Read src/b.ts (failed)"]);
  });

  it("keeps two turns' calls apart", () => {
    const { lines } = drawn([
      call("t1", "readProjectSource", { path: "src/a.ts" }, { kind: "read", status: "ok" }),
      call("t2", "readProjectSource", { path: "src/b.ts" }, { kind: "read", status: "ok" }, "r2"),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("never shows a tool's name, a task id or null, for any of the workforce and task tools", () => {
    const tools = [
      "createTask", "getTask", "updateTask", "listTasks", "holdTaskForUser", "suspendForUser", "sendMessage",
      "reportProgress", "consultSessionHistory", "globProjectSource", "readProjectSource", "grepProjectSource",
    ];
    for (const name of tools) {
      const { container } = drawn([call("t1", name, { taskId: "task_9" }, { ok: true, taskId: "task_9", task: null })]);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(new RegExp(name));
      expect(text).not.toMatch(/task_|null/);
      cleanup();
    }
  });
});

describe("a line that names a task", () => {
  // Only what the lines read of a board's task: its id, title and status.
  const boardTask = (id: string, status: AppTask["status"]): AppTask => ({ id, title: "Fix the login copy", goal: "…", status });
  const dotOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-task-dot]");

  it("opens its task from the result line, beside the fold, which still opens to the reply", () => {
    board.tasks = [boardTask("task_1", "completed")];
    const opened: string[] = [];
    const { container } = drawn([result("completed")], (id) => opened.push(id));
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(opened).toEqual(["task_1"]);
    fireEvent.click(screen.getByRole("button", { name: /Fix the login copy/ }));
    expect(container.textContent).toMatch(/toggle flips the page/);
  });

  it("shows the task as it is now on the dot, and keeps the ending the line reported in its words, adding what it is now", () => {
    // A failed task that was retried: the board runs it again.
    board.tasks = [boardTask("task_1", "in_progress")];
    const { container } = drawn([result("errored")], () => {});
    const dot = dotOf(container)!;
    expect(dot.getAttribute("aria-label")).toBe("running");
    expect(dot.className).toMatch(/bg-info/);
    expect(dot.className).toMatch(/animate-pulse/);
    expect(screen.getByRole("button", { name: /Fix the login copy/ }).textContent).toMatch(/failed · now running$/);
  });

  it("says nothing more than the line reported while the task still stands there", () => {
    board.tasks = [boardTask("task_1", "completed")];
    const { container } = drawn([result("completed")], () => {});
    expect(dotOf(container)!.getAttribute("aria-label")).toBe("done");
    expect(container.textContent).not.toMatch(/now/);
  });

  it("offers no Open task for a line whose task the board doesn't list, or in a task's own sheet", () => {
    board.tasks = [boardTask("task_other", "completed")];
    drawn([result("completed")], () => {});
    expect(screen.queryByRole("button", { name: "Open task" })).toBeNull();
    cleanup();
    board.tasks = [boardTask("task_1", "completed")];
    // A task's own sheet opens no task: its lines name tasks on another board.
    drawn([result("completed"), started]);
    expect(screen.queryByRole("button", { name: "Open task" })).toBeNull();
  });

  it("gives the line that started a task its words, its live dot and Open task", () => {
    board.tasks = [boardTask("task_1", "in_progress")];
    const opened: string[] = [];
    const { container } = drawn([started], (id) => opened.push(id));
    expect(container.textContent).toMatch(/Start a task: Fix the login copy/);
    expect(dotOf(container)!.getAttribute("aria-label")).toBe("running");
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(opened).toEqual(["task_1"]);
  });
});
