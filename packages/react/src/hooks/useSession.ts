/**
 * Session-focused reactive hook for session lifecycle, request streaming, and item views.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClient,
  createSessionClient,
  createSSEClient,
  type ExecuteActionResponse,
  type RequestStreamHandle,
  type SessionDetail,
  type SessionStateSnapshotResponse
} from "@flow-state-dev/client";
import type {
  MessageItem,
  OutputItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";

/**
 * Items subscription configuration for useSession.
 */
export type SessionItemsOptions =
  | boolean
  | {
      visibility?: OutputItem["visibility"];
      includeTransient?: boolean;
      itemTypes?: string[];
    };

/**
 * Options for useSession.
 */
export type UseSessionHookOptions = {
  flowKind?: string;
  userId?: string;
  baseUrl?: string;
  items?: SessionItemsOptions;
};

/**
 * Reactive session view returned by useSession.
 */
export type SessionView = {
  readonly flowKind: string;
  readonly sessionId?: string;
  readonly userId: string;
  readonly isLoading: boolean;
  readonly isStreaming: boolean;
  readonly error: Error | null;
  readonly detail: SessionDetail | null;
  readonly snapshot: SessionStateSnapshotResponse | null;
  readonly items: OutputItem[];
  sendAction: (
    action: string,
    input: unknown
  ) => Promise<ExecuteActionResponse>;
  refresh: () => Promise<void>;
};

function normalizeFlowKind(flowKind: string): string {
  const trimmed = flowKind.trim();
  if (trimmed.length === 0) {
    throw new Error("useSession requires non-empty flow kind");
  }

  return trimmed;
}

function resolveItemsConfig(
  options: SessionItemsOptions | undefined
): {
  enabled: boolean;
  visibility?: OutputItem["visibility"];
  includeTransient: boolean;
  itemTypes?: string[];
} {
  if (options === false) {
    return {
      enabled: false,
      includeTransient: false
    };
  }

  if (typeof options === "object") {
    return {
      enabled: true,
      visibility: options.visibility,
      includeTransient: options.includeTransient === true,
      itemTypes: options.itemTypes
    };
  }

  return {
    enabled: true,
    includeTransient: false
  };
}

function passesItemFilter(
  item: OutputItem,
  filter: {
    visibility?: OutputItem["visibility"];
    includeTransient: boolean;
  }
): boolean {
  if (!filter.includeTransient && item.transient === true) {
    return false;
  }

  if (filter.visibility !== undefined && item.visibility !== filter.visibility) {
    return false;
  }

  return true;
}

/**
 * Sorts items chronologically by timestamp, with itemIndex as tiebreaker.
 *
 * itemIndex is per-request (resets to 0 for each action), so it cannot
 * serve as a global ordering key across multiple requests. Timestamp gives
 * cross-request ordering; itemIndex preserves intra-request ordering for
 * items created at the same millisecond.
 */
function sortItemsChronologically(items: OutputItem[]): OutputItem[] {
  return items.sort((left, right) => {
    const tsDiff = left.ts - right.ts;
    if (tsDiff !== 0) {
      return tsDiff;
    }

    return left.itemIndex - right.itemIndex;
  });
}

function filterAndSortItems(
  items: OutputItem[] | undefined,
  filter: {
    visibility?: OutputItem["visibility"];
    includeTransient: boolean;
  }
): OutputItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return sortItemsChronologically(
    [...items].filter((item) => passesItemFilter(item, filter))
  );
}

function upsertItem(items: OutputItem[], nextItem: OutputItem): OutputItem[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    const next = [...items, nextItem];
    return sortItemsChronologically(next);
  }

  const next = [...items];
  next[existingIndex] = nextItem;
  return sortItemsChronologically(next);
}

/**
 * Reactive session hook with auto-stream management and item-first defaults.
 *
 * `flowKind` defaults to `useFlowContext().flowKind` and can be overridden via options.
 */
