/**
 * Per-row crash-recovery continuation (FIX-865). Unlike the legacy top-level
 * Resume button (which dispatched the JSON `recoveryClient.continue()` and
 * relied on the shared `useRequestStream` GET reconnect to pick the run back
 * up), this hook drives `recoveryClient.continueStream()` directly: the POST
 * response IS the SSE stream, so serverless deployments without shared
 * pub/sub still see the continued run live (mirrors
 * `resumeSuspensionStream`'s inline-streaming approach).
 *
 * Each call gets its own `RequestStreamStore`, seeded with the row's existing
 * items via `loadSnapshot` — the continuation stream only adds to that seed,
 * it never clears it. Because each request id gets its own store/handle, two
 * interrupted rows can be continued independently without either affecting
 * the other's state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  bindStoreToCallbacks,
  createRequestStreamStore,
  createSSEClientFromResponse,
  type RecoveryClient,
  type RequestStreamHandle,
} from "@flow-state-dev/client";

export type UseContinueRequestOptions = {
  recoveryClient: RecoveryClient;
  flowKind: string | null;
  sessionId: string | null;
  /**
   * Called whenever the continuation stream's merged view changes. `items` is
   * the canonical (collapsed) view; `rawItems` is the same set without the
   * crash-recovery collapse, for callers that need to render the recovery
   * boundary itself.
   */
  onItems: (requestId: string, items: OutputItem[], rawItems: OutputItem[]) => void;
  /**
   * Called once the continuation is no longer live for this request — either
   * a terminal status arrived over the inline stream, or the server fell back
   * to the non-streaming 202 JSON response. The row's status in the polled
   * request list is stale at that point (still `interrupted`), so callers
   * should refresh it.
   */
  onSettled?: (requestId: string) => void;
};

export type UseContinueRequestResult = {
  /** Continue an interrupted request under its own id, seeded with its existing items. */
  continueRequest: (requestId: string, existingItems: OutputItem[]) => Promise<void>;
  /** True while a continuation stream is open for the given request id. */
  isContinuing: (requestId: string) => boolean;
};

export function useContinueRequest(options: UseContinueRequestOptions): UseContinueRequestResult {
  const { recoveryClient, flowKind, sessionId, onItems, onSettled } = options;
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set());
  const handlesRef = useRef<Map<string, RequestStreamHandle>>(new Map());

  const stop = useCallback(
    (requestId: string) => {
      handlesRef.current.get(requestId)?.close();
      handlesRef.current.delete(requestId);
      setActiveIds((prev) => {
        if (!prev.has(requestId)) return prev;
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
      onSettled?.(requestId);
    },
    [onSettled],
  );

  const continueRequest = useCallback(
    async (requestId: string, existingItems: OutputItem[]) => {
      if (!flowKind || !sessionId) return;

      // Mark this row as continuing BEFORE the POST resolves, not after — the
      // per-row guard (`isContinuing`) must cover the pending-request window
      // too, or a slow network lets the row get clicked again before the menu
      // hides the action, firing a duplicate POST. Clear it again on failure.
      setActiveIds((prev) => new Set(prev).add(requestId));

      let response: Response;
      try {
        response = await recoveryClient.continueStream({
          flowKind,
          sessionId,
          requestId,
          includeTrace: true,
        });
      } catch (err) {
        setActiveIds((prev) => {
          if (!prev.has(requestId)) return prev;
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
        throw err;
      }

      // The route can legally fall back to the non-streaming 202 JSON
      // response (e.g. no inline live stream available). The continuation is
      // still accepted server-side, so treat it the same as a terminal status:
      // stop tracking it as continuing and let the caller refresh the row.
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        response.body?.cancel().catch(() => {});
        stop(requestId);
        return;
      }

      // Seed with the row's existing items so the continuation stream merges
      // on top rather than clearing them.
      const store = createRequestStreamStore();
      store.loadSnapshot(existingItems);

      // `bindStoreToCallbacks` buffers content.delta events; flushDeltas()
      // must run before reading a snapshot or generator text never appears
      // until a later content.done/replacement (mirrors use-request-stream's
      // flush pattern).
      const flush = () => {
        store.flushDeltas();
        onItems(requestId, store.getSorted(), store.getRaw());
      };
      const binder = bindStoreToCallbacks(store, { onChange: flush });

      const handle = createSSEClientFromResponse({
        response,
        ...binder,
        onRequestStatus: (event) => {
          binder.onRequestStatus?.(event);
          flush();
          if (event.status !== "in_progress") stop(requestId);
        },
        onError: () => {
          stop(requestId);
        },
      });

      handlesRef.current.set(requestId, handle);
    },
    [flowKind, sessionId, recoveryClient, onItems, stop],
  );

  const isContinuing = useCallback((requestId: string) => activeIds.has(requestId), [activeIds]);

  // Close every open continuation stream when the panel unmounts or switches
  // to a different flow/session — otherwise a mid-stream continuation keeps
  // consuming its response and calling onItems/onSettled against a stale or
  // unmounted owner.
  useEffect(() => {
    return () => {
      for (const handle of handlesRef.current.values()) handle.close();
      handlesRef.current.clear();
    };
  }, [flowKind, sessionId]);

  return { continueRequest, isContinuing };
}
