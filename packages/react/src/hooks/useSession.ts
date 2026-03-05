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
  OutputItem,
  ReasoningItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";

/**
 * Client-audience item types used for default filtering.
 */
const CLIENT_ITEM_TYPES = new Set([
  "message",
  "reasoning",
  "component",
  "container",
  "status",
  "state_change",
  "resource_change",
  "error",
  "step_error"
]);

type ContentDeltaAccumulator = {
  itemId: string;
  contentIndex: number;
  delta: string;
};

/**
 * Items subscription configuration for useSession.
 */
export type SessionItemsOptions =
  | boolean
  | {
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
    includeTransient: boolean;
    itemTypes?: string[];
  }
): boolean {
  if (!filter.includeTransient && item.transient === true) {
    return false;
  }

  if (filter.itemTypes !== undefined && filter.itemTypes.length > 0) {
    return filter.itemTypes.includes(item.type);
  }

  return CLIENT_ITEM_TYPES.has(item.type);
}

function sortItemsChronologically(items: OutputItem[]): OutputItem[] {
  return items.sort((left, right) => {
    const tsDiff = left.ts - right.ts;
    if (tsDiff !== 0) {
      return tsDiff;
    }

    return left.itemIndex - right.itemIndex;
  });
}

function updateItemWithContentDelta(
  target: OutputItem,
  contentIndex: number,
  delta: string
): OutputItem {
  if (target.type === "message") {
    const message = target as MessageItem;
    const content = [...(message.content ?? [])];
    const part = content[contentIndex];
    if (part !== undefined && part.type === "output_text") {
      content[contentIndex] = {
        ...part,
        text: (part.text ?? "") + delta
      };
      return { ...message, content };
    }
  }

  if (target.type === "reasoning") {
    const reasoning = target as ReasoningItem;
    const summary = [...(reasoning.summary ?? [])];
    const part = summary[contentIndex];
    if (part !== undefined && part.type === "reasoning_text") {
      summary[contentIndex] = {
        ...part,
        text: (part.text ?? "") + delta
      };
      return { ...reasoning, summary };
    }
  }

  return target;
}

function buildItemsFromMap(
  ids: string[],
  itemsById: ReadonlyMap<string, OutputItem>
): OutputItem[] {
  const next: OutputItem[] = [];

  for (const id of ids) {
    const item = itemsById.get(id);
    if (item !== undefined) {
      next.push(item);
    }
  }

  return next;
}

function sameChronologicalOrder(left: OutputItem, right: OutputItem): boolean {
  return left.ts === right.ts && left.itemIndex === right.itemIndex;
}

