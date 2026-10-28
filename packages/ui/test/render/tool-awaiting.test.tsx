// @vitest-environment happy-dom
/**
 * A tool call waiting on an approval or a question reads as awaiting, not as
 * an error. The engine records the wait as a failed call coded `SUSPENSION`,
 * with the suspension's message as its error; drawn as an error, a user who already
 * answered sees the call as failed until the run's real result lands.
 *
 * Renders registry source the way `status-tokens.test.tsx` does.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it } from "vitest";
import { Tool, ToolGroup } from "../../registry/components/tool";

afterEach(cleanup);

const call = (name: string, extra: Partial<ToolOutputItem> = {}): ToolOutputItem =>
  ({
    id: name,
    type: "tool_output",
    status: "completed",
    blockName: name,
    requestId: "r",
    toolCall: { callId: name, name, arguments: "{}", generatorBlock: "g" },
    output: { ok: true },
    ...extra,
  }) as unknown as ToolOutputItem;

const waiting = call("setRepository", {
  status: "failed",
  output: undefined,
  error: { message: "Approve setting the repository?", code: "SUSPENSION" },
} as Partial<ToolOutputItem>);

describe("a tool call waiting on an answer", () => {
  it("says it is waiting, with no error", () => {
    render(<Tool item={waiting} />);
    const line = screen.getByTestId("tool-group");
    expect(line.getAttribute("data-state-kind")).toBe("waiting");
    fireEvent.click(screen.getByRole("button", { name: /\(waiting\)$/ }));
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.queryByText(/Approve setting the repository/)).toBeNull();
  });

  it("an ordinary failure still reads as an error", () => {
    render(<Tool item={call("setRepository", { status: "failed", output: undefined, error: { message: "boom" } } as Partial<ToolOutputItem>)} />);
    expect(screen.getByTestId("tool-group").getAttribute("data-state-kind")).toBe("error");
    fireEvent.click(screen.getByRole("button", { name: /\(failed\)$/ }));
    expect(screen.getAllByText("Error").length).toBeGreaterThan(0);
  });

  it("a group holding one waits, not completes", () => {
    render(<ToolGroup items={[call("listProjects"), waiting]} />);
    expect(screen.getByTestId("tool-group").getAttribute("data-state-kind")).toBe("waiting");
    expect(screen.getByRole("button", { name: /\(1 waiting\)$/ })).toBeTruthy();
  });
});
