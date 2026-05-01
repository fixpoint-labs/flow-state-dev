import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestStatus, RequestStreamEvent } from "@flow-state-dev/core/items";
import type { RequestStreamHandle } from "@flow-state-dev/client";
import { connectRequestStream } from "../lib/client";
import { useDevTool } from "../context/devtool-context";

export type StreamStatus = "idle" | "connecting" | "streaming" | "completed" | "failed" | "disconnected";

export type StreamState = {
  requestId: string;
  status: RequestStatus | "created";
  items: Map<string, OutputItem>;
  itemOrder: string[];
  lastSequenceNumber: number;
  contentBuffers: Map<string, string>;
  terminalEvents: RequestStreamEvent[];
};

function createEmptyStreamState(requestId: string): StreamState {
  return {
    requestId,
    status: "created",
    items: new Map(),
    itemOrder: [],
    lastSequenceNumber: 0,
    contentBuffers: new Map(),
    terminalEvents: [],
  };
}

/** Create a deep snapshot of the mutable state for React */
function snapshotState(state: StreamState): StreamState {
  return {
    requestId: state.requestId,
    status: state.status,
    items: new Map(state.items),
    itemOrder: [...state.itemOrder],
    lastSequenceNumber: state.lastSequenceNumber,
    contentBuffers: new Map(state.contentBuffers),
    terminalEvents: [...state.terminalEvents],
  };
}

export type UseRequestStreamOptions = {

  flowKind: string | null;
  requestId: string | null;
  startingAfter?: number;
  lastEventId?: string;
  enabled?: boolean;
  onSessionMetadataChanged?: () => void;
};

export type UseRequestStreamResult = {
  streamState: StreamState | null;
  streamStatus: StreamStatus;
  error: string | null;
  items: OutputItem[];
  lastSequenceNumber: number;
};

export function useRequestStream(options: UseRequestStreamOptions): UseRequestStreamResult {
  const { flowKind, requestId, startingAfter, lastEventId, enabled = true, onSessionMetadataChanged } = options;
  const { baseUrl } = useDevTool();
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<RequestStreamHandle | null>(null);

  // Mutable accumulator lives outside React state.
  // We flush snapshots into React state via RAF throttling.
  const stateRef = useRef<StreamState | null>(null);
  const rafRef = useRef<number | null>(null);
  const isDirtyRef = useRef(false);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled
    isDirtyRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (isDirtyRef.current && stateRef.current) {
        isDirtyRef.current = false;
        setStreamState(snapshotState(stateRef.current));
      }
    });
  }, []);

  /** Flush immediately for important state transitions (status changes) */
  const flushNow = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    isDirtyRef.current = false;
    if (stateRef.current) {
      setStreamState(snapshotState(stateRef.current));
    }
  }, []);

  const close = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.close();
      handleRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !flowKind || !requestId) {
      close();
      if (!requestId) {
        stateRef.current = null;
        setStreamState(null);
        setStreamStatus("idle");
      }
      return;
    }

    close();
    const state = createEmptyStreamState(requestId);
    stateRef.current = state;
    setStreamState(snapshotState(state));
    setStreamStatus("connecting");
    setError(null);

    const itemIdSet = new Set<string>();

    const handle = connectRequestStream(flowKind, requestId, {
      startingAfter,
      lastEventId,
      onRequestCreated: (event) => {
        state.status = "in_progress";
        state.lastSequenceNumber = event.sequence_number;
        setStreamStatus("streaming");
        flushNow();
      },
      onRequestStatus: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        if (event.type === "request.completed") {
          state.status = "completed";
          setStreamStatus("completed");
        } else if (event.type === "request.failed") {
          state.status = "failed";
          setStreamStatus("failed");
        } else if (event.type === "request.incomplete") {
          state.status = "incomplete";
          setStreamStatus("completed");
        } else if (event.type === "request.in_progress") {
          state.status = "in_progress";
          setStreamStatus("streaming");
        }
        state.terminalEvents.push(event);
        flushNow();
      },
      onItemAdded: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = event.item;
        state.items.set(item.id, item);
        if (!itemIdSet.has(item.id)) {
          itemIdSet.add(item.id);
          state.itemOrder.push(item.id);
        }
        scheduleFlush();
      },
      onItemDone: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = event.item;
        state.items.set(item.id, item);
        scheduleFlush();
      },
      onContentDelta: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const key = `${event.itemId}:${event.contentIndex}`;
        const existing = state.contentBuffers.get(key) ?? "";
        state.contentBuffers.set(key, existing + event.delta);

        const item = state.items.get(event.itemId);
        if (item) {
          // Items use either `content` (messages) or `summary` (reasoning)
          const contentArray =
            ("content" in item && Array.isArray(item.content)) ? item.content :
            ("summary" in item && Array.isArray(item.summary)) ? item.summary :
            null;
          if (contentArray) {
            const part = contentArray[event.contentIndex];
            if (part && "text" in part) {
              part.text = state.contentBuffers.get(key) ?? "";
              state.items.set(event.itemId, { ...item });
            }
          }
        }
        scheduleFlush();
      },
      onContentAdded: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = state.items.get(event.itemId);
        if (item) {
          const contentArray =
            ("content" in item && Array.isArray(item.content)) ? item.content :
            ("summary" in item && Array.isArray(item.summary)) ? item.summary :
            null;
          if (contentArray) {
            if (contentArray.length <= event.contentIndex) {
              contentArray.push(event.content);
            } else {
              contentArray[event.contentIndex] = event.content;
            }
            state.items.set(event.itemId, { ...item });
          }
        }
        scheduleFlush();
      },
      onContentDone: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = state.items.get(event.itemId);
        if (item) {
          const contentArray =
            ("content" in item && Array.isArray(item.content)) ? item.content :
            ("summary" in item && Array.isArray(item.summary)) ? item.summary :
            null;
          if (contentArray) {
            contentArray[event.contentIndex] = event.content;
            state.items.set(event.itemId, { ...item });
          }
        }
        const key = `${event.itemId}:${event.contentIndex}`;
        state.contentBuffers.delete(key);
        scheduleFlush();
      },
      onSessionMetadataChanged: onSessionMetadataChanged
        ? () => { onSessionMetadataChanged(); }
        : undefined,
      onError: (err) => {
        setError(err.message);
        setStreamStatus("disconnected");
      },
    }, baseUrl);

    handleRef.current = handle;

    return () => {
      handle.close();
      if (handleRef.current === handle) {
        handleRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [flowKind, requestId, startingAfter, lastEventId, enabled, baseUrl, close, scheduleFlush, flushNow, onSessionMetadataChanged]);

  const items = useMemo(
    () => streamState
      ? streamState.itemOrder
          .map((id) => streamState.items.get(id))
          .filter((item): item is OutputItem => item !== undefined)
      : [],
    [streamState],
  );

  return {
    streamState,
    streamStatus,
    error,
    items,
    lastSequenceNumber: streamState?.lastSequenceNumber ?? 0,
  };
}