export function useSession(
  sessionId: string | undefined,
  options?: UseSessionHookOptions
): SessionView {
  const context = useFlowContext();
  const resolvedFlowKind = normalizeFlowKind(options?.flowKind ?? context.flowKind ?? "");
  const userId = options?.userId ?? context.userId ?? "devuser";
  const baseUrl = options?.baseUrl ?? context.baseUrl;

  const itemsOption = options?.items;
  const itemsEnabled = itemsOption !== false;
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
    [itemsEnabled, itemsIncludeTransient, itemsTypesKey]
  );

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [snapshot, setSnapshot] = useState<SessionStateSnapshotResponse | null>(null);
  const [items, setItems] = useState<OutputItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const streamHandleRef = useRef<RequestStreamHandle | null>(null);
  const itemsByIdRef = useRef<Map<string, OutputItem>>(new Map());
  const sortedItemIdsRef = useRef<string[]>([]);
  const deltaQueueRef = useRef<Map<string, ContentDeltaAccumulator>>(new Map());
  const flushHandleRef = useRef<number | null>(null);

  const cancelScheduledFlush = useCallback(() => {
    if (flushHandleRef.current === null) {
      return;
    }

    if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(flushHandleRef.current);
    } else {
      clearTimeout(flushHandleRef.current);
    }

    flushHandleRef.current = null;
  }, []);

  const sessionClient = useMemo(
    () => createSessionClient({ baseUrl }),
    [baseUrl]
  );

  const client = useMemo(
    () => createClient({ flowKind: resolvedFlowKind, userId, baseUrl }),
    [resolvedFlowKind, userId, baseUrl]
  );

  const flushContentDeltas = useCallback(() => {
    flushHandleRef.current = null;

    if (deltaQueueRef.current.size === 0) {
      return;
    }

    let hasChanges = false;

    for (const queued of deltaQueueRef.current.values()) {
      const target = itemsByIdRef.current.get(queued.itemId);
      if (target === undefined) {
        continue;
      }

      const nextItem = updateItemWithContentDelta(
        target,
        queued.contentIndex,
        queued.delta
      );

      if (nextItem !== target) {
        itemsByIdRef.current.set(queued.itemId, nextItem);
        hasChanges = true;
      }
    }

    deltaQueueRef.current.clear();

    if (!hasChanges) {
      return;
    }

    setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
  }, []);

  const scheduleContentFlush = useCallback(() => {
    if (flushHandleRef.current !== null) {
      return;
    }

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      flushHandleRef.current = window.requestAnimationFrame(() => {
        flushContentDeltas();
      });
      return;
    }

    flushHandleRef.current = setTimeout(() => {
      flushContentDeltas();
    }, 0) as unknown as number;
  }, [flushContentDeltas]);

  const applySnapshot = useCallback(
    (nextSnapshot: SessionStateSnapshotResponse) => {
      setSnapshot(nextSnapshot);

      if (!itemConfig.enabled) {
        itemsByIdRef.current = new Map();
        sortedItemIdsRef.current = [];
        deltaQueueRef.current.clear();
        setItems([]);
        return;
      }

      const filtered = sortItemsChronologically(
        [...(nextSnapshot.items ?? [])].filter((item) =>
          passesItemFilter(item, {
            includeTransient: itemConfig.includeTransient,
            itemTypes: itemConfig.itemTypes
          })
        )
      );

      const nextMap = new Map<string, OutputItem>();
      for (const item of filtered) {
        nextMap.set(item.id, item);
      }

      itemsByIdRef.current = nextMap;
      sortedItemIdsRef.current = filtered.map((item) => item.id);
      deltaQueueRef.current.clear();
      setItems(filtered);
    },
    [itemConfig.enabled, itemConfig.includeTransient, itemConfig.itemTypes]
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
      itemsByIdRef.current = new Map();
      sortedItemIdsRef.current = [];
      deltaQueueRef.current.clear();
      cancelScheduledFlush();
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

      cancelScheduledFlush();
    };
  }, [sessionId, cancelScheduledFlush]);

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

      const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      try {
        const postPromise = client.sendAction(action, input, {
          sessionId,
          requestId
        });

        if (itemConfig.enabled) {
          setIsStreaming(true);
          const filter = {
            includeTransient: itemConfig.includeTransient,
            itemTypes: itemConfig.itemTypes
          };

          const handle = createSSEClient({
            url: `/api/flows/${encodeURIComponent(resolvedFlowKind)}/requests/${encodeURIComponent(requestId)}/stream`,
            baseUrl,
            onItemAdded: (event) => {
              if (!passesItemFilter(event.item, filter)) {
                return;
              }

              const existing = itemsByIdRef.current.get(event.item.id);
              const isNewItem = existing === undefined;
              const orderChanged =
                existing !== undefined && !sameChronologicalOrder(existing, event.item);

              itemsByIdRef.current.set(event.item.id, event.item);

              if (isNewItem || orderChanged) {
                const ordered = sortItemsChronologically([
                  ...itemsByIdRef.current.values()
                ]);
                sortedItemIdsRef.current = ordered.map((item) => item.id);
                setItems(ordered);
              } else {
                setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
              }

              if (event.item.type === "resource_change") {
                void refreshSnapshot();
              }
            },
            onItemDone: (event) => {
              if (!passesItemFilter(event.item, filter)) {
                return;
              }

              const existing = itemsByIdRef.current.get(event.item.id);
              const isNewItem = existing === undefined;
              const orderChanged =
                existing !== undefined && !sameChronologicalOrder(existing, event.item);

              itemsByIdRef.current.set(event.item.id, event.item);

              if (isNewItem || orderChanged) {
                const ordered = sortItemsChronologically([
                  ...itemsByIdRef.current.values()
                ]);
                sortedItemIdsRef.current = ordered.map((item) => item.id);
                setItems(ordered);
              } else {
                setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
              }
            },
            onContentDelta: (event) => {
              const key = `${event.itemId}:${event.contentIndex}`;
              const existing = deltaQueueRef.current.get(key);
              if (existing === undefined) {
                deltaQueueRef.current.set(key, {
                  itemId: event.itemId,
                  contentIndex: event.contentIndex,
                  delta: event.delta
                });
              } else {
                existing.delta += event.delta;
              }

              scheduleContentFlush();
            },
            onRequestStatus: (event) => {
              if (
                event.status === "completed" ||
                event.status === "failed" ||
                event.status === "incomplete"
              ) {
                flushContentDeltas();
                setIsStreaming(false);
                streamHandleRef.current?.close();
                streamHandleRef.current = null;

                if (event.status === "completed") {
                  void refreshSnapshot();
                }
              }
            },
            onError: () => {
              flushContentDeltas();
              setIsStreaming(false);
              streamHandleRef.current?.close();
              streamHandleRef.current = null;
            }
          });

          streamHandleRef.current = handle;
        }

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
      itemConfig.includeTransient,
      itemConfig.itemTypes,
      resolvedFlowKind,
      baseUrl,
      refreshSnapshot,
      scheduleContentFlush,
      flushContentDeltas
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
