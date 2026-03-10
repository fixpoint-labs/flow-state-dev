import { useCallback, useEffect, useRef, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestStatus, RequestStreamEvent } from "@flow-state-dev/core/items";
import type { RequestStreamHandle } from "@flow-state-dev/client";
import { connectRequestStream, type DevToolConfig } from "@/lib/client";

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

export type UseRequestStreamOptions = {
  config: DevToolConfig;
  flowKind: string | null;
  requestId: string | null;
  startingAfter?: number;
  lastEventId?: string;
  enabled?: boolean;
};

export type UseRequestStreamResult = {
  streamState: StreamState | null;
  streamStatus: StreamStatus;
  error: string | null;
  items: OutputItem[];
  lastSequenceNumber: number;
};

export function useRequestStream(options: UseRequestStreamOptions): UseRequestStreamResult {
  const { config, flowKind, requestId, startingAfter, lastEventId, enabled = true } = options;
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<RequestStreamHandle | null>(null);

  const close = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.close();
      handleRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !flowKind || !requestId) {
      close();
      if (!requestId) {
        setStreamState(null);
        setStreamStatus("idle");
      }
      return;
    }

    close();
    const state = createEmptyStreamState(requestId);
    setStreamState({ ...state });
    setStreamStatus("connecting");
    setError(null);

    const handle = connectRequestStream(config, flowKind, requestId, {
      startingAfter,
      lastEventId,
      onRequestCreated: (event) => {
        state.status = "in_progress";
        state.lastSequenceNumber = event.sequence_number;
        setStreamState({ ...state });
        setStreamStatus("streaming");
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
        setStreamState({ ...state });
      },
      onItemAdded: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = event.item;
        state.items.set(item.id, item);
        if (!state.itemOrder.includes(item.id)) {
          state.itemOrder.push(item.id);
        }
        setStreamState({ ...state });
      },
      onItemDone: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = event.item;
        state.items.set(item.id, item);
        setStreamState({ ...state });
      },
      onContentDelta: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const key = `${event.itemId}:${event.contentIndex}`;
        const existing = state.contentBuffers.get(key) ?? "";
        state.contentBuffers.set(key, existing + event.delta);

        const item = state.items.get(event.itemId);
        if (item && "content" in item && Array.isArray(item.content)) {
          const part = item.content[event.contentIndex];
          if (part && "text" in part) {
            part.text = state.contentBuffers.get(key) ?? "";
            state.items.set(event.itemId, { ...item });
          }
        }
        setStreamState({ ...state });
      },
      onContentAdded: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = state.items.get(event.itemId);
        if (item && "content" in item && Array.isArray(item.content)) {
          if (item.content.length <= event.contentIndex) {
            item.content.push(event.content);
          } else {
            item.content[event.contentIndex] = event.content;
          }
          state.items.set(event.itemId, { ...item });
        }
        setStreamState({ ...state });
      },
      onContentDone: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const item = state.items.get(event.itemId);
        if (item && "content" in item && Array.isArray(item.content)) {
          item.content[event.contentIndex] = event.content;
          state.items.set(event.itemId, { ...item });
        }
        const key = `${event.itemId}:${event.contentIndex}`;
        state.contentBuffers.delete(key);
        setStreamState({ ...state });
      },
      onError: (err) => {
        setError(err.message);
        setStreamStatus("disconnected");
      },
    });

    handleRef.current = handle;

    return () => {
      handle.close();
      if (handleRef.current === handle) {
        handleRef.current = null;
      }
    };
  }, [config, flowKind, requestId, startingAfter, lastEventId, enabled, close]);

  const items = streamState
    ? streamState.itemOrder.map((id) => streamState.items.get(id)!).filter(Boolean)
    : [];

  return {
    streamState,
    streamStatus,
    error,
    items,
    lastSequenceNumber: streamState?.lastSequenceNumber ?? 0,
  };
}
