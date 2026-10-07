// @vitest-environment happy-dom
/**
 * Tool calls are background: one call is a muted line ("Used discover"), a run
 * of calls is one line ("Used 3 tools"), and both open to the details on a click.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it } from "vitest";
import { Tool, ToolGroup } from "../src/components/flow-state/tool";

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
    render(<ToolGroup items={[call("discover")]} />);
    const line = screen.getByRole("button", { name: /Used discover/ });
    expect(screen.queryByText("Parameters")).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText("Parameters")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
  });

  it("a run of calls is one line with a count, and opens to one row per call", () => {
    render(<ToolGroup items={[call("discover"), call("createProject"), call("readMailbox")]} />);
    expect(screen.getAllByTestId("tool-group")).toHaveLength(1);
    expect(screen.queryByText("createProject")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Used 3 tools/ }));
    expect(screen.getByText("createProject")).toBeTruthy();
    expect(screen.getByText("readMailbox")).toBeTruthy();
  });

  it("says so in words while a call runs, and when it failed", () => {
    render(<ToolGroup items={[call("discover", "in_progress")]} />);
    expect(screen.getByRole("button", { name: /Using discover…/ })).toBeTruthy();
    cleanup();
    render(<Tool item={call("discover", "failed")} />);
    expect(screen.getByRole("button", { name: /discover failed/ })).toBeTruthy();
  });
});
