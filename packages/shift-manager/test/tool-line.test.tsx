// @vitest-environment happy-dom
/**
 * Tool calls are background: one call is a muted line ("Used discover"), a run
 * of calls is one line ("Used 3 tools"), and both open to the details on a click.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it } from "vitest";
import { buildItemRenderStream } from "@flow-state-dev/react";
import { callRuns, ToolLine, ToolLineGroup } from "../src/components/ToolLine";

afterEach(() => cleanup());

const call = (name: string, status: "completed" | "in_progress" | "failed" = "completed", id = name): ToolOutputItem =>
  ({
    id,
    type: "tool_output",
    status,
    blockName: name,
    requestId: "r",
    toolCall: { callId: id, name, arguments: JSON.stringify({ q: "who is on call" }), generatorBlock: "g" },
    output: { answer: "eng.em" },
  }) as unknown as ToolOutputItem;

describe("a tool call is a quiet line", () => {
  it("one call says what was used, and its details stay closed until clicked", () => {
    render(<ToolLineGroup items={[call("discover")]} />);
    const line = screen.getByRole("button", { name: /Used discover/ });
    expect(screen.queryByText("Parameters")).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText("Parameters")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
  });

  it("a run of calls is one line with a count, and opens to one row per call", () => {
    render(<ToolLineGroup items={[call("discover"), call("createProject"), call("readNotes")]} />);
    expect(screen.getAllByTestId("tool-group")).toHaveLength(1);
    expect(screen.queryByText("Used createProject")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Used 3 tools/ }));
    expect(screen.getByText("Used createProject")).toBeTruthy();
    expect(screen.getByText("Used readNotes")).toBeTruthy();
  });

  it("says so in words while a call runs, and when it failed", () => {
    render(<ToolLineGroup items={[call("discover", "in_progress")]} />);
    expect(screen.getByRole("button", { name: /Using discover…/ })).toBeTruthy();
    cleanup();
    render(<ToolLine item={call("discover", "failed")} />);
    expect(screen.getByRole("button", { name: /discover failed/ })).toBeTruthy();
  });

  it("a call that stopped to wait says it waits, not that it failed, and shows no error", () => {
    const waiting = { ...call("setRepository", "failed"), error: { message: "Approve setting the repository?", code: "SUSPENSION" } } as ToolOutputItem;
    render(<ToolLine item={waiting} />);
    const line = screen.getByRole("button", { name: /setRepository is waiting/ });
    expect(screen.queryByText(/setRepository failed/)).toBeNull();
    fireEvent.click(line);
    expect(screen.queryByText(/Approve setting the repository/)).toBeNull();
    cleanup();
    render(<ToolLineGroup items={[call("listProjects"), waiting]} />);
    expect(screen.getByRole("button", { name: /Used 2 tools, one waiting/ })).toBeTruthy();
  });
  it("a failed call a later call of the same tool completed reads as an attempt, and the run doesn't read as failed", () => {
    const run = [call("openWorkstream", "failed", "first"), call("listLeads"), call("openWorkstream", "completed", "retry")];
    render(<ToolLineGroup items={run} />);
    const line = screen.getByRole("button", { name: /^Used 3 tools$/ });
    expect(line.querySelector(".text-destructive")).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText("Tried openWorkstream")).toBeTruthy();
    expect(screen.queryByText("openWorkstream failed")).toBeNull();
    cleanup();
    // No successful retry: another tool completing, or the same tool failing again, leaves the failure a failure.
    render(<ToolLineGroup items={[call("openWorkstream", "failed", "first"), call("listLeads"), call("openWorkstream", "failed", "again")]} />);
    expect(screen.getByRole("button", { name: /one failed/ })).toBeTruthy();
    cleanup();
    render(<ToolLineGroup items={[call("openWorkstream", "failed", "first"), call("listLeads")]} />);
    expect(screen.getByRole("button", { name: /one failed/ })).toBeTruthy();
  });
});

// The renderer groups an agent's thinking and calls into one stretch; Shift
// Manager draws only the calls as quiet lines and leaves the thinking as it was.
describe("a feed of calls keeps its thinking where it was", () => {
  const thought = (id: string) =>
    ({ id, type: "reasoning", status: "completed", requestId: "r", summary: [{ type: "reasoning_text", text: "hm" }] }) as never;
  const said = (id: string) => ({ id, type: "message", status: "completed", requestId: "r", role: "assistant", content: [] }) as never;

  it("splits a stretch back into runs of calls and the thoughts between them", () => {
    const stream = buildItemRenderStream(
      [thought("r1"), call("a", "completed", "a"), call("b", "completed", "b"), thought("r2"), call("c", "completed", "c"), said("m1")],
      undefined,
      { groupToolCalls: true },
    );
    const runs = callRuns(stream).map((s) => (s.kind === "group" ? `calls:${s.items.map((i) => i.id).join(",")}` : s.item.id));
    expect(runs).toEqual(["r1", "calls:a,b", "r2", "calls:c", "m1"]);
  });
});
