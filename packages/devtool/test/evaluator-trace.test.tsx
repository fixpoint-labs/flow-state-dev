/**
 * An evaluator's block_trace row in the DevTool: the tree marks the node with
 * the evaluator kind, and its detail panel shows the model asked, the
 * questions and the answers. A four-kind trace keeps rendering as before.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React, { useEffect } from "react";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { buildTraceTree, type TraceNode } from "../src/react/lib/trace-tree";
import { ItemDetail } from "../src/react/components/detail/item-detail";
import { KindIndicator } from "../src/react/components/shared/kind-indicator";
import { SelectionProvider, useSelection } from "../src/react/context/selection-context";
import type { RequestGroup } from "../src/react/components/workspace/stream-view";

function traceRow(overrides: Partial<BlockTraceItem>): BlockTraceItem {
  return {
    id: "trace-1",
    type: "block_trace",
    status: "completed",
    requestId: "req-1",
    itemIndex: 0,
    ts: 1,
    provenance: { blockName: "triage", blockInstanceId: "inst-triage", phase: "main" },
    blockName: "triage",
    blockKind: "evaluator",
    blockInstanceId: "inst-triage",
    ...overrides,
  } as BlockTraceItem;
}

const evaluatorRow = traceRow({
  evaluator: {
    model: "typesafe-ai/jev",
    questions: {
      team: {
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: { billing: "Payments and refunds", technical: "Bugs and outages" },
      },
    },
  },
  model: { actual: "jev-2026-09", requested: "typesafe-ai/jev" },
  output: {
    kind: "inline",
    value: { answers: { team: { type: "choice", choice: "billing", confidence: 0.94 } } },
  },
  modelUsage: { model: "typesafe-ai/jev", promptTokens: 40, completionTokens: 2, totalTokens: 42 },
});

function group(items: BlockTraceItem[]): RequestGroup {
  return { requestId: "req-1", action: "triage", status: "completed", startedAt: 1, items } as RequestGroup;
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

describe("DevTool — evaluator trace (BR-25, BR-27)", () => {
  it("marks the node with the evaluator kind", () => {
    const node = findBlock(buildTraceTree([group([evaluatorRow])]), "triage");
    expect(node?.blockKind).toBe("evaluator");
    render(<KindIndicator kind="evaluator" />);
    expect(screen.getByText("EVL")).toBeDefined();
  });

  it("shows the model asked, the model that answered, the questions and the answers", () => {
    const node = findBlock(buildTraceTree([group([evaluatorRow])]), "triage")!;
    render(
      <SelectionProvider>
        <SelectAndShow node={node} />
      </SelectionProvider>
    );

    expect(screen.getByText("Evaluator")).toBeDefined();
    expect(screen.getAllByText("typesafe-ai/jev").length).toBeGreaterThan(0);
    expect(screen.getByText("jev-2026-09")).toBeDefined();
    const panel = document.body.textContent ?? "";
    expect(panel).toContain("Which team should handle this?");
    expect(panel).toContain("billing");
    expect(panel).toContain("0.94");
  });

  it("renders a four-kind trace without an evaluator section", () => {
    const handlerRow = traceRow({
      blockName: "echo",
      blockKind: "handler",
      blockInstanceId: "inst-echo",
      provenance: { blockName: "echo", blockInstanceId: "inst-echo", phase: "main" },
      output: { kind: "inline", value: "hi" },
    });
    const node = findBlock(buildTraceTree([group([handlerRow])]), "echo")!;
    expect(node.blockKind).toBe("handler");
    render(
      <SelectionProvider>
        <SelectAndShow node={node} />
      </SelectionProvider>
    );
    expect(screen.queryByText("Evaluator")).toBeNull();
  });
});
