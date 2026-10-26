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
import { buildItemRenderStream, ItemsRenderer, useFlowContext, type RendererRegistry } from "@flow-state-dev/react";
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
 *
 * Segments, not partitions: one request can own several of them. A keyed item
 * is one logical entity across every request that re-emits it, so it keeps its
 * first position in the stream while its `requestId` moves to the latest
 * emitter — which splits the requests around it. That is why the render below
 * cannot key on `requestId` alone.
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
   *  (main response is complete; only `.sideChain()` background tasks are
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
  // Read over every item, not one request's: a task plan and its tasks' work
  // can sit in different requests.
  const owned = useMemo(() => collectTaskOwnedItemIds(items), [items]);

  return groups.map((group, index) => {
    const isLast = index === groups.length - 1;

    return (
      <RequestGroup
        // Keyed on the segment's FIRST ITEM, not its position. One request can
        // own several segments (see `groupItemsByRequest`), so `requestId`
        // alone is not unique among siblings — but position is not stable:
        // re-emitting an earlier keyed item under a new `requestId` re-splits
        // the stream and shifts every later segment's index, which remounts
        // them and resets their expanded task plans and tool groups. An item id
        // is unique across the stream and stays with its segment, so a segment
        // that did not change keeps its identity. Falls back to position for
        // the empty-segment case, which `groupItemsByRequest` does not produce.
        key={group.items[0]?.id ?? `${group.requestId}:${index}`}
        group={group}
        owned={owned}
        isLast={isLast}
        isStreaming={isStreaming}
        statusMessage={statusMessage}
        isFinishing={isFinishing}
      />
    );
  });
}

/**
 * Whether the stream ends on a run of tool calls and thoughts with one still
 * running. The group's own line names that step, so the indicator would repeat
 * it. Read from the same render stream the group draws, so an item it drops
 * (a trace, a hidden step, one a container owns) is not counted, and a call
 * running behind one that finished is.
 */
function endsOnRunningStep(items: OutputItem[], renderers: RendererRegistry | undefined): boolean {
  const stream = buildItemRenderStream(items, renderers, { groupToolCalls: true });
  const last = stream[stream.length - 1];
  return last?.kind === "group" && last.items.some((item) => item.status === "in_progress");
}

function RequestGroup({
  group,
  owned,
  isLast,
  isStreaming,
  statusMessage,
  isFinishing,
}: {
  group: RequestGroup;
  /** Items that render under their task in `<TaskPlan />` (`collectTaskOwnedItemIds`). */
  owned: ReadonlySet<string>;
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
    if (owned.size === 0) return group.items;
    return group.items.filter((item) => !owned.has(item.id));
  }, [group.items, owned]);

  const { renderers } = useFlowContext();
  const stepInFlight = useMemo(
    () => isLast && isStreaming && endsOnRunningStep(filteredItems, renderers),
    [isLast, isStreaming, filteredItems, renderers],
  );

  return (
    <div
      data-request-id={group.requestId}
      className="flex flex-col gap-2"
      style={isLast ? { minHeight: "70dvh" } : undefined}
    >
      <ItemsRenderer items={filteredItems} toolGroupRenderer={ToolGroup} live={isLast && isStreaming} />
      <SourcesGroup items={group.items} />
      {isLast && isStreaming && !stepInFlight && <StreamingIndicator message={statusMessage} isFinishing={isFinishing} />}
    </div>
  );
}
