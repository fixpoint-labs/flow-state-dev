/**
 * DevTool request-stream hook. Subscribes to a request's SSE stream and drives
 * the shared `RequestStreamStore` (the one deduplicated SSE→state reducer in
 * `@flow-state-dev/client`) via `bindStoreToCallbacks`, exposing a
 * `streamState` snapshot the panel renders. Item/content changes coalesce on a
 * RAF; status transitions flush immediately so the request badge updates
 * without a frame's lag. The DevTool always GET-streams by request id (with
 * `?include=trace`) and shows every item — it does not pass an `itemFilter`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutputItem, RequestStatus, RequestStatusEvent } from "@flow-state-dev/core/items";
import {
  bindStoreToCallbacks,
  createRequestStreamStore,
  type RequestStreamChangeKind,
  type RequestStreamHandle,
  type RequestStreamStore,
} from "@flow-state-dev/client";
import { connectRequestStream } from "../lib/client";
import { useDevTool } from "../context/devtool-context";

export type StreamStatus = "idle" | "connecting" | "streaming" | "completed" | "failed" | "disconnected";

export type StreamState = {
  requestId: string;
  status: RequestStatus;
  items: Map<string, OutputItem>;
  itemOrder: string[];
  lastSequenceNumber: number;
  /** Every `request.*` status event seen, in arrival order (the resume cursor). */
  statusEvents: RequestStatusEvent[];
  /**
   * Chronological items WITHOUT the canonical (crash-recovery) collapse —
   * the superseded pre-recovery rows `items`/`itemOrder` strip are still
   * present here, for consumers that need to render the recovery boundary
   * itself rather than just the merged live view.
   */
  rawItems: OutputItem[];
};

/**
 * Map the store's `RequestStatus` onto the panel's coarser connection-phase
 * status. The connecting/idle/disconnected phases are owned by the hook (set
 * imperatively around connect/error); terminal request states collapse to
 * `completed`/`failed` for badge display.
 */
function deriveStreamStatus(status: RequestStatus): StreamStatus {
  switch (status) {
    case "completed":
    case "incomplete":
    case "suspended":
    case "aborted":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "disconnected";
    case "in_progress":
    default:
      return "streaming";
  }
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
  const { flowKind, requestId, startingAfter, lastEventId, enabled = true, reconnectToken, onSessionMetadataChanged } = options;
  const { baseUrl, config } = useDevTool();
  const bearerToken = config.bearerToken;
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<RequestStreamHandle | null>(null);

  // The shared reducer lives outside React state for the whole hook lifetime;
  // each (re)connect `clear()`s it. Snapshots are flushed into React state via
  // RAF throttling (items/content) or immediately (status).
  const storeRef = useRef<RequestStreamStore | null>(null);
  if (storeRef.current === null) storeRef.current = createRequestStreamStore();
  const requestIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const isDirtyRef = useRef(false);

  // Build a fresh immutable snapshot of the store for React. The store already
  // returns fresh arrays/objects (canonical-collapsed, sorted), so no deep copy
  // is needed — we just project the sorted view into the panel's shape.
  const buildSnapshot = useCallback((): StreamState | null => {
    const store = storeRef.current;
    const rid = requestIdRef.current;
    if (!store || rid === null) return null;
    const items = store.getSorted();
    const map = new Map<string, OutputItem>();
    const itemOrder: string[] = [];
    for (const item of items) {
      map.set(item.id, item);
      itemOrder.push(item.id);
    }
    return {
      requestId: rid,
      status: store.status,
      items: map,
      itemOrder,
      lastSequenceNumber: store.lastSequenceNumber,
      statusEvents: [...store.statusEvents],
      rawItems: store.getRaw(),
    };
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled
    isDirtyRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (isDirtyRef.current) {
        isDirtyRef.current = false;
        storeRef.current?.flushDeltas();
        setStreamState(buildSnapshot());
      }
    });
  }, [buildSnapshot]);

  /** Flush immediately for important state transitions (status changes). */
  const flushNow = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    isDirtyRef.current = false;
    storeRef.current?.flushDeltas();
    setStreamState(buildSnapshot());
  }, [buildSnapshot]);

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
    const store = storeRef.current!;

    if (!enabled || !flowKind || !requestId) {
      close();
      if (!requestId) {
        requestIdRef.current = null;
        store.clear();
        setStreamState(null);
        setStreamStatus("idle");
      }
      return;
    }

    close();
    store.clear();
    requestIdRef.current = requestId;
    setStreamState(buildSnapshot());
    setStreamStatus("connecting");
    setError(null);

    // Item/content mutations coalesce on a RAF; status changes are handled by
    // the wrapped status callbacks below (which flush immediately), so they are
    // skipped here to avoid a redundant second flush.
    const onChange = (kind: RequestStreamChangeKind): void => {
      if (kind === "status") return;
      scheduleFlush();
    };

    const binder = bindStoreToCallbacks(store, { onChange });

    const handle = connectRequestStream(flowKind, requestId, {
      startingAfter,
      lastEventId,
      ...binder,
      onRequestCreated: (event) => {
        binder.onRequestCreated?.(event);
        setStreamStatus("streaming");
        flushNow();
      },
      onRequestStatus: (event) => {
        binder.onRequestStatus?.(event);
        setStreamStatus(deriveStreamStatus(store.status));
        flushNow();
      },
      onSessionMetadataChanged: onSessionMetadataChanged
        ? () => { onSessionMetadataChanged(); }
        : undefined,
      onError: (err) => {
        setError(err.message);
        setStreamStatus("disconnected");
      },
    }, baseUrl, bearerToken);

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
  }, [flowKind, requestId, startingAfter, lastEventId, enabled, reconnectToken, baseUrl, bearerToken, close, scheduleFlush, flushNow, buildSnapshot, onSessionMetadataChanged]);

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
