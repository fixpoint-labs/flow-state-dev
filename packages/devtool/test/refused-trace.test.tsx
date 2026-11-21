/**
 * A refused block in the DevTool: a tool that declined on a precondition (a
 * `refused`-coded error, such as a workstream write on a session that leads no
 * workstream) reads as refused, in ink, with its reason and the whole error a
 * click away. A block that broke stays red. The difference matters because the
 * refusal did not stop the request: drawn red, it reads as the task failing.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useEffect } from "react";
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";
import { REFUSED_ERROR_CODE } from "@flow-state-dev/core/items";
import { buildTraceTree, type TraceNode } from "../src/react/lib/trace-tree";
import { TraceView } from "../src/react/components/workspace/trace-view";
import { ItemDetail } from "../src/react/components/detail/item-detail";
import { BlockTraceItemView } from "../src/react/components/items/block-output-item";
import type { RequestGroup } from "../src/react/components/workspace/stream-view";
import { DebugProvider } from "../src/react/context/debug-context";
import { SelectionProvider, useSelection } from "../src/react/context/selection-context";

const REFUSAL_MESSAGE = "not-a-workstream-session: this session leads no workstream, so there is none to update.";

function failedTrace(name: string, error: BlockTraceItem["error"]): BlockTraceItem {
  return {
    id: `trace-${name}`,
    type: "block_trace",
    status: "failed",
    requestId: "req-1",
    itemIndex: 0,
    ts: 1,
    provenance: { blockName: name, blockInstanceId: `inst-${name}`, phase: "main" },
    blockName: name,
    blockKind: "handler",
    blockInstanceId: `inst-${name}`,
    startedAt: 1,
    completedAt: 5,
    duration: 4,
    error,
  } as BlockTraceItem;
}

const refusedTrace = failedTrace("updateWorkstream", {
  message: REFUSAL_MESSAGE,
  code: REFUSED_ERROR_CODE,
  details: { reason: "not-a-workstream-session" },
});
const brokenTrace = failedTrace("fetchPage", { message: "socket hang up", code: "execution_error" });

function group(items: BlockTraceItem[]): RequestGroup {
  return { requestId: "req-1", action: "respond", status: "completed", startedAt: 1, items, rawItems: items as unknown as OutputItem[] } as RequestGroup;
}

function findBlock(nodes: TraceNode[], name: string): TraceNode | undefined {
  for (const node of nodes) {
    if (node.type === "block" && node.blockName === name) return node;
    const found = findBlock(node.children, name);
    if (found) return found;
  }
  return undefined;
}

function SelectAndShow({ node }: { node: TraceNode }) {
  const { selectBlock } = useSelection();
  useEffect(() => selectBlock(node), [node, selectBlock]);
  return <ItemDetail />;
}

describe("DevTool — a refused block", () => {
  it("is refused in the tree, and a broken block is still failed", () => {
    const tree = buildTraceTree([group([refusedTrace, brokenTrace])]);
    expect(findBlock(tree, "updateWorkstream")?.blockStatus).toBe("refused");
    expect(findBlock(tree, "fetchPage")?.blockStatus).toBe("failed");
  });

  it("shows its row as refused with the reason in ink, while the broken row stays red", () => {
    render(
      <DebugProvider>
        <SelectionProvider>
          <TraceView requestGroups={[group([refusedTrace, brokenTrace])]} />
        </SelectionProvider>
      </DebugProvider>,
    );
    fireEvent.click(screen.getByText("respond"));

    expect(screen.getByText("refused")).toBeDefined();
    const reason = screen.getByTitle(REFUSAL_MESSAGE);
    expect(reason.className).toContain("text-fs-ink3");
    expect(reason.className).not.toContain("text-fs-red");
    expect(screen.getByTitle("socket hang up").className).toContain("text-fs-red");
  });

  it("keeps the whole error in the block detail, under a neutral Refused heading", () => {
    const node = findBlock(buildTraceTree([group([refusedTrace])]), "updateWorkstream")!;
    render(
      <SelectionProvider>
        <SelectAndShow node={node} />
      </SelectionProvider>,
    );

    const heading = screen.getByText("Refused");
    expect(heading.className).not.toContain("text-fs-red");
    expect(screen.queryByText("Error")).toBeNull();
    const panel = document.body.textContent ?? "";
    expect(panel).toContain(REFUSAL_MESSAGE);
    expect(panel).toContain(REFUSED_ERROR_CODE);
    // The typed reason, from `details`, is still there to read.
    expect(panel).toContain("not-a-workstream-session");
  });

  it("keeps a broken block's detail under a red Error heading", () => {
    const node = findBlock(buildTraceTree([group([brokenTrace])]), "fetchPage")!;
    render(
      <SelectionProvider>
        <SelectAndShow node={node} />
      </SelectionProvider>,
    );
    expect(screen.getByText("Error").className).toContain("text-fs-red");
    expect(screen.queryByText("Refused")).toBeNull();
  });

  it("reads '→ refused' in the stream's block row, with the reason expandable", () => {
    render(<BlockTraceItemView item={refusedTrace} />);
    const status = screen.getByText("refused");
    expect(status.className).not.toContain("text-fs-red");
    expect(screen.getByTitle(REFUSAL_MESSAGE).className).not.toContain("text-fs-red");

    fireEvent.click(status);
    expect(screen.getByText("Refused")).toBeDefined();
    expect(screen.getAllByText(REFUSAL_MESSAGE).length).toBeGreaterThan(1);
  });
});
