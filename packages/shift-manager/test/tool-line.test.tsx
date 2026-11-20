// @vitest-environment happy-dom
/**
 * Shift Manager's tool calls read in the registry's words, as the other apps'
 * do: a run of calls is one line that opens to one row per call, a call that
 * stopped to wait says it waits rather than that it failed, and a failed call
 * a later call of the same tool redid reads as an attempt, so the run doesn't
 * read as failed for it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it } from "vitest";
import { conversationLines, FlowProvider, ItemsRenderer } from "@flow-state-dev/react";
import { shiftManagerRenderers } from "../src/components/lines";
import { ToolGroup } from "../src/components/flow-state/tool";

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

/** The calls as Shift Manager's conversation draws them. */
const drawCalls = (items: ToolOutputItem[]) =>
  render(
    <FlowProvider renderers={shiftManagerRenderers}>
      <ItemsRenderer lines={conversationLines(items, [], { renderers: shiftManagerRenderers })} toolGroupRenderer={ToolGroup} />
    </FlowProvider>,
  );
const group = () => screen.getByTestId("tool-group");

describe("a worker's tool calls", () => {
  it("are one line for a run, opening to one row per call with its input and result", () => {
    drawCalls([call("discover"), call("createProject"), call("readNotes")]);
    expect(screen.getAllByTestId("tool-group")).toHaveLength(1);
    expect(screen.queryAllByTestId("tool-row")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Ran `discover`, ran `createProject`, and ran `readNotes`" }));
    expect(screen.getAllByTestId("tool-row")).toHaveLength(3);
  });

  it("say a call that stopped to wait waits, not that it failed", () => {
    const waiting = { ...call("setRepository", "failed"), error: { message: "Approve setting the repository?", code: "SUSPENSION" } } as ToolOutputItem;
    drawCalls([waiting]);
    expect(group().getAttribute("data-state-kind")).not.toBe("error");
    expect(group().textContent).toContain("(waiting)");
  });

  it("read a failed call a later call of the same tool redid as tried, and the run as done", () => {
    drawCalls([call("openWorkstream", "failed", "first"), call("listLeads"), call("openWorkstream", "completed", "retry")]);
    expect(group().getAttribute("data-state-kind")).toBe("completed");
    fireEvent.click(screen.getByRole("button", { name: "Ran `openWorkstream` 2 times and ran `listLeads`" }));
    expect(screen.getByText("Tried openWorkstream")).toBeTruthy();
    cleanup();
    // No successful redo: the same tool failing again leaves the failure a failure.
    drawCalls([call("openWorkstream", "failed", "first"), call("listLeads"), call("openWorkstream", "failed", "again")]);
    expect(group().getAttribute("data-state-kind")).toBe("error");
  });
});
