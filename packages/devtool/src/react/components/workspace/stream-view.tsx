/**
 * Stream view: chat-first layout.
 *
 * Only shows items that belong in a conversation:
 *   - Messages (user + assistant)
 *   - Reasoning (collapsible)
 *   - Tool calls (block_tool_output — collapsible)
 *   - Errors / step errors
 *   - Components / containers
 *   - Status (transient progress indicators, e.g. "Using web_search…")
 *   - Sources (citation URLs from provider-native search)
 *
 * Operational items (block_output lifecycle, router_decision, context,
 * state_change, resource_change) are filtered out — they live in trace view.
 */
import { useEffect, useMemo, useRef } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { DevtoolItem } from "../../lib/item-types";
import { Inbox } from "lucide-react";
import { ItemRenderer } from "../items/item-renderer";
import { RequestSeparator } from "./request-separator";
import { EmptyState } from "../shared/empty-state";
import { aggregateTokenUsage } from "../../lib/token-utils";
import type { StreamStatus } from "../../hooks/use-request-stream";

type RequestGroup = {
  requestId: string;
  action: string;
  status: string;
  startedAt: number;
  duration?: number;
  items: DevtoolItem[];
  /** Inbound transport that produced the request — undefined for legacy data. */
  source?: string;
};

/** Item types that belong in a chat-like stream. */
const STREAM_TYPES = new Set([
  "message",
  "reasoning",
  "tool_output",
  "error",
  "component",
  "container",
  "status",
  "source",
]);

type StreamViewProps = {
  requestGroups: RequestGroup[];
  streamStatus: StreamStatus;
  isReplaying?: boolean;
  onReplayFull?: (requestId: string) => void;
  onReplayFromCursor?: (requestId: string) => void;
  onReconnect?: (requestId: string) => void;
};

export function StreamView({
  requestGroups,
  streamStatus,
  isReplaying,
  onReplayFull,
  onReplayFromCursor,
  onReconnect,
}: StreamViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  // Sort chronologically (oldest first), compute token totals from all items,
  // then filter to chat-relevant items for display. Transient items (status
  // indicators) are stripped once the request finishes so they don't linger.
  const filteredGroups = useMemo(
    () =>
      [...requestGroups]
        .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
        .map((group) => {
          const isDone = group.status === "completed" || group.status === "failed" || group.status === "incomplete";
          return {
            ...group,
            totalTokens: aggregateTokenUsage(group.items).totalTokens,
            items: group.items.filter((item) =>
              STREAM_TYPES.has(item.type) && !(isDone && item.transient)
            ),
          };
        }),
    [requestGroups],
  );

  // Track if user has scrolled away from the bottom.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      userScrolledUpRef.current = !atBottom;
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll to bottom when items change, unless user scrolled up.
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredGroups]);

  if (filteredGroups.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        message="No requests yet. Send an action to get started."
        className="h-full"
      />
    );
  }

  return (
    <div ref={scrollContainerRef} className="flex flex-col overflow-auto h-full">
      {filteredGroups.map((group, groupIndex) => {
        const isLast = groupIndex === filteredGroups.length - 1;
        const isActive = isLast && streamStatus === "streaming";
        return (
          <div key={group.requestId}>
            <RequestSeparator
              requestId={group.requestId}
              action={group.action}
              status={group.status}
              duration={group.duration}
              isActive={isActive}
              totalTokens={group.totalTokens}
              source={group.source}
              onReplayFull={onReplayFull ? () => onReplayFull(group.requestId) : undefined}
              onReplayFromCursor={onReplayFromCursor ? () => onReplayFromCursor(group.requestId) : undefined}
              onReconnect={onReconnect ? () => onReconnect(group.requestId) : undefined}
            />
            <div className="px-4 py-2 space-y-1">
              {group.items.map((item) => (
                <ItemRenderer key={item.id} item={item} />
              ))}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

export type { RequestGroup };
