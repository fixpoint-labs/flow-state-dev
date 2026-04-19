/**
 * Session-focused reactive hook for session lifecycle, request streaming, and item views.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClient,
  createSessionClient,
  createSSEClient,
  createSSEClientFromResponse,
  type ExecuteActionResponse,
  type RequestSSECallbacks,
  type RequestStreamHandle,
  type SessionDetail,
  type SessionStateSnapshotResponse
} from "@flow-state-dev/client";
import type {
  Content,
  MessageItem,
  OutputItem,
  ReasoningItem,
  SessionMetadataChangedEvent
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";

/**
 * Client-audience item types used for default filtering.
 */
const CLIENT_ITEM_TYPES = new Set([
  "message",
  "reasoning",
  "block_tool_output",
  "component",
  "container",
  "status",
  "source",
  "state_change",
  "resource_change",
  "error",
  "step_error"
]);

const DEFAULT_STATE_PAGE_LIMIT = 100;

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
  /**
   * When true, on mount the hook checks if the session has an in-progress
   * request and re-attaches to its stream using cursor-based continuation.
   * Default: false.
   */
  autoResume?: boolean;
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
  /** True when the main execution chain has completed but background work tasks are still running. */
  readonly isFinishing: boolean;
  /** True when the session can accept a new sendAction call (not blocked by an in-flight request). */
  readonly canSendAction: boolean;
  readonly error: Error | null;
  readonly detail: SessionDetail | null;
  readonly snapshot: SessionStateSnapshotResponse | null;
  readonly items: OutputItem[];
  /** Returns items owned by a container scope (items where `ownedBy === blockInstanceId`). */
  getOwnedItems: (ownedBy: string) => OutputItem[];
  sendAction: (
    action: string,
    input: unknown,
    options?: { metadata?: Record<string, unknown>; userMessage?: string }
  ) => Promise<ExecuteActionResponse>;
  /** Abort the currently in-flight request. No-op if nothing is in flight. */
  abortRequest: () => Promise<void>;
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

