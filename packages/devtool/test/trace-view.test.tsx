/**
 * Tests for the FIX-865 continuation/suspension_resume boundary divider in
 * the DevTool's trace view. `TraceView` builds from `buildTraceTree` (not
 * `ItemRenderer`), so the divider needs its own rendering path here — see
 * `trace-tree.test.ts` for the tree-shape assertions this renders from.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

import { TraceView } from "../src/react/components/workspace/trace-view";
import type { RequestGroup } from "../src/react/components/workspace/stream-view";
import { DebugProvider } from "../src/react/context/debug-context";
import { SelectionProvider } from "../src/react/context/selection-context";

function renderTraceView(requestGroups: RequestGroup[]) {
  return render(
    <DebugProvider>
      <SelectionProvider>
        <TraceView requestGroups={requestGroups} />
      </SelectionProvider>
    </DebugProvider>,
  );
}

function makeProvenance(blockName: string, blockInstanceId: string, phase: "main" | "work" = "main") {
  return { blockName, blockInstanceId, phase };
}

describe("TraceView — continuation/suspension_resume boundary", () => {
  it("renders a boundary marker for a continuation item, with prior/background blocks above and re-dispatched blocks below", () => {
    const items: OutputItem[] = [
      {
        id: "bg-before-1", type: "message", status: "completed", requestId: "req-1",
        itemIndex: 0, ts: 1000, role: "assistant", content: [{ type: "output_text", text: "before" }],
        provenance: makeProvenance("bg-before-block", "bg-before-inst", "work"),
      } as unknown as OutputItem,
      {
        id: "cont-1", type: "continuation", status: "completed", requestId: "req-1",
        itemIndex: 1, ts: 2000, trigger: "recovery", priorItemCount: 1, continuedAt: 2000,
      } as unknown as OutputItem,
      {
        id: "bg-after-1", type: "message", status: "completed", requestId: "req-1",
        itemIndex: 2, ts: 3000, role: "assistant", content: [{ type: "output_text", text: "after" }],
        provenance: makeProvenance("bg-after-block", "bg-after-inst", "work"),
      } as unknown as OutputItem,
    ];

    const group: RequestGroup = {
      requestId: "req-1",
      action: "sendMessage",
      status: "completed",
      startedAt: 1000,
      items: [],
      rawItems: items,
    };

    renderTraceView([group]);

    // The request row starts collapsed (this fixture has no active/
    // last-active request) — expand it to see the divider and block rows.
    fireEvent.click(screen.getByText("sendMessage"));

    expect(screen.getByText(/continued here/i)).toBeInTheDocument();
    expect(screen.getByText(/1 prior item/i)).toBeInTheDocument();

    // Both the restored (pre-crash) and re-dispatched background blocks keep
    // their BG badge — the divider must not clobber the existing badge logic.
    const bgBadges = screen.getAllByTitle(/Background sidechain/i);
    expect(bgBadges).toHaveLength(2);

    // Prior block sits above the divider, re-dispatched block below it.
    const allText = document.body.textContent ?? "";
    const beforeIdx = allText.indexOf("bg-before-block");
    const dividerIdx = allText.indexOf("continued here");
    const afterIdx = allText.indexOf("bg-after-block");
    expect(beforeIdx).toBeGreaterThanOrEqual(0);
    expect(beforeIdx).toBeLessThan(dividerIdx);
    expect(dividerIdx).toBeLessThan(afterIdx);
  });
});
