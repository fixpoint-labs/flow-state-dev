"use client";

import { useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ItemsRenderer } from "@flow-state-dev/react";
import { SourcesGroup } from "./sources";
import { StreamingIndicator } from "./streaming-indicator";

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

/**
 * Check if the last group has any assistant-produced content (reasoning, message,
 * status, block output, etc.) — i.e. anything beyond the optimistic user message.
 */
function hasAssistantContent(group: RequestGroup): boolean {
  return group.items.some(
    (item) => item.type !== "message" || item.role !== "user"
  );
}

type RequestGroupRendererProps = {
  items: OutputItem[];
  isStreaming: boolean;
};

/**
 * Renders items grouped by request. The last request group gets
 * `min-height: 100dvh` so that when a new user message is sent,
 * it sits at the top of the viewport while streaming content fills
 * in below. As the content grows past the viewport, the min-height
 * becomes irrelevant and scrolling works normally.
 */
export function RequestGroupRenderer({ items, isStreaming }: RequestGroupRendererProps) {
  const groups = useMemo(() => groupItemsByRequest(items), [items]);

  const lastGroup = groups[groups.length - 1];
  const showIndicator =
    isStreaming && (!lastGroup || !hasAssistantContent(lastGroup));

  return groups.map((group, index) => {
    const isLast = index === groups.length - 1;

    return (
      <div
        key={group.requestId}
        data-request-id={group.requestId}
        className="flex flex-col gap-2"
        style={isLast ? { minHeight: "70dvh" } : undefined}
      >
        <ItemsRenderer items={group.items} />
        <SourcesGroup items={group.items} />
        {isLast && showIndicator && <StreamingIndicator />}
      </div>
    );
  });
}
