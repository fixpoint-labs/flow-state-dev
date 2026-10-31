// @vitest-environment happy-dom
/**
 * What a task's ending and its tool calls look like in a thread. A finished
 * background task is one short line, its title and status, because the task's
 * whole reply is already in its own view: printed again in the main thread it
 * buried the conversation. The line opens to show the reply. A tool call reads
 * as plain words, never a tool's name, a task id or `null`, which mean nothing
 * to the person reading.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
  const line = (name: string) => render(<Entry entry={{ kind: "tool", id: name, name }} />).container.textContent ?? "";

  it("says what happened in plain words", () => {
    expect(line("holdTaskForUser")).toMatch(/Waiting for your answer/);
    cleanup();
    expect(line("suspendForUser")).toMatch(/Sent for review/);
    cleanup();
    expect(line("createTask")).toMatch(/Started a task/);
  });

  it("never shows a tool's name, a task id or null", () => {
    for (const name of ["holdTaskForUser", "suspendForUser", "createTask", "getTask", "updateTask", "readProjectSource", "someNewTool"]) {
      const text = line(name);
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
      { id: "i3", type: "message", role: "assistant", requestId: "r2", agentName: "desk.thread", content: [{ type: "output_text", text: reply }] },
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "assistant", "result"]);
    expect(entries[2]).toMatchObject({ kind: "result", title: "Answer from thread", status: "completed", summary: reply });
  });
});