export function useSession(
  sessionId: string | undefined,
  options?: UseSessionHookOptions
): SessionView {
  const context = useFlowContext();
  const resolvedFlowKind = normalizeFlowKind(options?.flowKind ?? context.flowKind ?? "");
  const userId = options?.userId ?? context.userId ?? "devuser";
  const baseUrl = options?.baseUrl ?? context.baseUrl;

  // Decompose the items option into stable primitives so that an inline object
  // literal (e.g. `{ itemTypes: ["message"] }`) doesn't cause a new reference
  // on every render, which would cascade through applySnapshot → useEffect →
  // fetch → setState → re-render → infinite loop.
  const itemsOption = options?.items;
  const itemsEnabled = itemsOption !== false;
  const itemsVisibility =
    typeof itemsOption === "object" && itemsOption !== null && !Array.isArray(itemsOption)
      ? (itemsOption as Exclude<SessionItemsOptions, boolean>).visibility
      : undefined;
  const itemsIncludeTransient =
    typeof itemsOption === "object" && itemsOption !== null && !Array.isArray(itemsOption)
      ? (itemsOption as Exclude<SessionItemsOptions, boolean>).includeTransient === true
      : false;
  const itemsTypesKey =
    typeof itemsOption === "object" && itemsOption !== null && !Array.isArray(itemsOption)
      ? (itemsOption as Exclude<SessionItemsOptions, boolean>).itemTypes?.join(",")
      : undefined;

  const itemConfig = useMemo(
    () => resolveItemsConfig(options?.items),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable primitives, not object ref
    [itemsEnabled, itemsVisibility, itemsIncludeTransient, itemsTypesKey]
  );

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [snapshot, setSnapshot] = useState<SessionStateSnapshotResponse | null>(null);
  const [items, setItems] = useState<OutputItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const streamHandleRef = useRef<RequestStreamHandle | null>(null);

  const sessionClient = useMemo(
    () => createSessionClient({ baseUrl }),
    [baseUrl]
  );

  const client = useMemo(
    () => createClient({ flowKind: resolvedFlowKind, userId, baseUrl }),
    [resolvedFlowKind, userId, baseUrl]
  );

  const applySnapshot = useCallback(
    (nextSnapshot: SessionStateSnapshotResponse) => {
      setSnapshot(nextSnapshot);
      if (!itemConfig.enabled) {
        setItems([]);
        return;
      }

      setItems(
        filterAndSortItems(nextSnapshot.items, {
          visibility: itemConfig.visibility,
          includeTransient: itemConfig.includeTransient
        })
      );
    },
    [itemConfig.enabled, itemConfig.includeTransient, itemConfig.visibility]
  );

  const refreshSnapshot = useCallback(async () => {
    if (sessionId === undefined) {
      return;
    }

    try {
      const [nextDetail, nextSnapshot] = await Promise.all([
        sessionClient.getSession(sessionId),
        sessionClient.getSessionState(sessionId, {
          includeItems: itemConfig.enabled,
          itemTypes: itemConfig.itemTypes
        })
      ]);

      setDetail(nextDetail);
      applySnapshot(nextSnapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, [sessionId, sessionClient, itemConfig.enabled, itemConfig.itemTypes, applySnapshot]);

  useEffect(() => {
    if (sessionId === undefined) {
      setDetail(null);
      setSnapshot(null);
      setItems([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const [nextDetail, nextSnapshot] = await Promise.all([
          sessionClient.getSession(sessionId),
          sessionClient.getSessionState(sessionId, {
            includeItems: itemConfig.enabled,
            itemTypes: itemConfig.itemTypes
          })
        ]);

        if (cancelled) {
          return;
        }

        setDetail(nextDetail);
        applySnapshot(nextSnapshot);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionClient, itemConfig.enabled, itemConfig.itemTypes, applySnapshot]);

  useEffect(() => {
    return () => {
      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }
    };
  }, [sessionId]);

  const sendAction = useCallback(
    async (
      action: string,
      input: unknown
    ): Promise<ExecuteActionResponse> => {
      if (sessionId === undefined) {
        throw new Error("useSession.sendAction requires a sessionId");
      }

      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }

      setError(null);

      // Generate requestId client-side so we can correlate POST with SSE stream.
      const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      try {
        // Fire POST first (non-blocking) — the server registers the LiveRequestStream
        // synchronously inside the POST handler *before* async execution starts.
        // By starting the POST first, we guarantee the stream is registered by the
        // time the SSE GET reaches the server (at least one network hop later).
        const postPromise = client.sendAction(action, input, {
          sessionId,
          requestId
        });

        // Connect SSE immediately — the POST has been dispatched and the server
        // will have registered the stream by the time this GET arrives. This enables
        // real-time token streaming instead of buffering everything until POST returns.
        if (itemConfig.enabled) {
          setIsStreaming(true);
          const filter = {
            visibility: itemConfig.visibility,
            includeTransient: itemConfig.includeTransient
          };

          const handle = createSSEClient({
            url: `/api/flows/${encodeURIComponent(resolvedFlowKind)}/requests/${encodeURIComponent(requestId)}/stream`,
            baseUrl,
            onItemAdded: (event) => {
              if (!passesItemFilter(event.item, filter)) {
                return;
              }

              // Respect itemTypes filter during streaming — server-side
              // filtering only applies to the initial snapshot, not live SSE events.
              if (
                itemConfig.itemTypes !== undefined &&
                itemConfig.itemTypes.length > 0 &&
                !itemConfig.itemTypes.includes(event.item.type)
              ) {
                return;
              }

              setItems((prev: OutputItem[]) => upsertItem(prev, event.item));

              if (event.item.type === "fsd:resource_update") {
                void refreshSnapshot();
              }
            },
            onItemDone: (event) => {
              setItems((prev: OutputItem[]) => upsertItem(prev, event.item));
            },
            onContentDelta: (event) => {
              setItems((prev: OutputItem[]) => {
                const target = prev.find((item) => item.id === event.itemId);
                if (target === undefined || target.type !== "message") {
                  return prev;
                }

                const message = target as MessageItem;
                const content = [...(message.content ?? [])];
                const part = content[event.contentIndex];
                if (part !== undefined && part.type === "output_text") {
                  content[event.contentIndex] = {
                    ...part,
                    text: (part.text ?? "") + event.delta
                  };
                }

                return upsertItem(prev, { ...message, content });
              });
            },
            onRequestStatus: (event) => {
              if (
                event.status === "completed" ||
                event.status === "failed" ||
                event.status === "incomplete"
              ) {
                setIsStreaming(false);
                streamHandleRef.current?.close();
                streamHandleRef.current = null;

                if (event.status === "completed") {
                  void refreshSnapshot();
                }
              }
            },
            onError: () => {
              setIsStreaming(false);
              streamHandleRef.current?.close();
              streamHandleRef.current = null;
            }
          });

          streamHandleRef.current = handle;
        }

        // Await the POST response after SSE is connected.
        const response = await postPromise;

        if (!itemConfig.enabled && response.status === "completed") {
          await refreshSnapshot();
        }

        return response;
      } catch (cause) {
        const normalized = cause instanceof Error ? cause : new Error(String(cause));
        setError(normalized);
        setIsStreaming(false);
        throw normalized;
      }
    },
    [
      sessionId,
      client,
      itemConfig.enabled,
      itemConfig.visibility,
      itemConfig.includeTransient,
      resolvedFlowKind,
      baseUrl,
      refreshSnapshot
    ]
  );

  const refresh = useCallback(async () => {
    await refreshSnapshot();
  }, [refreshSnapshot]);

  return {
    flowKind: resolvedFlowKind,
    sessionId,
    userId,
    isLoading,
    isStreaming,
    error,
    detail,
    snapshot,
    items,
    sendAction,
    refresh
  };
}
