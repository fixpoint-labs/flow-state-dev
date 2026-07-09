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

  // Owner token (bumped whenever flowKind/sessionId changes) so a `/continue`
  // POST still in flight when the caller switches flow/session can detect,
  // after its await, that it's no longer for the current owner and bail
  // before wiring a handle or calling onItems/onSettled into the new view.
  // The unmount/switch cleanup effect below only closes handles that already
  // exist in `handlesRef` — a pending POST has no handle yet, so it needs
  // this separate guard.
  const ownerRef = useRef(0);
  useEffect(() => {
    ownerRef.current += 1;
  }, [flowKind, sessionId]);

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
      const owner = ownerRef.current;

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

      // The caller switched flow/session while this POST was in flight — its
      // response belongs to a view that's gone. There's no handle for the
      // unmount/switch cleanup effect to have closed, so bail here instead of
      // wiring callbacks that would write into the current (unrelated) view.
      // Clear the `activeIds` entry directly (not via `stop()`) — this
      // request never got a real continuation for the new owner, so
      // `onSettled` (a signal to refresh the row) doesn't apply here.
      if (owner !== ownerRef.current) {
        response.body?.cancel().catch(() => {});
        setActiveIds((prev) => {
          if (!prev.has(requestId)) return prev;
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
        return;
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
        // The stream can end without ever emitting a terminal status (e.g. a
        // pre-transition recovery failure) — without this, the row stays
        // "continuing" until the panel remounts.
        onClose: () => {
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
      if (handlesRef.current.size === 0) return;
      const closedIds = Array.from(handlesRef.current.keys());
      for (const handle of handlesRef.current.values()) handle.close();
      handlesRef.current.clear();
      // `handle.close()` marks the SSE client `closed` before it can fire
      // onClose/onError, so `stop()` never runs for these ids — clear
      // `activeIds` directly or switching back to this session would show
      // the row stuck "continuing" until the panel remounts.
      setActiveIds((prev) => {
        const next = new Set(prev);
        for (const id of closedIds) next.delete(id);
        return next;
      });
    };
  }, [flowKind, sessionId]);

  return { continueRequest, isContinuing };
}
