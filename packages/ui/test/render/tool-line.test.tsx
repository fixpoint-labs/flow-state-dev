// @vitest-environment happy-dom
/**
 * A run of tool calls is one quiet line labelled by what the agent said it
 * was doing, so ten Bash calls read as one line, not ten cards.
 *
 * Renders registry source, which imports shadcn primitives through `@/`; the
 * vitest config aliases those to Storybook's stubs, the way Storybook builds.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tool, ToolGroup } from "../../registry/components/tool";
import { reasoningItem, toolItem } from "../../stories/fixtures/items";

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
    render(<Tool item={toolItem({ name: "custom_tool", args: { foo: 1 } })} />);
    expect(screen.getByRole("button", { name: /^Ran `custom_tool`$/ })).toBeTruthy();
    cleanup();
    // A shell call with no stated intent is named by its command, not "Bash".
    render(<Tool item={bash(undefined)} />);
    expect(screen.getByRole("button", { name: /^pnpm test$/ })).toBeTruthy();
  });

  it("says a call failed in words, since there is no badge", () => {
    render(<ToolGroup items={[bash("List files"), bash("Run the unit tests", "failed")]} />);
    const line = screen.getByTestId("tool-group");
    expect(line.getAttribute("data-state-kind")).toBe("error");
    expect(screen.getByRole("button", { name: /List files · Run the unit tests \(1 failed\)/ })).toBeTruthy();
  });

  // Agents fail a call and move on all the time (a search with no match exits
  // non-zero). A failure is said in words; it isn't an alarm on the whole run.
  it("says a call failed without turning the line or its output red", () => {
    const failed = toolItem({
      name: "Bash",
      args: { command: "rg nothing", description: "Search" },
      status: "failed",
      output: "no matches",
    });
    const red = ".text-destructive, .bg-destructive\\/10";
    const group = render(<ToolGroup items={[bash("List files"), failed]} />);
    expect(screen.getByRole("button", { name: /\(1 failed\)/ })).toBeTruthy();
    expect(group.container.querySelector(red)).toBeNull();
    cleanup();
    const single = render(<Tool item={failed} />);
    fireEvent.click(screen.getByRole("button", { name: /Search \(failed\)/ }));
    expect(screen.getByText("no matches")).toBeTruthy();
    expect(single.container.querySelector(red)).toBeNull();
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

// An agent's working is one stretch of activity: its thinking and its calls.
// Collapsed it is one quiet line that says what the agent is doing now, so the
// reader sees progress without reading every step.
describe("a stretch of thinking and tool calls as one line", () => {
  const shell = (status: "completed" | "in_progress" | "failed" = "completed") =>
    toolItem({ name: "shell", args: { command: "git log" }, status });

  it("is one collapsed line for thinking between calls, labelled by the calls", () => {
    const items = [reasoningItem({ text: "Check the log." }), shell(), reasoningItem({ text: "Now the diff." }), shell()];
    render(<ToolGroup items={items} />);
    expect(screen.getAllByTestId("tool-group")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Ran `shell` 2 times$/ })).toBeTruthy();
    // Collapsed: neither the thoughts nor the calls are on screen.
    expect(screen.queryByText("Check the log.")).toBeNull();
    expect(screen.queryAllByTestId("tool-row")).toHaveLength(0);
  });

  it("opens to each step in order, thoughts included", () => {
    const items = [reasoningItem({ text: "Check the log." }), shell()];
    render(<ToolGroup items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /Ran `shell`/ }));
    const rows = screen.getAllByTestId("tool-row");
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Thought"), expect.stringContaining("git log")]);
    fireEvent.click(within(rows[0]!).getByRole("button"));
    expect(screen.getByText("Check the log.")).toBeTruthy();
  });

  it("says what the agent is doing now while it works: the call in flight, or Thinking…", () => {
    render(<ToolGroup items={[shell(), reasoningItem({ status: "in_progress" })]} />);
    expect(screen.getByRole("button", { name: /^Thinking…/ })).toBeTruthy();
    cleanup();
    render(<ToolGroup items={[reasoningItem(), shell("in_progress")]} />);
    expect(screen.getByRole("button", { name: /^git log…/ })).toBeTruthy();
  });

  it("is a quiet 'Thought' for thinking with no call, opening to the thought", () => {
    render(<ToolGroup items={[reasoningItem({ text: "Hm." })]} />);
    expect(screen.getByRole("button", { name: /^Thought$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Thought$/ }));
    expect(screen.getByText("Hm.")).toBeTruthy();
    cleanup();
    render(<ToolGroup items={[reasoningItem({ status: "in_progress" })]} />);
    expect(screen.getByRole("button", { name: /^Thinking…/ })).toBeTruthy();
  });

  it("is not an error because it holds thinking: a failed call still says so", () => {
    render(<ToolGroup items={[reasoningItem(), shell("failed")]} />);
    expect(screen.getByTestId("tool-group").getAttribute("data-state-kind")).toBe("error");
    expect(screen.getByRole("button", { name: /\(1 failed\)/ })).toBeTruthy();
    cleanup();
    render(<ToolGroup items={[reasoningItem(), shell()]} />);
    expect(screen.getByTestId("tool-group").getAttribute("data-state-kind")).toBe("completed");
  });

  // A bare tool name is set in mono, a thought in sans; side by side in one
  // opened run they must read at one size.
  it("sets a tool's name and a thought at the same size when a run is opened", () => {
    render(<ToolGroup items={[reasoningItem({ text: "Check." }), shell()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Ran `shell`/ }));
    const [thought, call] = screen.getAllByTestId("tool-row").map((row) => within(row).getByRole("button").firstElementChild!);
    expect(call.className).toContain("font-mono");
    expect(call.className).not.toMatch(/\btext-(xs|base|lg)\b/);
    expect(thought!.className).not.toMatch(/\btext-(xs|base|lg)\b/);
  });

  // Five reads of five files must not read as "read, read, read".
  it("names each call by what it acted on, so repeated calls to one tool differ", () => {
    const read = (path: string) => toolItem({ name: "read", args: { path } });
    const grep = toolItem({ name: "grep", args: { pattern: "ToolGroup", path: "src" } });
    render(<ToolGroup items={[read("src/a.ts"), read("src/b.ts"), grep, shell()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Read 2 files|read 2 files/i }));
    const labels = screen.getAllByTestId("tool-row").map((row) => within(row).getByRole("button").textContent);
    expect(labels).toEqual(["Read src/a.ts", "Read src/b.ts", 'Grep "ToolGroup"', "git log"]);
  });

  // Between calls nothing is "running", but the agent still is: the line must
  // show the latest step, not the run's tally.
  it("names the latest step while live, even when every call has settled", () => {
    const read = toolItem({ name: "read", args: { path: "src/a.ts" } });
    const grep = toolItem({ name: "grep", args: { pattern: "ToolGroup" } });
    render(<ToolGroup items={[shell(), read, grep]} live />);
    expect(screen.getByRole("button", { name: /^Grep "ToolGroup"$/ })).toBeTruthy();
    cleanup();
    render(<ToolGroup items={[shell(), read, grep]} />);
    expect(screen.getByRole("button", { name: /^Ran `shell`, read a file, and ran `grep`$/ })).toBeTruthy();
    cleanup();
    render(<ToolGroup items={[shell(), reasoningItem()]} live />);
    expect(screen.getByRole("button", { name: /^Thought$/ })).toBeTruthy();
  });

  // The thought is the status: what the agent is thinking, not that it thinks.
  it("shows the latest thought's first line as the status, else Thinking…", () => {
    const thinking = reasoningItem({ text: "**Checking the diff**\nThen the tests.", status: "in_progress" });
    render(<ToolGroup items={[shell(), thinking]} />);
    expect(screen.getByRole("button", { name: /^Checking the diff…$/ })).toBeTruthy();
    cleanup();
    render(<ToolGroup items={[shell(), reasoningItem({ text: "Now the tests." })]} live />);
    expect(screen.getByRole("button", { name: /^Now the tests\.$/ })).toBeTruthy();
    cleanup();
    render(<ToolGroup items={[shell(), reasoningItem({ text: "  ", status: "in_progress" })]} />);
    expect(screen.getByRole("button", { name: /^Thinking…$/ })).toBeTruthy();
  });

  // A stream that dropped mid-thought leaves the thought `incomplete`. The request is over, so the
  // line must not keep saying the agent is thinking.
  it("treats a thought that ended unfinished as over, not as still thinking", () => {
    render(<ToolGroup items={[reasoningItem({ text: "Hm.", status: "incomplete" })]} />);
    expect(screen.getByTestId("tool-group").getAttribute("data-state-kind")).toBe("completed");
    expect(screen.getByRole("button", { name: /^Thought$/ })).toBeTruthy();
  });
});
