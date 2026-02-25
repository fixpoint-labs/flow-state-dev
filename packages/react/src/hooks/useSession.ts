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

  // Default: client-visible items, no transients.
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

  // Type-based audience filtering: if explicit types provided, use those;
  // otherwise default to client-audience types.
  if (filter.itemTypes !== undefined && filter.itemTypes.length > 0) {
    return filter.itemTypes.includes(item.type);
  }

  return CLIENT_ITEM_TYPES.has(item.type);
}

/**
 * Sorts items chronologically by timestamp, with itemIndex as tiebreaker.
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
    includeTransient: boolean;
    itemTypes?: string[];
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
  // literal doesn't cause a new reference on every render.
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
          includeTransient: itemConfig.includeTransient,
          itemTypes: itemConfig.itemTypes
        })
      );
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

              setItems((prev: OutputItem[]) => upsertItem(prev, event.item));

              // Refresh snapshot on resource changes to keep state views current.
              if (event.item.type === "resource_change") {
                void refreshSnapshot();
              }
            },
            onItemDone: (event) => {
              if (!passesItemFilter(event.item, filter)) {
                return;
              }

              setItems((prev: OutputItem[]) => upsertItem(prev, event.item));
            },
            onContentDelta: (event) => {
              setItems((prev: OutputItem[]) => {
                const target = prev.find((item) => item.id === event.itemId);
                if (target === undefined) return prev;

                if (target.type === "message") {
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
                }

                if (target.type === "reasoning") {
                  const reasoning = target as ReasoningItem;
                  const summary = [...(reasoning.summary ?? [])];
                  const part = summary[event.contentIndex];
                  if (part !== undefined && part.type === "reasoning_text") {
                    summary[event.contentIndex] = {
                      ...part,
                      text: (part.text ?? "") + event.delta
                    };
                  }
                  return upsertItem(prev, { ...reasoning, summary });
                }

                return prev;
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
