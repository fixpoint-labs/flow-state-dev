// @vitest-environment happy-dom
/**
 * What a task's ending and its tool calls look like in a thread. A finished
 * background task is one short line, its title and status, because the task's
 * whole reply is already in its own view: printed again in the main thread it
 * buried the conversation. The line opens to show the reply. A tool call reads
 * as plain words naming what it acted on and whether it worked, never a tool's
 * name, a task id or `null`, which mean nothing to whoever reads it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { delegateAnswerMetadata } from "@flow-state-dev/workforce/browser";
import type { LabTask } from "../src/adapter";
import { Entry } from "../src/components/Entry";
import { filedTaskOf, toolRun } from "../src/lib/tool-steps";

afterEach(cleanup);

const REPLY = "## Findings\n\nThe toggle flips the page between light and dark, and the choice is kept across reloads.";

describe("a background result in the thread", () => {
  it("is one collapsed line with its title and status, which opens to the reply", () => {
    const { container } = render(
      <Entry entry={{ kind: "result", id: "r1", taskId: "task_65904", title: "Review PR #4272", status: "completed", summary: REPLY, duringTurn: false }} />,
    );
    const line = screen.getByRole("button", { name: /Review PR #4272/ });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(line.textContent).toMatch(/Review PR #4272.*done/);
    expect(container.textContent).not.toMatch(/toggle flips the page/);
    expect(container.textContent).not.toMatch(/task_65904/);
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
    toolCall: { name, arguments: JSON.stringify(args) },
    output,
  });
  const drawn = async (items: object[]) => {
    const { entriesOf } = await import("../src/adapter");
    const entries = entriesOf(items as never);
    const { container } = render(<>{entries.map((entry) => <Entry key={entry.id} entry={entry} />)}</>);
    return { entries, container };
  };

  it("names what it acted on and what it found, from the call and its result", async () => {
    const { container } = await drawn([
      call("t1", "readProjectSource", { path: "src/billing/ledger.ts" }, { kind: "read", status: "ok", text: "…" }),
      call("t2", "grepProjectSource", { pattern: "LEDGER_CODE" }, { kind: "grep", matches: [] }, "r2"),
      call("t3", "createTask", { title: "Fix the login copy", goal: "…" }, { ok: true, taskId: "task_1" }, "r3"),
    ]);
    const lines = [...container.querySelectorAll('[data-entry="tool"]')].map((el) => el.textContent);
    expect(lines).toEqual(["▸ Read src/billing/ledger.ts", '▸ Search "LEDGER_CODE" · no matches', "▸ Start a task: Fix the login copy"]);
  });

  it("says a read the project refused failed, in words and in the lab's red, and a search that found nothing did not", async () => {
    const { container } = await drawn([
      call("t1", "readProjectSource", { path: "README.md" }, { kind: "refused", reason: "not-a-member", message: "…" }),
      call("t2", "grepProjectSource", { pattern: "NOWHERE" }, { kind: "grep", matches: [] }, "r2"),
    ]);
    const [refused, empty] = [...container.querySelectorAll<HTMLElement>('[data-entry="tool"]')];
    expect(refused!.textContent).toBe("▸ Read README.md (failed)");
    expect(refused!.className).toMatch(/text-destructive/);
    expect(empty!.textContent).not.toMatch(/failed/);
    expect(empty!.className).not.toMatch(/text-destructive/);
  });

  it("says a call waiting on you is waiting, not failed", async () => {
    // A worker that stops for your review is recorded as a failed call whose error is the suspension.
    const { container } = await drawn([
      { ...call("t1", "suspendForUser", { kind: "review", title: "Check the copy" }, undefined, "r1", "failed"), error: { code: "SUSPENSION", message: "suspended" } },
    ]);
    const line = container.querySelector<HTMLElement>('[data-entry="tool"]')!;
    expect(line.dataset.state).toBe("waiting");
    expect(line.textContent).toMatch(/\(waiting\)$/);
    expect(line.textContent).not.toMatch(/failed/);
    expect(line.className).not.toMatch(/text-destructive/);
  });

  it("folds a finished turn's run of calls into one line, which opens to each call", async () => {
    const { entries, container } = await drawn([
      call("t1", "readProjectSource", { path: "src/a.ts" }, { kind: "read", status: "ok" }),
      call("t2", "readProjectSource", { path: "src/b.ts" }, { kind: "read", status: "missing" }),
      call("t3", "readProjectSource", { path: "README.md" }, { kind: "read", status: "ok" }),
    ]);
    expect(entries).toHaveLength(1);
    const line = screen.getByRole("button");
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(line.textContent).toMatch(/files \(1 failed\)$/);
    expect(container.textContent).not.toMatch(/src\/a\.ts/);
    fireEvent.click(line);
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Read src/a.ts", "Read src/b.ts (failed)", "Read README.md"]);
  });

  it("keeps two turns' calls apart", async () => {
    const { entries } = await drawn([
      call("t1", "readProjectSource", { path: "src/a.ts" }, { kind: "read", status: "ok" }),
      call("t2", "readProjectSource", { path: "src/b.ts" }, { kind: "read", status: "ok" }, "r2"),
    ]);
    expect(entries).toHaveLength(2);
  });

  it("never shows a tool's name, a task id or null, for any of the workforce and task tools", async () => {
    const tools = [
      "createTask", "getTask", "updateTask", "listTasks", "holdTaskForUser", "suspendForUser", "sendMessage",
      "reportProgress", "consultSessionHistory", "globProjectSource", "readProjectSource", "grepProjectSource",
    ];
    for (const name of tools) {
      const { container } = await drawn([call("t1", name, { taskId: "task_9" }, { ok: true, taskId: "task_9", task: null })]);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(new RegExp(name));
      expect(text).not.toMatch(/task_|null/);
      cleanup();
    }
  });
});

describe("a delegate's answer that landed in the conversation as written", () => {
  it("is a result line under the delegate's name, not the main session's own words", async () => {
    const { entriesOf } = await import("../src/adapter");
    const reply = "- Apply the theme before first paint.\n- Label the icon-only mark.";
    const entries = entriesOf([
      { id: "i1", type: "message", role: "user", requestId: "r1", content: [{ type: "output_text", text: "Review PR #4272" }] },
      { id: "i2", type: "message", role: "assistant", requestId: "r1", agentName: "coordinator-judgment", content: [{ type: "output_text", text: "Started a review thread." }] },
      { id: "i3", type: "message", role: "assistant", requestId: "r2", agentName: "desk.thread", content: [{ type: "output_text", text: reply }], metadata: delegateAnswerMetadata({ worker: "desk.thread", taskId: "task_1" }) },
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "assistant", "result"]);
    expect(entries[2]).toMatchObject({ kind: "result", title: "Answer from thread", status: "completed", summary: reply });
  });
});

describe("a line that names a task", () => {
  // Only what the lines read of a row: its id, title and status.
  const row = (id: string, status: LabTask["status"]): LabTask => ({ id, title: "Fix the login copy", goal: "…", status });
  const result = (status: LabTask["status"]) =>
    ({ kind: "result", id: "r1", taskId: "task_1", title: "Fix the login copy", status, summary: REPLY, duringTurn: false }) as const;
  const startLine = toolRun([{ id: "c1", name: "createTask", args: { title: "Fix the login copy", goal: "…" }, status: "done", output: { ok: true, taskId: "task_1" } }]);
  const dotOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-task-dot]");

  it("opens its task from the result line, beside the fold, which still opens to the reply", () => {
    const opened: string[] = [];
    const { container } = render(<Entry entry={result("completed")} tasks={{ rows: [row("task_1", "completed")], open: (id) => opened.push(id) }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(opened).toEqual(["task_1"]);
    fireEvent.click(screen.getByRole("button", { name: /Fix the login copy/ }));
    expect(container.textContent).toMatch(/toggle flips the page/);
  });

  it("shows the task as it is now on the dot, and keeps the ending the line reported in its words, adding what it is now", () => {
    // A failed task that was retried: the board's row runs again.
    const { container } = render(<Entry entry={result("errored")} tasks={{ rows: [row("task_1", "in_progress")], open: () => {} }} />);
    const dot = dotOf(container)!;
    expect(dot.getAttribute("aria-label")).toBe("running");
    expect(dot.className).toMatch(/bg-info/);
    expect(dot.className).toMatch(/animate-pulse/);
    expect(screen.getByRole("button", { name: /Fix the login copy/ }).textContent).toMatch(/failed · now running$/);
  });

  it("says nothing more than the line reported while the task still stands there", () => {
    const { container } = render(<Entry entry={result("completed")} tasks={{ rows: [row("task_1", "completed")], open: () => {} }} />);
    expect(dotOf(container)!.getAttribute("aria-label")).toBe("done");
    expect(container.textContent).not.toMatch(/now/);
  });

  it("offers no Open task for a line whose task the board doesn't list, or in a task's own sheet", () => {
    render(<Entry entry={result("completed")} tasks={{ rows: [row("task_other", "completed")], open: () => {} }} />);
    expect(screen.queryByRole("button", { name: "Open task" })).toBeNull();
    cleanup();
    render(<Entry entry={result("completed")} />);
    expect(screen.queryByRole("button", { name: "Open task" })).toBeNull();
    cleanup();
    render(<Entry entry={{ kind: "tool", id: "t1", ...startLine }} />);
    expect(screen.queryByRole("button", { name: "Open task" })).toBeNull();
  });

  it("gives the line that started a task its live dot and Open task, alone or in an opened run", () => {
    const opened: string[] = [];
    const tasks = { rows: [row("task_1", "in_progress")], open: (id: string) => opened.push(id) };
    const { container } = render(<Entry entry={{ kind: "tool", id: "t1", ...startLine }} tasks={tasks} />);
    expect(container.textContent).toMatch(/Start a task: Fix the login copy/);
    expect(dotOf(container)!.getAttribute("aria-label")).toBe("running");
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(opened).toEqual(["task_1"]);
    cleanup();

    const run = toolRun([
      { id: "c0", name: "readProjectSource", args: { path: "README.md" }, status: "done", output: { kind: "read", status: "ok" } },
      { id: "c1", name: "createTask", args: { title: "Fix the login copy", goal: "…" }, status: "done", output: { ok: true, taskId: "task_1" } },
    ]);
    render(<Entry entry={{ kind: "tool", id: "t2", ...run }} tasks={tasks} />);
    fireEvent.click(screen.getByRole("button", { name: /Read/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(opened).toEqual(["task_1", "task_1"]);
  });

  it("reads the task a start line filed by one rule: an ok createTask result with its id", () => {
    expect(filedTaskOf({ id: "c", name: "createTask", args: {}, status: "done", output: { ok: true, taskId: "task_1" } })).toBe("task_1");
    expect(filedTaskOf({ id: "c", name: "createTask", args: {}, status: "done", output: { ok: false, error: "refused" } })).toBeUndefined();
    expect(filedTaskOf({ id: "c", name: "updateTask", args: {}, status: "done", output: { ok: true, taskId: "task_1" } })).toBeUndefined();
    expect(startLine.steps[0]!.taskId).toBe("task_1");
  });
});
