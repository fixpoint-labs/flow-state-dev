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
  BlockOutputItem,
  FunctionCallItem,
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
  readonly messages: MessageItem[];
  readonly blockOutputs: BlockOutputItem[];
  readonly functionCalls: FunctionCallItem[];
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
      includeTransient: options.includeTransient === true
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

  return [...items]
    .filter((item) => passesItemFilter(item, filter))
    .sort((left, right) => left.itemIndex - right.itemIndex);
}

function upsertItem(items: OutputItem[], nextItem: OutputItem): OutputItem[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    const next = [...items, nextItem];
    next.sort((left, right) => left.itemIndex - right.itemIndex);
    return next;
  }

  const next = [...items];
  next[existingIndex] = nextItem;
  next.sort((left, right) => left.itemIndex - right.itemIndex);
  return next;
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

  const itemConfig = useMemo(
    () => resolveItemsConfig(options?.items),
    [options?.items]
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
          includeItems: itemConfig.enabled
        })
      ]);

      setDetail(nextDetail);
      applySnapshot(nextSnapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, [sessionId, sessionClient, itemConfig.enabled, applySnapshot]);

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
            includeItems: itemConfig.enabled
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
  }, [sessionId, sessionClient, itemConfig.enabled, applySnapshot]);

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

      try {
        const response = await client.sendAction(action, input, {
          sessionId
        });

        if (itemConfig.enabled && response.request?.id) {
          setIsStreaming(true);
          const filter = {
            visibility: itemConfig.visibility,
            includeTransient: itemConfig.includeTransient
          };

          const handle = createSSEClient({
            url: `/api/flows/${encodeURIComponent(resolvedFlowKind)}/requests/${encodeURIComponent(response.request.id)}/stream`,
            baseUrl,
            onItemAdded: (event) => {
              if (!passesItemFilter(event.item, filter)) {
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
        } else if (response.status === "completed") {
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

  const messages = useMemo(
    () => items.filter((item: OutputItem): item is MessageItem => item.type === "message"),
    [items]
  );
  const blockOutputs = useMemo(
    () =>
      items.filter((item: OutputItem): item is BlockOutputItem => item.type === "fsd:block_output"),
    [items]
  );
  const functionCalls = useMemo(
    () =>
      items.filter((item: OutputItem): item is FunctionCallItem => item.type === "function_call"),
    [items]
  );

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
    messages,
    blockOutputs,
    functionCalls,
    sendAction,
    refresh
  };
}
