"use client";

/**
 * Renders items grouped by request. Consecutive tool-call items inside the
 * stream are collapsed into a <ToolGroup> via ItemsRenderer's
 * `toolGroupRenderer` prop — that ensures the dedup / sub-agent /
 * container-owner filters run before grouping.
 *
 * Items emitted inside a task-board's per-task execution window are
 * hidden from the chat thread — they render under the task in
 * `<TaskPlan />` instead, mounted at the position of the
 * `task-board-meta` ComponentItem. This avoids duplication
 * (e.g., 6 individual searches under the task plus a "Ran 6 searches"
 * rollup outside it).
 */

import { useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ItemsRenderer } from "@flow-state-dev/react";
import { SourcesGroup } from "./sources";
import { StreamingIndicator } from "./streaming-indicator";
import { collectTaskOwnedItemIds } from "./task-plan-state";
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

type RequestGroupRendererProps = {
  items: OutputItem[];
  isStreaming: boolean;
  /** Latest value from the request-scoped status slot. Falls back to
   *  "Working..." in the indicator when empty. */
  statusMessage?: string;
  /** When true, the request is in its background-task drain phase
   *  (main response is complete; only `.work()` background tasks are
   *  still settling on the open SSE stream). The indicator switches to
   *  a muted "Tidying up..." state so the user is not misled into
   *  thinking the assistant is still producing their answer. Sourced
   *  from `useSession.isFinishing`. Defaults to `false` for callers
   *  that do not yet thread the signal. */
  isFinishing?: boolean;
};

/**
 * Renders items grouped by request. The last request group gets
 * `min-height: 100dvh` so that when a new user message is sent,
 * it sits at the top of the viewport while streaming content fills
 * in below. As the content grows past the viewport, the min-height
 * becomes irrelevant and scrolling works normally.
 */
export function RequestGroupRenderer({ items, isStreaming, statusMessage, isFinishing = false }: RequestGroupRendererProps) {
  const groups = useMemo(() => groupItemsByRequest(items), [items]);

  return groups.map((group, index) => {
    const isLast = index === groups.length - 1;

    return (
      <RequestGroup
        key={group.requestId}
        group={group}
        isLast={isLast}
        isStreaming={isStreaming}
        statusMessage={statusMessage}
        isFinishing={isFinishing}
      />
    );
  });
}

function RequestGroup({
  group,
  isLast,
  isStreaming,
  statusMessage,
  isFinishing,
}: {
  group: RequestGroup;
  isLast: boolean;
  isStreaming: boolean;
  statusMessage?: string;
  /** See `RequestGroupRendererProps.isFinishing`. */
  isFinishing?: boolean;
}) {
  // Items inside a task-board window render under the task in
  // <TaskPlan /> — hide them from the chat-thread stream so we don't
  // duplicate.
  const filteredItems = useMemo(() => {
    const owned = collectTaskOwnedItemIds(group.items);
    if (owned.size === 0) return group.items;
    return group.items.filter((item) => !owned.has(item.id));
  }, [group.items]);

  return (
    <div
      data-request-id={group.requestId}
      className="flex flex-col gap-2"
      style={isLast ? { minHeight: "70dvh" } : undefined}
    >
      <ItemsRenderer items={filteredItems} toolGroupRenderer={ToolGroup} />
      <SourcesGroup items={group.items} />
      {isLast && isStreaming && <StreamingIndicator message={statusMessage} isFinishing={isFinishing} />}
    </div>
  );
}
