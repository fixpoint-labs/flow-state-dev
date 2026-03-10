import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (streamStatus === "streaming") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [requestGroups, streamStatus]);

  if (requestGroups.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        message="No requests yet. Send an action to get started."
        className="h-full"
      />
    );
  }

  let globalSeq = 0;

  return (
    <div className="flex flex-col gap-0 overflow-auto h-full">
      {requestGroups.map((group, groupIndex) => {
        const isLast = groupIndex === requestGroups.length - 1;
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
            {group.items.map((item) => {
              globalSeq++;
              return (
                <ItemRenderer
                  key={item.id}
                  item={item}
                  sequenceNumber={globalSeq}
                />
              );
            })}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

export type { RequestGroup };
