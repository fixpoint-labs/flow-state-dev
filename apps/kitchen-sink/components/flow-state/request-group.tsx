"use client";

import { Fragment, useMemo } from "react";
import type { BlockToolOutputItem, OutputItem } from "@flow-state-dev/core/items";
import { ItemsRenderer } from "@flow-state-dev/react";
import { SourcesGroup } from "./sources";
import { StreamingIndicator } from "./streaming-indicator";
import { ToolGroup } from "./tool";

type RequestGroup = {
  requestId: string;
  items: OutputItem[];
};

/**
 * Groups a flat items array into per-request segments, preserving order.
 */
function groupItemsByRequest(items: OutputItem[]): RequestGroup[] {
  const groups: RequestGroup[] = [];
  let current: RequestGroup | null = null;

  for (const item of items) {
    if (current === null || current.requestId !== item.requestId) {
      current = { requestId: item.requestId, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }

  return groups;
}

type ToolGroupSegment =
  | { kind: "items"; items: OutputItem[] }
  | { kind: "tools"; items: BlockToolOutputItem[] };

/**
 * Splits request items into normal item runs and consecutive tool-call runs.
 */
export function segmentToolGroups(items: OutputItem[]): ToolGroupSegment[] {
  const segments: ToolGroupSegment[] = [];
  let currentItems: OutputItem[] = [];
  let currentTools: BlockToolOutputItem[] = [];

  const flushItems = () => {
    if (currentItems.length === 0) return;
    segments.push({ kind: "items", items: currentItems });
    currentItems = [];
  };

  const flushTools = () => {
    if (currentTools.length === 0) return;
    segments.push({ kind: "tools", items: currentTools });
    currentTools = [];
  };

  for (const item of items) {
    if (item.type === "block_tool_output") {
      flushItems();
      currentTools.push(item);
      continue;
    }

    flushTools();
    currentItems.push(item);
  }

  flushItems();
  flushTools();
  return segments;
}

type RequestGroupRendererProps = {
  items: OutputItem[];
  isStreaming: boolean;
  /** Latest value from the request-scoped status slot. Falls back to
   *  "Thinking..." in the indicator when empty. */
  statusMessage?: string;
};

/**
 * Renders items grouped by request. The last request group gets
 * `min-height: 100dvh` so that when a new user message is sent,
 * it sits at the top of the viewport while streaming content fills
 * in below. As the content grows past the viewport, the min-height
 * becomes irrelevant and scrolling works normally.
 */
export function RequestGroupRenderer({ items, isStreaming, statusMessage }: RequestGroupRendererProps) {
  const groups = useMemo(() => groupItemsByRequest(items), [items]);

  return groups.map((group, index) => {
    const isLast = index === groups.length - 1;

    return (
      <div
        key={group.requestId}
        data-request-id={group.requestId}
        className="flex flex-col gap-2"
        style={isLast ? { minHeight: "70dvh" } : undefined}
      >
        {segmentToolGroups(group.items).map((segment, segmentIndex) => (
          <Fragment key={`${group.requestId}:${segment.kind}:${segmentIndex}`}>
            {segment.kind === "tools" ? (
              <ToolGroup items={segment.items} />
            ) : (
              <ItemsRenderer items={segment.items} />
            )}
          </Fragment>
        ))}
        <SourcesGroup items={group.items} />
        {isLast && isStreaming && <StreamingIndicator message={statusMessage} />}
      </div>
    );
  });
}
