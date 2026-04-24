"use client";

import { useMemo } from "react";
import type { BlockToolOutputItem, OutputItem } from "@flow-state-dev/core/items";
import { ItemsRenderer } from "@flow-state-dev/react";
import { SourcesGroup } from "./sources";
import { StreamingIndicator } from "./streaming-indicator";
import { ToolGroup } from "./tool";

type RequestGroup = {
  requestId: string;
  items: OutputItem[];
};

type RenderSegment =
  | { type: "items"; key: string; items: OutputItem[] }
  | { type: "tool-group"; key: string; items: BlockToolOutputItem[] };

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

/**
 * Splits request items into normal renderer runs and consecutive tool groups.
 */
export function segmentToolGroups(items: OutputItem[]): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let normalItems: OutputItem[] = [];
  let toolItems: BlockToolOutputItem[] = [];

  const flushNormal = () => {
    if (normalItems.length === 0) return;
    segments.push({
      type: "items",
      key: `items-${normalItems[0].id}-${normalItems[normalItems.length - 1].id}`,
      items: normalItems,
    });
    normalItems = [];
  };

  const flushTools = () => {
    if (toolItems.length === 0) return;
    segments.push({
      type: "tool-group",
      key: `tools-${toolItems[0].id}-${toolItems[toolItems.length - 1].id}`,
      items: toolItems,
    });
    toolItems = [];
  };

  for (const item of items) {
    if (item.type === "block_tool_output") {
      flushNormal();
      toolItems.push(item as BlockToolOutputItem);
      continue;
    }

    flushTools();
    normalItems.push(item);
  }

  flushNormal();
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
    const segments = segmentToolGroups(group.items);

    return (
      <div
        key={group.requestId}
        data-request-id={group.requestId}
        className="flex flex-col gap-2"
        style={isLast ? { minHeight: "70dvh" } : undefined}
      >
        {segments.map((segment) =>
          segment.type === "tool-group" ? (
            <ToolGroup key={segment.key} items={segment.items} />
          ) : (
            <ItemsRenderer key={segment.key} items={segment.items} />
          )
        )}
        <SourcesGroup items={group.items} />
        {isLast && isStreaming && <StreamingIndicator message={statusMessage} />}
      </div>
    );
  });
}
