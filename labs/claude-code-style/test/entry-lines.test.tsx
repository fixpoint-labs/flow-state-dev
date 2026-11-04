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
import { Entry } from "../src/components/Entry";

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
