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
import { useCallback, useRef, useState } from "react";
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
};

export type UseContinueRequestResult = {
  /** Continue an interrupted request under its own id, seeded with its existing items. */
  continueRequest: (requestId: string, existingItems: OutputItem[]) => Promise<void>;
  /** True while a continuation stream is open for the given request id. */
  isContinuing: (requestId: string) => boolean;
};

export function useContinueRequest(options: UseContinueRequestOptions): UseContinueRequestResult {
  const { recoveryClient, flowKind, sessionId, onItems } = options;
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set());
  const handlesRef = useRef<Map<string, RequestStreamHandle>>(new Map());

  const stop = useCallback((requestId: string) => {
    handlesRef.current.get(requestId)?.close();
    handlesRef.current.delete(requestId);
    setActiveIds((prev) => {
      if (!prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }, []);

  const continueRequest = useCallback(
    async (requestId: string, existingItems: OutputItem[]) => {
      if (!flowKind || !sessionId) return;

      const response = await recoveryClient.continueStream({ flowKind, sessionId, requestId });

      // Seed with the row's existing items so the continuation stream merges
      // on top rather than clearing them.
      const store = createRequestStreamStore();
      store.loadSnapshot(existingItems);

      setActiveIds((prev) => new Set(prev).add(requestId));

      const flush = () => onItems(requestId, store.getSorted(), store.getRaw());
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

  return { continueRequest, isContinuing };
}
