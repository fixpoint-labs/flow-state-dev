/**
 * Low-level request-stream hook. Subscribes to one request's SSE stream and
 * maintains reactive item/status views, driven by the shared
 * `@flow-state-dev/client` request-stream store + `bindStoreToCallbacks` (the
 * single deduplicated SSE→state reducer). Content deltas flow through the store,
 * so streamed message and reasoning text accumulates token-by-token — the prior
 * hand-rolled reducer had no `content.delta` handler, so text only appeared all
 * at once when `item.done` landed.
 *
 * Two stream sources: `{ requestId }` opens a GET-by-id stream (the hook builds
 * the URL from `flowKind` + `requestId`); `{ response }` consumes a pre-fetched
 * POST Response body (inline streaming, e.g. serverless). Snapshots flush on a
 * RAF by default (live token rendering without thrashing React), or
 * synchronously with `flush: "immediate"` for low-volume or deterministic-test
 * use; `"raf"` auto-falls back to immediate when `requestAnimationFrame` is
 * unavailable (SSR / Node).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bindStoreToCallbacks,
  createRequestStreamStore,
  createSSEClient,
  createSSEClientFromResponse,
  type RequestStreamHandle,
  type RequestStreamStore
} from "@flow-state-dev/client";
import type {
  BlockTraceItem,
  MessageItem,
  OutputItem,
  RequestStatus,
  StatusItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";

/**
 * Type-based filter for request stream items. Items failing the predicate never
 * reach the store (gated at the binder's `itemFilter` seam).
 */
export type RequestStreamFilter = {
  itemTypes?: string[];
};

/**
 * Where the hook gets its stream. `{ requestId }` opens a GET-by-id stream;
 * `{ response }` consumes a pre-fetched POST Response (inline streaming).
 */
export type RequestStreamSource =
  | { requestId: string; startingAfter?: number; lastEventId?: string }
  | { response: Response };

/**
 * Options for useRequestStream.
 */
export type UseRequestStreamOptions = {
  flowKind?: string;
  baseUrl?: string;
  source: RequestStreamSource;
  filter?: RequestStreamFilter;
  /** Append `?include=trace` to the stream URL. Only meaningful for a `{ requestId }` source. */
  includeTrace?: boolean;
  /** Bump to force a fresh re-subscribe for the same request id (FIX-811 same-id reconnect). */
  reconnectToken?: number;
  /** Snapshot flush policy. `"raf"` (default) coalesces; `"immediate"` flushes synchronously. */
  flush?: "raf" | "immediate";
  enabled?: boolean;
  onSessionMetadataChanged?: () => void;
};

/**
 * Return type for useRequestStream.
 */
export type UseRequestStreamResult = {
  readonly items: OutputItem[];
  readonly status: RequestStatus;
  readonly messages: MessageItem[];
  readonly blockOutputs: BlockTraceItem[];
  readonly currentStatus?: StatusItem;
  readonly isStreaming: boolean;
  /** True when the main execution chain has completed but background work tasks are still running. */
  readonly isFinishing: boolean;
  readonly lastEventId?: string;
  close: () => void;
};

function passesTypeFilter(
  item: OutputItem,
  filter: RequestStreamFilter | undefined
): boolean {
  if (filter?.itemTypes === undefined) return true;
  return filter.itemTypes.includes(item.type);
}

/**
 * Low-level escape-hatch hook for subscribing to one request stream.
 */
