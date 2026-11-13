/**
 * Tests for the FIX-865 continuation/suspension_resume boundary divider in
 * the DevTool's stream view. Before this change, `STREAM_TYPES` silently
 * dropped both item types (suspension_resume already did; continuation would
 * have too), so the crash-recovery / HITL-resume seam was invisible in the
 * DevTool's own chat-style view.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

import { StreamView, type RequestGroup } from "../src/react/components/workspace/stream-view";
import { DebugProvider } from "../src/react/context/debug-context";
import { SelectionProvider } from "../src/react/context/selection-context";

function renderStreamView(props: Parameters<typeof StreamView>[0]) {
  return render(
    <DebugProvider>
      <SelectionProvider>
        <StreamView {...props} />
      </SelectionProvider>
    </DebugProvider>,
  );
}

function makeGroup(items: OutputItem[]): RequestGroup {
  return {
    requestId: "req-1",
    action: "sendMessage",
    status: "completed",
    startedAt: 1000,
    items: items as any,
  };
}

const continuationItem = {
  id: "cont-1",
  type: "continuation",
  status: "completed",
  requestId: "req-1",
  itemIndex: 5,
  ts: 2000,
  trigger: "recovery",
  priorItemCount: 5,
  continuedAt: 2000,
} as unknown as OutputItem;

const suspensionResumeItem = {
  id: "resume-1",
  type: "suspension_resume",
  status: "completed",
  requestId: "req-1",
  itemIndex: 3,
  ts: 1500,
  suspensionId: "sus-1",
  resolution: "approved",
  resolvedAt: 1500,
} as unknown as OutputItem;

describe("StreamView — continuation/suspension_resume boundary", () => {
  it("renders a continuation item instead of silently dropping it", () => {
    renderStreamView({
      requestGroups: [makeGroup([continuationItem])],
      streamStatus: "completed",
    });
    expect(screen.getByText(/continued here/i)).toBeInTheDocument();
  });

  it("renders a suspension_resume item instead of silently dropping it", () => {
    renderStreamView({
      requestGroups: [makeGroup([suspensionResumeItem])],
      streamStatus: "completed",
    });
    expect(screen.getByText(/resumed/i)).toBeInTheDocument();
  });

  it("labels the continuation divider with priorItemCount", () => {
    renderStreamView({
      requestGroups: [makeGroup([continuationItem])],
      streamStatus: "completed",
    });
    expect(screen.getByText(/5 prior items/i)).toBeInTheDocument();
  });
});

/**
 * A status item with an empty message and no count it recognises has no label.
 * That covers a row stored under the count's old field name, which the DevTool
 * no longer reads. Such a row must leave no clickable blank row in the stream.
 */
describe("StreamView — a status item with nothing to show", () => {
  const statusItem = (id: string, fields: Record<string, unknown>) =>
    ({
      id,
      type: "status",
      status: "completed",
      requestId: "req-1",
      itemIndex: 0,
      ts: 1000,
      message: "",
      ...fields,
    }) as unknown as OutputItem;

  it("renders no row wrapper for it", () => {
    const { container } = renderStreamView({
      requestGroups: [makeGroup([statusItem("empty-1", {}), statusItem("empty-2", {})])],
      streamStatus: "completed",
    });
    expect(container.querySelectorAll(".cursor-pointer")).toHaveLength(0);
  });

  it("keeps it in debug mode, where its raw JSON is the point", () => {
    localStorage.setItem("fsd.devtool.debugMode", "true");
    const { container } = renderStreamView({
      requestGroups: [makeGroup([statusItem("empty-1", {})])],
      streamStatus: "completed",
    });
    expect(container.querySelectorAll(".cursor-pointer")).toHaveLength(1);
    expect(screen.getByText("Raw JSON")).toBeInTheDocument();
  });

  it("still renders a count-only status row", () => {
    const { container } = renderStreamView({
      requestGroups: [makeGroup([statusItem("count-1", { sideChainTasks: 2 })])],
      streamStatus: "completed",
    });
    expect(screen.getByText("side chains: 2 pending")).toBeInTheDocument();
    expect(container.querySelectorAll(".cursor-pointer")).toHaveLength(1);
  });
});