function updateItemWithContentAdded(
  target: OutputItem,
  _contentIndex: number,
  content: Content
): OutputItem {
  if (target.type === "message") {
    const message = target as MessageItem;
    const parts = [...(message.content ?? []), content];
    return { ...message, content: parts };
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

/**
 * Compares two items for chronological ordering (ts first, itemIndex tiebreaker).
 * Returns negative if a < b, positive if a > b, zero if equal.
 */
function compareItemOrder(a: OutputItem, b: OutputItem): number {
  const tsDiff = a.ts - b.ts;
  if (tsDiff !== 0) return tsDiff;
  return a.itemIndex - b.itemIndex;
}

/**
 * Inserts an item ID into a sorted ID array using binary search.
 * Items nearly always arrive in chronological order, so we check the tail first
 * for an O(1) fast path before falling back to binary search + splice.
 */
function insertSortedItemId(
  sortedIds: string[],
  newItem: OutputItem,
  itemsById: ReadonlyMap<string, OutputItem>
): string[] {
  const next = [...sortedIds];
  const len = next.length;

  // Fast path: item belongs at the end (most common during streaming).
  if (len === 0) {
    next.push(newItem.id);
    return next;
  }

  const lastItem = itemsById.get(next[len - 1]!);
  if (lastItem !== undefined && compareItemOrder(newItem, lastItem) >= 0) {
    next.push(newItem.id);
    return next;
  }

  // Binary search for insertion position.
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midItem = itemsById.get(next[mid]!);
    if (midItem !== undefined && compareItemOrder(midItem, newItem) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  next.splice(lo, 0, newItem.id);
  return next;
}
export function useSession(
  sessionId: string | undefined,
  options?: UseSessionHookOptions
): SessionView {
  const context = useFlowContext();
  const resolvedFlowKind = normalizeFlowKind(options?.flowKind ?? context.flowKind ?? "");
  const userId = options?.userId ?? context.userId ?? "devuser";
  const baseUrl = options?.baseUrl ?? context.baseUrl;
  const autoResume = options?.autoResume === true;

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
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const streamHandleRef = useRef<RequestStreamHandle | null>(null);
  /** The requestId of the currently in-flight request, used for abort. */
  const activeRequestIdRef = useRef<string | null>(null);
  const itemsByIdRef = useRef<Map<string, OutputItem>>(new Map());
  const sortedItemIdsRef = useRef<string[]>([]);
  const deltaQueueRef = useRef<Map<string, ContentDeltaAccumulator>>(new Map());
  const flushHandleRef = useRef<number | null>(null);
  const optimisticIdRef = useRef<string | null>(null);
  /** Maps container ownedBy values to sets of item IDs for O(1) container lookups. */
  const ownershipIndexRef = useRef<Map<string, Set<string>>>(new Map());
  /** Tracks whether resource changes occurred during streaming, so we can batch one refresh at completion. */
  const resourceChangedDuringStreamRef = useRef(false);

  /** Track an item's ownedBy in the ownership index. */
  const trackOwnership = useCallback((item: OutputItem) => {
    const ownedBy = (item as OutputItem & { ownedBy?: string }).ownedBy;
    if (ownedBy === undefined) return;
    let set = ownershipIndexRef.current.get(ownedBy);
    if (set === undefined) {
      set = new Set();
      ownershipIndexRef.current.set(ownedBy, set);
    }
    set.add(item.id);
  }, []);

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
        ownershipIndexRef.current = new Map();
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
      const nextOwnership = new Map<string, Set<string>>();
      for (const item of filtered) {
        nextMap.set(item.id, item);
        const ownedBy = (item as OutputItem & { ownedBy?: string }).ownedBy;
        if (ownedBy !== undefined) {
          let set = nextOwnership.get(ownedBy);
          if (set === undefined) {
            set = new Set();
            nextOwnership.set(ownedBy, set);
          }
          set.add(item.id);
        }
      }

      itemsByIdRef.current = nextMap;
      sortedItemIdsRef.current = filtered.map((item) => item.id);
      deltaQueueRef.current.clear();
      ownershipIndexRef.current = nextOwnership;
      setItems(filtered);
    },
    [itemConfig.enabled, itemConfig.includeTransient, itemConfig.itemTypes]
  );

  const fetchSessionSnapshot = useCallback(async (): Promise<SessionStateSnapshotResponse | null> => {
    if (sessionId === undefined) {
      return null;
    }

    if (!itemConfig.enabled) {
      return sessionClient.getSessionState(sessionId, {
        includeItems: false
      });
    }

    let offset = 0;
    let merged: SessionStateSnapshotResponse | null = null;
    const mergedItems: OutputItem[] = [];

    while (true) {
      const page = await sessionClient.getSessionState(sessionId, {
        includeItems: true,
        itemTypes: itemConfig.itemTypes,
        offset,
        limit: DEFAULT_STATE_PAGE_LIMIT
      });

      if (merged === null) {
        merged = page;
      }

      if (Array.isArray(page.items) && page.items.length > 0) {
        mergedItems.push(...page.items);
      }

      if (page.pagination?.hasMore !== true) {
        break;
      }

      offset = page.pagination.nextOffset;
    }

    if (merged === null) {
      return null;
    }

    return {
      ...merged,
      items: mergedItems,
      pagination: {
        offset: 0,
        limit: mergedItems.length,
        total: mergedItems.length,
        hasMore: false,
        nextOffset: mergedItems.length
      }
    };
  }, [sessionId, sessionClient, itemConfig.enabled, itemConfig.itemTypes]);

  const refreshSnapshot = useCallback(async () => {
    if (sessionId === undefined) {
      return;
    }

    try {
      const [nextDetail, nextSnapshot] = await Promise.all([
        sessionClient.getSession(sessionId),
        fetchSessionSnapshot()
      ]);

      setDetail(nextDetail);
      if (nextSnapshot !== null) {
        applySnapshot(nextSnapshot);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, [sessionId, sessionClient, itemConfig.enabled, itemConfig.itemTypes, applySnapshot]);

  /**
   * Attach to an existing request's stream, optionally resuming from a cursor.
   * Used by both sendAction (new requests) and autoResume (in-progress requests).
   *
   * When `inlineResponse` is provided, SSE events are consumed directly from
   * the POST action response body (inline streaming) instead of opening a
   * separate GET connection. This is essential on serverless platforms where
   * POST and GET may hit different instances.
   */
  const attachToStream = useCallback(
    (requestId: string, startingAfter?: string, inlineResponse?: Response) => {
      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }

      setIsStreaming(true);
      setIsFinishing(false);

      const filter = {
        includeTransient: itemConfig.includeTransient,
        itemTypes: itemConfig.itemTypes
      };

      const sseCallbacks: RequestSSECallbacks = {
        onItemAdded: (event) => {
          if (event.item.type === "status" && (event.item as OutputItem & { message?: string }).message === "finishing") {
            setIsFinishing(true);
          }

          // Track that resources changed during streaming. Rather than firing
          // individual HTTP fetches per resource_change (which creates bursts
          // during artifact-heavy flows), we batch into one refresh at request
          // completion. The onRequestStatus handler checks this flag.
          if (event.item.type === "resource_change") {
            resourceChangedDuringStreamRef.current = true;
          }

          if (!passesItemFilter(event.item, filter)) {
            return;
          }

          // When the real server user message arrives, remove the optimistic
          // placeholder so we don't show duplicates.
          const serverItem = event.item as OutputItem & { role?: string };
          if (
            serverItem.type === "message" &&
            serverItem.role === "user" &&
            optimisticIdRef.current !== null
          ) {
            itemsByIdRef.current.delete(optimisticIdRef.current);
            optimisticIdRef.current = null;
          }

          const existing = itemsByIdRef.current.get(event.item.id);
          const isNewItem = existing === undefined;
          const orderChanged =
            existing !== undefined && !sameChronologicalOrder(existing, event.item);

          itemsByIdRef.current.set(event.item.id, event.item);
          trackOwnership(event.item);

          if (isNewItem) {
            // Binary insertion: O(log n) search + O(1) amortized for in-order arrivals.
            sortedItemIdsRef.current = insertSortedItemId(
              sortedItemIdsRef.current,
              event.item,
              itemsByIdRef.current
            );
            setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
          } else if (orderChanged) {
            // Order changed — remove old position and re-insert.
            const filtered = sortedItemIdsRef.current.filter((id) => id !== event.item.id);
            sortedItemIdsRef.current = insertSortedItemId(
              filtered,
              event.item,
              itemsByIdRef.current
            );
            setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
          } else {
            setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
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
          trackOwnership(event.item);

          if (isNewItem) {
            sortedItemIdsRef.current = insertSortedItemId(
              sortedItemIdsRef.current,
              event.item,
              itemsByIdRef.current
            );
            setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
          } else if (orderChanged) {
            const filtered = sortedItemIdsRef.current.filter((id) => id !== event.item.id);
            sortedItemIdsRef.current = insertSortedItemId(
              filtered,
              event.item,
              itemsByIdRef.current
            );
            setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
          } else {
            setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
          }
        },
        onContentAdded: (event) => {
          const existing = itemsByIdRef.current.get(event.itemId);
          if (existing === undefined) {
            return;
          }
          const updated = updateItemWithContentAdded(
            existing,
            event.contentIndex,
            event.content
          );
          if (updated !== existing) {
            itemsByIdRef.current.set(event.itemId, updated);
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
        onSessionMetadataChanged: (event: SessionMetadataChangedEvent) => {
          setDetail((prev) => {
            if (prev === null) {
              return prev;
            }

            return {
              ...prev,
              ...(event.title !== undefined ? { title: event.title } : {}),
              ...(event.description !== undefined ? { description: event.description } : {}),
              ...(event.tags !== undefined ? { tags: event.tags } : {}),
              ...(event.metadata !== undefined
                ? { metadata: { ...prev.metadata, ...event.metadata } }
                : {})
            };
          });
        },
        onRequestStatus: (event) => {
          if (
            event.status === "completed" ||
            event.status === "failed" ||
            event.status === "incomplete" ||
            event.status === "aborted"
          ) {
            flushContentDeltas();
            setIsStreaming(false);
            setIsFinishing(false);
            activeRequestIdRef.current = null;
            streamHandleRef.current?.close();
            streamHandleRef.current = null;

            // Refresh on completion, or on failure/incomplete/aborted if resources
            // changed during streaming (batched instead of per-change).
            if (
              event.status === "completed" ||
              resourceChangedDuringStreamRef.current
            ) {
              resourceChangedDuringStreamRef.current = false;
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
      };

      const handle = inlineResponse !== undefined
        ? createSSEClientFromResponse({ response: inlineResponse, ...sseCallbacks })
        : createSSEClient({
            url: `/api/flows/${encodeURIComponent(resolvedFlowKind)}/requests/${encodeURIComponent(requestId)}/stream`,
            baseUrl,
            startingAfter: startingAfter !== undefined ? Number(startingAfter) : undefined,
            ...sseCallbacks
          });

      streamHandleRef.current = handle;
    },
    [
      itemConfig.includeTransient,
      itemConfig.itemTypes,
      resolvedFlowKind,
      baseUrl,
      refreshSnapshot,
      scheduleContentFlush,
      flushContentDeltas,
      trackOwnership
    ]
  );

  useEffect(() => {
    if (sessionId === undefined) {
      resourceChangedDuringStreamRef.current = false;
      itemsByIdRef.current = new Map();
      sortedItemIdsRef.current = [];
      deltaQueueRef.current.clear();
      ownershipIndexRef.current = new Map();
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
          fetchSessionSnapshot()
        ]);

        if (cancelled) {
          return;
        }

        setDetail(nextDetail);
        if (nextSnapshot !== null) {
          applySnapshot(nextSnapshot);
        }

        // Auto-resume: if enabled, check if latest request is in-progress and attach.
        if (
          autoResume &&
          itemConfig.enabled &&
          nextDetail?.latestRequestId !== undefined &&
          streamHandleRef.current === null
        ) {
          const requests = await sessionClient.listSessionRequests(sessionId, {
            status: "in_progress",
            limit: 1
          });

          if (cancelled) return;

          const activeRequest = requests.find(
            (r) => r.id === nextDetail.latestRequestId
          );

          if (activeRequest !== undefined) {
            attachToStream(activeRequest.id);
          }
        }
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
  }, [sessionId, sessionClient, fetchSessionSnapshot, applySnapshot, autoResume, itemConfig.enabled, attachToStream]);

  // Clean up when sessionId changes — close old stream and reset request state
  // so the new session isn't blocked by the previous session's in-flight request.
  useEffect(() => {
    return () => {
      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }

      setIsStreaming(false);
      setIsFinishing(false);
      cancelScheduledFlush();
    };
  }, [sessionId, cancelScheduledFlush]);

  const sendAction = useCallback(
    async (
      action: string,
      input: unknown,
      actionOptions?: { metadata?: Record<string, unknown>; userMessage?: string }
    ): Promise<ExecuteActionResponse> => {
      if (sessionId === undefined) {
        throw new Error("useSession.sendAction requires a sessionId");
      }

      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }

      setError(null);
      setIsFinishing(false);

      const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      activeRequestIdRef.current = requestId;

      // Optimistic user message: inject immediately so the user sees their own
      // message without waiting for the server round-trip. The server will emit
      // the real user message item via SSE, which replaces this optimistic one.
      if (actionOptions?.userMessage !== undefined && itemConfig.enabled) {
        const optimisticId = `item_msg_optimistic_${requestId}`;
        const optimisticItem: OutputItem = {
          id: optimisticId,
          type: "message",
          role: "user",
          status: "completed",
          transient: false,
          requestId,
          itemIndex: -1,
          provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
          ts: Date.now(),
          content: [{ type: "output_text", text: actionOptions.userMessage }]
        } as OutputItem;

        itemsByIdRef.current.set(optimisticId, optimisticItem);
        const ordered = sortItemsChronologically([
          ...itemsByIdRef.current.values()
        ]);
        sortedItemIdsRef.current = ordered.map((item) => item.id);
        setItems(ordered);
      }

      try {
        if (itemConfig.enabled) {
          const optimisticId = actionOptions?.userMessage !== undefined
            ? `item_msg_optimistic_${requestId}`
            : undefined;
          optimisticIdRef.current = optimisticId ?? null;
        }

        // Use sendActionStream to POST with Accept: text/event-stream.
        // On serverless (Vercel), this returns the SSE stream directly from
        // the POST response — keeping action execution and event delivery
        // on the same function instance. Falls back to 202 JSON + separate
        // GET stream for servers that don't support inline streaming.
        const postResponse = await client.sendActionStream(action, input, {
          sessionId,
          requestId,
          metadata: actionOptions?.metadata
        });

        const contentType = postResponse.headers.get("content-type") ?? "";

        if (contentType.includes("text/event-stream")) {
          if (itemConfig.enabled) {
            // Inline streaming: consume SSE events from the POST response body.
            attachToStream(requestId, undefined, postResponse);
          } else {
            // Items disabled — release the unconsumed SSE body.
            postResponse.body?.cancel().catch(() => {});
          }
          return {
            status: "in_progress" as const,
            request: {
              id: requestId,
              flowKind: resolvedFlowKind,
              actionName: action,
              status: "in_progress" as const
            }
          };
        }

        // Fallback: server returned 202 JSON (no inline streaming support).
        const response = (await postResponse.json()) as ExecuteActionResponse;

        if (itemConfig.enabled) {
          attachToStream(response.request.id);
        }

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
      resolvedFlowKind,
      client,
      itemConfig.enabled,
      attachToStream,
      refreshSnapshot
    ]
  );

  const getOwnedItems = useCallback((ownedBy: string): OutputItem[] => {
    const ids = ownershipIndexRef.current.get(ownedBy);
    if (ids === undefined || ids.size === 0) return [];
    const result: OutputItem[] = [];
    for (const id of ids) {
      const item = itemsByIdRef.current.get(id);
      if (item !== undefined) result.push(item);
    }
    return sortItemsChronologically(result);
  }, []);

  const abortRequest = useCallback(async () => {
    const requestId = activeRequestIdRef.current;
    if (requestId === null) return;

    let endpointReached = false;
    try {
      await client.abortRequest(requestId);
      endpointReached = true;
    } catch {
      // Abort endpoint unreachable (e.g. serverless — different instance).
    }

    if (endpointReached) {
      // The abort endpoint fired the in-memory controller. The SSE stream
      // will deliver the abort status item and request.aborted terminal
      // event, which triggers cleanup in onRequestStatus.
      return;
    }

    // Serverless fallback: close the SSE connection to signal the server
    // via request.signal, then clean up client state directly.
    streamHandleRef.current?.close();
    streamHandleRef.current = null;
    activeRequestIdRef.current = null;

    flushContentDeltas();
    setIsStreaming(false);
    setIsFinishing(false);

    if (itemConfig.enabled) {
      const abortItem: OutputItem = {
        id: `item_status_aborted_${requestId}`,
        type: "status",
        status: "completed",
        requestId,
        itemIndex: itemsByIdRef.current.size,
        provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
        ts: Date.now(),
        message: "Request was stopped.",
        detail: { code: "system.request_aborted" }
      } as OutputItem;

      itemsByIdRef.current.set(abortItem.id, abortItem);
      sortedItemIdsRef.current = insertSortedItemId(
        sortedItemIdsRef.current,
        abortItem,
        itemsByIdRef.current
      );
      setItems(buildItemsFromMap(sortedItemIdsRef.current, itemsByIdRef.current));
    }
  }, [client, flushContentDeltas, itemConfig.enabled]);

  const refresh = useCallback(async () => {
    await refreshSnapshot();
  }, [refreshSnapshot]);

  return {
    flowKind: resolvedFlowKind,
    sessionId,
    userId,
    isLoading,
    isStreaming,
    isFinishing,
    canSendAction: !isStreaming || isFinishing,
    error,
    detail,
    snapshot,
    items,
    getOwnedItems,
    sendAction,
    abortRequest,
    refresh
  };
}