export function useRequestStream(
  options: UseRequestStreamOptions
): UseRequestStreamResult {
  const context = useFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const baseUrl = options.baseUrl ?? context.baseUrl;
  const {
    source,
    filter,
    includeTrace,
    reconnectToken,
    enabled = true,
    onSessionMetadataChanged
  } = options;

  const isResponseSource = "response" in source;

  if (!isResponseSource) {
    if (!flowKind?.trim()) {
      throw new Error(
        "useRequestStream requires flowKind (option or FlowProvider) for a { requestId } source"
      );
    }
    if (!source.requestId.trim()) {
      throw new Error("useRequestStream requires a non-empty requestId");
    }
  }

  // Default to RAF coalescing; fall back to immediate when rAF is unavailable
  // (SSR / Node), and honor an explicit "immediate" opt-in for determinism.
  const flushMode: "raf" | "immediate" =
    options.flush === "immediate" || typeof requestAnimationFrame === "undefined"
      ? "immediate"
      : "raf";

  const [items, setItems] = useState<OutputItem[]>([]);
  const [status, setStatus] = useState<RequestStatus>("in_progress");
  // Transport error or manual close — distinct from a terminal request status.
  const [ended, setEnded] = useState(false);

  const storeRef = useRef<RequestStreamStore | null>(null);
  if (storeRef.current === null) storeRef.current = createRequestStreamStore();
  const handleRef = useRef<RequestStreamHandle | null>(null);
  const rafRef = useRef<number | null>(null);

  // Latest-callback ref so an inline `onSessionMetadataChanged` doesn't force a
  // re-subscribe every render (it's intentionally absent from the effect deps).
  const onSessionMetadataChangedRef = useRef(onSessionMetadataChanged);
  onSessionMetadataChangedRef.current = onSessionMetadataChanged;

  const flush = useCallback(() => {
    const store = storeRef.current;
    if (!store) return;
    store.flushDeltas();
    setItems(store.getSorted());
    setStatus(store.status);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushMode === "immediate") {
      flush();
      return;
    }
    if (rafRef.current !== null) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flush();
    });
  }, [flush, flushMode]);

  // Extract primitive source-identity deps so a fresh `source`/`filter` object
  // literal each render doesn't force a re-subscribe (`filter` is referenced
  // inside the effect; `filterKey` is its stable proxy).
  const reqId = isResponseSource ? null : source.requestId;
  const startingAfter = isResponseSource ? undefined : source.startingAfter;
  const sourceLastEventId = isResponseSource ? undefined : source.lastEventId;
  const responseObj = isResponseSource ? source.response : null;
  const filterKey = filter?.itemTypes?.join(",");

  useEffect(() => {
    const store = storeRef.current!;
    store.clear();
    setItems([]);
    setStatus("in_progress");
    setEnded(false);

    if (!enabled) return;

    const callbacks = {
      ...bindStoreToCallbacks(store, {
        onChange: scheduleFlush,
        itemFilter: filter ? (item) => passesTypeFilter(item, filter) : undefined
      }),
      onSessionMetadataChanged: () => onSessionMetadataChangedRef.current?.(),
      onError: () => {
        setEnded(true);
      }
    };

    const handle = responseObj
      ? createSSEClientFromResponse({ response: responseObj, ...callbacks })
      : createSSEClient({
          url: `/api/flows/${encodeURIComponent(flowKind!)}/requests/${encodeURIComponent(reqId!)}/stream${includeTrace ? "?include=trace" : ""}`,
          baseUrl,
          lastEventId: sourceLastEventId,
          startingAfter,
          ...callbacks
        });

    handleRef.current = handle;

    return () => {
      handle.close();
      handleRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    enabled,
    flowKind,
    baseUrl,
    reconnectToken,
    includeTrace,
    filterKey,
    reqId,
    startingAfter,
    sourceLastEventId,
    responseObj,
    scheduleFlush
  ]);

  const messages = useMemo(
    () =>
      items.filter(
        (item: OutputItem): item is MessageItem => item.type === "message"
      ),
    [items]
  );

  const blockOutputs = useMemo(
    () =>
      // `block_output` arrives via the trace channel; not in the public
      // OutputItem union. Cast at the boundary.
      (items as Array<OutputItem | BlockTraceItem>).filter(
        (item): item is BlockTraceItem =>
          (item as { type: string }).type === "block_trace"
      ),
    [items]
  );

  const currentStatus = useMemo(() => {
    const statusItems = items.filter(
      (item: OutputItem): item is StatusItem => item.type === "status"
    );
    return statusItems[statusItems.length - 1];
  }, [items]);

  // Streaming while the request is live and not torn down. Finishing once the
  // main chain reports an unblocked status item but the request hasn't settled —
  // background work tasks are still running.
  const isStreaming = !ended && status === "in_progress";
  const isFinishing = useMemo(
    () =>
      status === "in_progress" &&
      items.some(
        (item) =>
          item.type === "status" && (item as StatusItem).blocked === false
      ),
    [items, status]
  );

  return {
    items,
    status,
    messages,
    blockOutputs,
    currentStatus,
    isStreaming,
    isFinishing,
    get lastEventId() {
      return handleRef.current?.lastEventId;
    },
    close: () => {
      setEnded(true);
      handleRef.current?.close();
    }
  };
}
