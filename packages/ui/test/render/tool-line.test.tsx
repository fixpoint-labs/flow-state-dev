// @vitest-environment happy-dom
/**
 * A run of tool calls is one quiet line labelled by what the agent said it
 * was doing, so ten Bash calls read as one line, not ten cards.
 *
 * Renders registry source, which imports shadcn primitives through `@/`; the
 * vitest config aliases those to Storybook's stubs, the way Storybook builds.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tool, ToolGroup } from "../../registry/components/tool";
import { toolItem } from "../../stories/fixtures/items";

afterEach(cleanup);

const bash = (description: string | undefined, status: "completed" | "in_progress" | "failed" = "completed") =>
  toolItem({ name: "Bash", args: { command: "pnpm test", ...(description ? { description } : {}) }, status });

describe("tool calls as quiet lines", () => {
  it("collapses ten consecutive calls into one line that opens to each call", () => {
    const items = Array.from({ length: 10 }, (_, i) => bash(`Step ${i + 1}`));
    render(<ToolGroup items={items} />);
    expect(screen.getAllByTestId("tool-group")).toHaveLength(1);
    expect(screen.queryAllByTestId("tool-row")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Step 1 · Step 2 · Step 3 · \+7 more/ }));
    expect(screen.getAllByTestId("tool-row")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Step 10" })).toBeTruthy();
  });

  it("labels a Bash call by its description while it runs and when done", () => {
    render(<Tool item={bash("Run the unit tests", "in_progress")} />);
    expect(screen.getByRole("button", { name: /^Run the unit tests…/ })).toBeTruthy();
    cleanup();
    render(<Tool item={bash("Run the unit tests")} />);
    expect(screen.getByRole("button", { name: /^Run the unit tests$/ })).toBeTruthy();
  });

  it("names the call in flight while a run is still going", () => {
    render(<ToolGroup items={[bash("List files"), bash("Run the unit tests", "in_progress")]} />);
    expect(screen.getByRole("button", { name: /^Run the unit tests…/ })).toBeTruthy();
  });

  it("keeps the name-based label for calls that state no intent", () => {
    render(<ToolGroup items={[toolItem({ name: "web_search" }), toolItem({ name: "web_search" })]} />);
    expect(screen.getByRole("button", { name: /^Ran 2 searches$/ })).toBeTruthy();
    cleanup();
    render(<Tool item={bash(undefined)} />);
    expect(screen.getByRole("button", { name: /^Ran `Bash`$/ })).toBeTruthy();
  });

  it("says a call failed in words, since there is no badge", () => {
    render(<ToolGroup items={[bash("List files"), bash("Run the unit tests", "failed")]} />);
    const line = screen.getByTestId("tool-group");
    expect(line.getAttribute("data-state-kind")).toBe("error");
    expect(screen.getByRole("button", { name: /List files · Run the unit tests \(1 failed\)/ })).toBeTruthy();
  });

  it("keeps a call's details closed until its line is opened", () => {
    const item = toolItem({ name: "Bash", args: { command: "ls", description: "List files" }, output: "src\ntest" });
    render(<Tool item={item} />);
    expect(screen.queryByText("Parameters")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /List files/ }));
    expect(screen.getByText("Parameters")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
  });
});
