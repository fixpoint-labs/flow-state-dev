/**
 * Stream view: renders request groups with chat-first layout.
 * Items are displayed using tier-based progressive disclosure
 * (see item-renderer.tsx).
 */
import { useEffect, useMemo, useRef } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { Inbox } from "lucide-react";
import { ItemRenderer } from "@/components/items/item-renderer";
import { RequestSeparator } from "./request-separator";
import { EmptyState } from "@/components/shared/empty-state";
import type { StreamStatus } from "@/hooks/use-request-stream";

type RequestGroup = {
  requestId: string;
  action: string;
  status: string;
  startedAt: number;
  duration?: number;
  items: OutputItem[];
};

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

  // Pre-compute filtered items (exclude trace-only items) and sequence numbers
  const { filteredGroups, sequenceMap } = useMemo(() => {
    const map = new Map<string, number>();
    let seq = 0;
    const groups = requestGroups.map((group) => {
      const items = group.items.filter((item) => !item.trace);
      for (const item of items) {
        seq++;
        map.set(item.id, seq);
      }
      return { ...group, items };
    });
    return { filteredGroups: groups, sequenceMap: map };
  }, [requestGroups]);

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
    <div ref={scrollContainerRef} className="flex flex-col gap-0 overflow-auto h-full">
      {filteredGroups.map((group, groupIndex) => {
        const isLast = groupIndex === filteredGroups.length - 1;
        return (
          <div key={group.requestId}>
            <RequestSeparator
              requestId={group.requestId}
              action={group.action}
              status={group.status}
              duration={group.duration}
              isActive={isLast && streamStatus === "streaming"}
              onReplayFull={onReplayFull ? () => onReplayFull(group.requestId) : undefined}
              onReplayFromCursor={onReplayFromCursor ? () => onReplayFromCursor(group.requestId) : undefined}
              onReconnect={onReconnect ? () => onReconnect(group.requestId) : undefined}
            />
            <div className="py-1">
              {group.items.map((item) => (
                <ItemRenderer
                  key={item.id}
                  item={item}
                  sequenceNumber={sequenceMap.get(item.id)}
                />
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
