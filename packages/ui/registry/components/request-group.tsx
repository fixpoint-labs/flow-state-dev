"use client";

/**
 * Renders items grouped by request, collapsing consecutive tool-call items
 * into summary groups (Claude Code style). See {@link ToolGroup}.
 */

import { Fragment, useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ItemRenderer } from "@flow-state-dev/react";
import { SourcesGroup } from "./sources";
import { StreamingIndicator } from "./streaming-indicator";
import { ToolGroup, groupConsecutiveToolCalls } from "./tool";

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
        <GroupedItems items={group.items} />
        <SourcesGroup items={group.items} />
        {isLast && isStreaming && <StreamingIndicator message={statusMessage} />}
      </div>
    );
  });
}

/**
 * Walks a request's items and emits either a <ToolGroup> for consecutive
 * tool calls or a standard <ItemRenderer> for everything else. This is the
 * integration point between the framework's per-item renderer registry and
 * the cross-item grouping layer.
 */
function GroupedItems({ items }: { items: OutputItem[] }) {
  const segments = useMemo(() => groupConsecutiveToolCalls(items), [items]);
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === "group") {
          const key = segment.items[0]?.id ?? `group-${i}`;
          return <ToolGroup key={key} items={segment.items} />;
        }
        return <Fragment key={segment.item.id}><ItemRenderer item={segment.item} /></Fragment>;
      })}
    </>
  );
}
