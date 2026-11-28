/**
 * A block's detail opens under its own row in the Trace tab, not in the right
 * rail. The rail sits below the session's resource lists, so a detail there is
 * off-screen for any real session; under the row it is where the eye already
 * is. These tests pin the row as the toggle (click, Enter, Space), the detail
 * as a sibling directly beneath its row, and the rail's block panel staying
 * out of the Trace tab while still serving a block selected from elsewhere.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React, { useEffect } from "react";
import type { BlockTraceItem } from "@flow-state-dev/core/items";

import { TraceView } from "../src/react/components/workspace/trace-view";
import type { RequestGroup } from "../src/react/components/workspace/stream-view";
import { ItemDetail } from "../src/react/components/detail/item-detail";
import { DebugProvider } from "../src/react/context/debug-context";
import { SelectionProvider, useSelection } from "../src/react/context/selection-context";
import { buildTraceTree, type TraceNode } from "../src/react/lib/trace-tree";

function blockTrace(name: string, overrides: Partial<BlockTraceItem> = {}): BlockTraceItem {
  return {
    id: `trace-${name}`,
    type: "block_trace",
    status: "completed",
    requestId: "req-1",
    itemIndex: 0,
    ts: 1,
    provenance: { blockName: name, blockInstanceId: `inst-${name}`, phase: "main" },
    blockName: name,
    blockKind: "handler",
    blockInstanceId: `inst-${name}`,
    output: { kind: "inline", value: { verdict: `${name}-verdict` } },
    ...overrides,
  } as BlockTraceItem;
}

function group(items: BlockTraceItem[]): RequestGroup {
  return { requestId: "req-1", action: "respond", status: "completed", startedAt: 1, items } as RequestGroup;
}

const groups = [group([blockTrace("steer-next"), blockTrace("decide", { itemIndex: 1 })])];

/** The Trace tab as the panel lays it out: the tree, and the rail beside it. */
function renderTraceTab() {
  return render(
    <DebugProvider>
      <SelectionProvider>
        <TraceView requestGroups={groups} />
        <aside data-testid="rail">
          <ItemDetail blockDetailInline />
        </aside>
      </SelectionProvider>
    </DebugProvider>,
  );
}

function openRequest() {
  // A completed request that was never active renders collapsed.
  fireEvent.click(screen.getByText("respond"));
}

function toggleFor(name: string): HTMLElement {
  // The name also shows in an open detail's header; the row is the toggle.
  const toggle = screen
    .getAllByText(name)
    .map((el) => el.closest("[aria-expanded]"))
    .find((el): el is HTMLElement => el instanceof HTMLElement);
  if (!toggle) throw new Error(`no toggle for ${name}`);
  return toggle;
}

/** The detail a row controls, or null while it is closed. */
function detailOf(toggle: HTMLElement): HTMLElement | null {
  return document.getElementById(toggle.getAttribute("aria-controls") ?? "");
}

describe("Trace tab — block detail expands under its row", () => {
  it("clicking a row opens its detail directly beneath that row, and clicking again closes it", () => {
    renderTraceTab();
    openRequest();
    const toggle = toggleFor("steer-next");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(detailOf(toggle)).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = detailOf(toggle);
    expect(detail).not.toBeNull();
    // Directly beneath the row, and above the next block's row.
    expect(toggle.nextElementSibling).toBe(detail);
    expect(detail!.compareDocumentPosition(toggleFor("decide")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It carries the block's detail: status, the output value, the copy button.
    expect(within(detail!).getByText("completed")).toBeInTheDocument();
    expect(within(detail!).getByText(/steer-next-verdict/)).toBeInTheDocument();
    expect(within(detail!).getByTitle("Copy block detail")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(detailOf(toggle)).toBeNull();
  });

  it("keeps one detail open at a time: opening another row closes the first", () => {
    renderTraceTab();
    openRequest();
    fireEvent.click(toggleFor("steer-next"));
    fireEvent.click(toggleFor("decide"));

    expect(toggleFor("steer-next")).toHaveAttribute("aria-expanded", "false");
    expect(detailOf(toggleFor("steer-next"))).toBeNull();
    expect(toggleFor("decide")).toHaveAttribute("aria-expanded", "true");
    expect(within(detailOf(toggleFor("decide"))!).getByText(/decide-verdict/)).toBeInTheDocument();
  });

  it("toggles from the keyboard with Enter and Space", () => {
    renderTraceTab();
    openRequest();
    const toggle = toggleFor("steer-next");
    expect(toggle).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(detailOf(toggle)).not.toBeNull();

    fireEvent.keyDown(toggle, { key: " " });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(detailOf(toggle)).toBeNull();
  });

  it("does not render the block panel in the rail on the Trace tab", () => {
    renderTraceTab();
    openRequest();
    fireEvent.click(toggleFor("steer-next"));

    const rail = screen.getByTestId("rail");
    expect(within(rail).queryByTitle("Copy block detail")).toBeNull();
    expect(within(rail).queryByText("steer-next")).toBeNull();
  });
});

function SelectAndShow({ node }: { node: TraceNode }) {
  const { selectBlock } = useSelection();
  useEffect(() => selectBlock(node), [node, selectBlock]);
  return <ItemDetail />;
}

describe("Rail block panel outside the Trace tab", () => {
  it("still shows a block selected from another tab (a ref badge in the Stream)", () => {
    const node = buildTraceTree(groups)[0].children.find(
      (n): n is TraceNode => n.type === "block" && n.blockName === "steer-next",
    );
    if (!node) throw new Error("fixture block missing");
    render(
      <SelectionProvider>
        <SelectAndShow node={node} />
      </SelectionProvider>,
    );
    expect(screen.getByText("steer-next")).toBeInTheDocument();
  });
});
