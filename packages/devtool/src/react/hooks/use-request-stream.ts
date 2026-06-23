import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestStatus, RequestStreamEvent } from "@flow-state-dev/core/items";
import { ITEM_UPDATE_INVARIANT_KEYS } from "@flow-state-dev/core/items";
import type { RequestSSECallbacks, RequestStreamHandle } from "@flow-state-dev/client";
import { connectRequestStream, consumeRequestStreamResponse } from "../lib/client";
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
  /**
   * Bump to force a fresh reconnect for the SAME request id. A same-request
   * continuation (FIX-811) re-enters under its original id, so the id alone
   * doesn't change and the connect effect wouldn't otherwise re-run. After a
   * suspend the prior stream has already closed (the server treats `suspended`
   * as terminal and ends the wire); without this the resumed run never
   * re-attaches and its progress to terminal only shows on a full page reload.
   */
  reconnectToken?: number;
  /**
   * A pre-fetched SSE response to consume as the stream instead of opening a
   * GET — set after a streaming resume (the resume POST returns the
   * continuation's SSE body). One-shot: consumed once when present, then the
   * stream re-attaches via GET on later reconnects. On serverless this is the
   * only way to follow the resumed run live (a GET would hit a cold instance
   * with no in-flight stream). Bump `reconnectToken` alongside it so the
   * connect effect re-runs for the same request id.
   */
  inlineResponse?: Response | null;
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
  const { flowKind, requestId, startingAfter, lastEventId, enabled = true, reconnectToken, inlineResponse, onSessionMetadataChanged } = options;
  const { baseUrl } = useDevTool();
  // Identity of the last inline response we already consumed. An SSE response
  // body is one-shot — if the connect effect re-runs (e.g. startingAfter
  // changes) while the same response is still referenced, we must NOT try to
  // read the spent body again; fall back to GET instead.
  const consumedResponseRef = useRef<Response | null>(null);
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

    const callbacks: RequestSSECallbacks = {
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
        } else if (event.type === "request.suspended") {
          // FIX-811: a request that pauses at a ctx.suspend() gate streams
          // `request.suspended` then closes. Without this branch the DevTool
          // left the badge on "in_progress" until a manual refresh, hiding the
          // approval gate. Stop the live spinner; the segment is done until resume.
          state.status = "suspended";
          setStreamStatus("completed");
        } else if (event.type === "request.interrupted") {
          state.status = "interrupted";
          setStreamStatus("disconnected");
        } else if (event.type === "request.aborted") {
          state.status = "aborted";
          setStreamStatus("completed");
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
      onItemUpdated: (event) => {
        state.lastSequenceNumber = event.sequence_number;
        const existing = state.items.get(event.itemId);
        // Out-of-order: update arrived before item.added (e.g. mid-stream
        // reconnect). Drop silently — itemOrder isn't mutated either way.
        if (!existing) return;
        const sanitized: Record<string, unknown> = {};
        for (const key of Object.keys(event.patch)) {
          if ((ITEM_UPDATE_INVARIANT_KEYS as ReadonlyArray<string>).includes(key)) continue;
          sanitized[key] = event.patch[key];
        }
        state.items.set(event.itemId, { ...existing, ...sanitized } as OutputItem);
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
    };

    // Consume the streaming-resume response body directly when one is provided
    // and not already spent (FIX-276); otherwise open a GET stream.
    const useInline =
      inlineResponse != null && inlineResponse !== consumedResponseRef.current;
    const handle = useInline
      ? (consumedResponseRef.current = inlineResponse,
         consumeRequestStreamResponse(inlineResponse, callbacks))
      : connectRequestStream(
          flowKind,
          requestId,
          { startingAfter, lastEventId, ...callbacks },
          baseUrl,
        );

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
  }, [flowKind, requestId, startingAfter, lastEventId, enabled, reconnectToken, inlineResponse, baseUrl, close, scheduleFlush, flushNow, onSessionMetadataChanged]);

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
