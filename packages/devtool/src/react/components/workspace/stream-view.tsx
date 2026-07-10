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
 *   - Continuation / suspension_resume boundary markers (crash-recovery and
 *     HITL-resume seams, FIX-865) — rendered as compact divider rows
 *

 * Operational items (block_output lifecycle, router_decision, context,
 * state_change, resource_change) are filtered out — they live in trace view.
 */
import { useEffect, useMemo, useRef } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { collapseToCanonicalLog } from "@flow-state-dev/core/items";
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
  /**
   * Same item set as `items`, WITHOUT the canonical crash-recovery collapse
   * (`collapseToCanonicalLog` strips a re-run's superseded pre-recovery rows
   * for the chat view — see the `filteredGroups` memo below). Carried here so
   * other views (e.g. the trace tree) can render the recovery boundary
   * itself. Not consumed by this component.
   */
  rawItems?: DevtoolItem[];
  /** Inbound transport that produced the request — undefined for legacy data. */
  source?: string;
  /**
   * Adapter-stamped provenance bag (e.g., scheduled-source carries
   * `scheduleId` and `origin`). Forwarded to the request separator so
   * transport-specific badges can surface without a custom hook.
   */
  metadata?: Record<string, unknown>;
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
  "continuation",
  "suspension_resume",
]);

type StreamViewProps = {
  requestGroups: RequestGroup[];
  streamStatus: StreamStatus;
  isReplaying?: boolean;
  onReplayFull?: (requestId: string) => void;
  onReplayFromCursor?: (requestId: string) => void;
  onReconnect?: (requestId: string) => void;
  onContinue?: (requestId: string) => void;
  /** True while a continuation is already streaming for the given request (FIX-865). */
  isContinuing?: (requestId: string) => boolean;
};

export function StreamView({
  requestGroups,
  streamStatus,
  isReplaying,
  onReplayFull,
  onReplayFromCursor,
  onReconnect,
  onContinue,
  isContinuing,
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
          // Collapse the physical log to its canonical view (FIX-811) so a
          // resumed/continued request's superseded re-emissions (e.g. a HITL
          // gate's approval prompt, re-emitted when the block re-runs) show once
          // here — matching `useSession` / GET history. The collapse needs the
          // full item list (block_trace, suspension, suspension_resume drive the
          // boundaries), so it runs before the STREAM_TYPES filter. The Trace
          // view consumes the raw `requestGroups` elsewhere, so superseded
          // traces stay visible there for forensics. `DevtoolItem` is the
          // RuntimeItem superset the collapse is documented to accept.
          const canonical = collapseToCanonicalLog(
            group.items as unknown as readonly OutputItem[]
          ) as unknown as DevtoolItem[];
          return {
            ...group,
            totalTokens: aggregateTokenUsage(group.items).totalTokens,
            items: canonical.filter((item) =>
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
              metadata={group.metadata}
              onReplayFull={onReplayFull ? () => onReplayFull(group.requestId) : undefined}
              onReplayFromCursor={onReplayFromCursor ? () => onReplayFromCursor(group.requestId) : undefined}
              onReconnect={onReconnect ? () => onReconnect(group.requestId) : undefined}
              onContinue={onContinue ? () => onContinue(group.requestId) : undefined}
              isContinuing={isContinuing?.(group.requestId)}
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
