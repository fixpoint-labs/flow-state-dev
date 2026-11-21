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
 *
 * `reconnect` hands a `{ requestId }` stream the client's own `reconnect`
 * option, which opens a dropped connection again until the request ends.
 * `client` streams through a host's own client instead of the provider's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bindStoreToCallbacks,
  createRequestStreamStore,
  createSSEClientFromResponse,
  type Client,
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
import { useClient } from "../internal/useClient";

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
  /** Bump to force a fresh re-subscribe for the same request id (e.g. resuming a suspended run under its original id). */
  reconnectToken?: number;
  /** Snapshot flush policy. `"raf"` (default) coalesces; `"immediate"` flushes synchronously. */
  flush?: "raf" | "immediate";
  /** `false` opens nothing, and a `{ requestId }` source needs no flow or id. Default `true`. */
  enabled?: boolean;
  /**
   * Open a `{ requestId }` stream again when it drops while the request is in
   * progress: the client's `request(id).stream({ reconnect: true })`, which
   * backs off, resumes after the last event and ends on a 401, 403 or 404.
   * Default `false`.
   */
  reconnect?: boolean;
  /**
   * The client to stream through, for a host that holds its own (its user,
   * origin and `fetcher`). Pass a stable reference. Default: the provider's
   * client.
   */
  client?: Pick<Client, "flow">;
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
  /**
   * When the request ended, in ms: the time of the status event that ended it
   * (`completed`, `failed`, `aborted`, `incomplete` or `interrupted`).
   * `undefined` while it runs or waits (`suspended`). A screen that follows
   * one request by id, rather than a session's latest turn, reads its end
   * time here: no session read names it.
   */
  readonly completedAt?: number;
  close: () => void;
};

/** The statuses a request ends on; `in_progress` and `suspended` haven't ended. */
const ENDED: ReadonlySet<RequestStatus> = new Set<RequestStatus>(["completed", "failed", "aborted", "incomplete", "interrupted"]);

/** The time of the status event `store`'s current status came from, when that status ended the request. */
function endedAt(store: RequestStreamStore): number | undefined {
  if (!ENDED.has(store.status)) return undefined;
  for (let i = store.statusEvents.length - 1; i >= 0; i -= 1) {
    const event = store.statusEvents[i]!;
    if (event.status === store.status) return typeof event.ts === "number" ? event.ts : undefined;
  }
  return undefined;
}

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
  // The request stream goes through the provider's transport (its fetcher), or the host's own client.
  const built = useClient({ baseUrl: options.baseUrl });
  const fsd = options.client ?? built;
  const {
    source,
    filter,
    includeTrace,
    reconnectToken,
    enabled = true,
    reconnect = false,
    onSessionMetadataChanged
  } = options;

  const isResponseSource = "response" in source;

  if (enabled && !isResponseSource) {
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
  const [completedAt, setCompletedAt] = useState<number | undefined>(undefined);
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
    setCompletedAt(endedAt(store));
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
    // Disabled: leave the last snapshot in place and don't subscribe. The prior
    // enabled run's cleanup already closed its handle; `isStreaming` reads false
    // via the `enabled` gate below. Resetting happens only when we (re)subscribe,
    // so a new stream always starts clean without wiping a paused one.
    if (!enabled) return;

    const store = storeRef.current!;
    store.clear();
    setItems([]);
    setStatus("in_progress");
    setCompletedAt(undefined);
    setEnded(false);

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

    // With `reconnect`, the client's stream opens a dropped connection again itself.
    const handle = responseObj
      ? createSSEClientFromResponse({ response: responseObj, ...callbacks })
      : fsd.flow(flowKind!).request(reqId!).stream({
          includeTrace,
          lastEventId: sourceLastEventId,
          startingAfter,
          ...(reconnect ? { reconnect: true } : {}),
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
    fsd,
    reconnectToken,
    includeTrace,
    filterKey,
    reqId,
    startingAfter,
    sourceLastEventId,
    responseObj,
    scheduleFlush,
    reconnect
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
  const isStreaming = enabled && !ended && status === "in_progress";
  const isFinishing = useMemo(
    () =>
      enabled &&
      status === "in_progress" &&
      items.some(
        (item) =>
          item.type === "status" && (item as StatusItem).blocked === false
      ),
    [enabled, items, status]
  );

  return {
    items,
    status,
    messages,
    blockOutputs,
    currentStatus,
    isStreaming,
    isFinishing,
    ...(completedAt === undefined ? {} : { completedAt }),
    get lastEventId() {
      return handleRef.current?.lastEventId;
    },
    close: () => {
      setEnded(true);
      handleRef.current?.close();
    }
  };
}
