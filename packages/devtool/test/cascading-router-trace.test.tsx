/**
 * A `cascadingRouter` run in the DevTool trace tree: it nests as ordinary
 * sequencer, evaluator, handler and router nodes, each with a kind the tree
 * already knows, and the gate node carries the verdict a reviewer reads to
 * see why a case went to review. No kind is added for the cascade.
 *
 * The rows are the block_trace items of a real engine run of a one-level
 * cascade that landed on `ambiguous` (captured, then trimmed to the fields
 * the tree reads).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { buildTraceTree, type TraceNode } from "../src/react/lib/trace-tree";
import { KindIndicator } from "../src/react/components/shared/kind-indicator";
import type { RequestGroup } from "../src/react/components/workspace/stream-view";

const outputRef = { kind: "ref", sourceItemId: "trace-review" } as const;

function row(
  id: string,
  blockName: string,
  blockKind: BlockTraceItem["blockKind"],
  blockInstanceId: string,
  parentBlockInstanceId: string | undefined,
  output: unknown
): BlockTraceItem {
  return {
    id,
    type: "block_trace",
    status: "completed",
    requestId: "r",
    itemIndex: 0,
    ts: 1,
    provenance: { blockName, blockInstanceId, parentBlockInstanceId, phase: "main" },
    blockName,
    blockKind,
    blockInstanceId,
    output,
  } as BlockTraceItem;
}

const rows = [
  row("trace-triage", "triage", "sequencer", "r:root:0", undefined, outputRef),
  row("trace-level", "triage/root", "sequencer", "r:root/step[0]:0", "r:root:0", outputRef),
  row("trace-department", "department", "evaluator", "r:root/step[0]/step[0]:0", "r:root/step[0]:0", {
    kind: "inline",
    value: { answers: { team: { type: "choice", choice: "billing" } } },
  }),
  row("trace-gate", "triage/root/gate", "handler", "r:root/step[0]/step[1]:0", "r:root/step[0]:0", {
    kind: "inline",
    value: { input: { m: 1 }, verdict: { level: "root", on: "team", ambiguous: "no-confidence", choice: "billing" } },
  }),
  row("trace-route", "triage/root/route", "router", "r:root/step[0]/step[2]:0", "r:root/step[0]:0", outputRef),
  row("trace-review", "review", "handler", "r:root/step[0]/step[2]/branch[review]:0", "r:root/step[0]/step[2]:0", {
    kind: "inline",
    value: { r: 1 },
  }),
];

function blocks(nodes: TraceNode[], out: TraceNode[] = []): TraceNode[] {
  for (const node of nodes) {
    if (node.type === "block") out.push(node);
    blocks(node.children, out);
  }
  return out;
}

describe("DevTool — cascadingRouter trace (BR-27)", () => {
  it("nests the cascade as ordinary nodes with known kinds", () => {
    const tree = buildTraceTree([
      { requestId: "r", action: "run", status: "completed", startedAt: 1, items: rows } as RequestGroup,
    ]);
    const all = blocks(tree);
    const byName = new Map(all.map((n) => [n.blockName, n]));
    const level = byName.get("triage/root")!;
    expect(byName.get("triage")!.children.filter((c) => c.type === "block").map((c) => c.blockName)).toEqual([
      "triage/root",
    ]);
    expect(level.children.filter((c) => c.type === "block").map((c) => c.blockName)).toEqual([
      "department",
      "triage/root/gate",
      "triage/root/route",
    ]);
    expect(byName.get("triage/root/route")!.children.filter((c) => c.type === "block").map((c) => c.blockName)).toEqual([
      "review",
    ]);
    const kinds = new Set(all.map((n) => n.blockKind));
    expect(kinds).toEqual(new Set(["sequencer", "evaluator", "handler", "router"]));
    for (const kind of kinds) {
      const { unmount } = render(<KindIndicator kind={kind!} />);
      // A kind the indicator knows renders its three-letter label, never the raw kind.
      expect(screen.queryByText(kind!)).toBeNull();
      unmount();
    }
  });
});
