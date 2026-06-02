/**
 * Session-focused reactive hook for session lifecycle, request streaming, and item views.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClient,
  createRecoveryClient,
  createSessionClient,
  createSSEClient,
  createSSEClientFromResponse,
  type ExecuteActionResponse,
  type RequestSSECallbacks,
  type RequestStreamHandle,
  type SessionDetail,
  type SessionRequestSummary,
  type SessionStateSnapshotResponse
} from "@flow-state-dev/client";
import type {
  Content,
  ContentAudioDeltaEvent,
  ItemVisibility,
  MessageItem,
  OutputItem,
  ReasoningItem,
  ResourceChangeItem,
  SessionMetadataChangedEvent,
  StateChangeItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
import {
  isReducibleStateChange,
  mergeStateChangeIntoSnapshot
} from "../internal/mergeStateChangeIntoSnapshot";

const DEFAULT_STATE_PAGE_LIMIT = 100;

// Mirrors `resolveItemVisibility` from `@flow-state-dev/core/items` —
// inlined because this package may only import types from core.
const TRACE_TYPES = new Set(["block_trace", "router_decision", "state_snapshot"]);
const CONVERSATIONAL_TYPES = new Set(["message", "reasoning", "tool_output"]);
const CONVERSATIONAL_DEFAULT: ItemVisibility = { client: true, history: true };
const STRUCTURAL_DEFAULT: ItemVisibility = { client: true, history: false };
const TRACE_DEFAULT: ItemVisibility = { client: false, history: false };
function resolveItemVisibility(item: OutputItem): ItemVisibility {
  if (TRACE_TYPES.has(item.type)) return TRACE_DEFAULT;
  if (CONVERSATIONAL_TYPES.has(item.type)) return item.itemVisibility ?? CONVERSATIONAL_DEFAULT;
  return STRUCTURAL_DEFAULT;
}

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
  /**
   * Org binding to forward on every action request. Servers validate this
   * against the session's stored `orgId` (set at session creation) and reject
   * mismatches with a 400. Pass it when the app's routing or auth context
   * carries an org identity that should accompany every request.
   */
  orgId?: string;
  baseUrl?: string;
  items?: SessionItemsOptions;
  /**
   * When true, on mount the hook checks if the session has an in-progress
   * request and re-attaches to its stream using cursor-based continuation.
   * Default: false.
   */
  autoResume?: boolean;
  /**
   * Threshold in milliseconds before the in-flight request is treated as
   * stuck. The watchdog tracks the most recent SSE event or heartbeat and
   * trips when the gap exceeds this value while a request is in flight (or
   * was, before an `onError`). Should be ≥ 2× the server's wire heartbeat
   * to avoid false positives during long pauses (e.g. an LLM thinking).
   * Default: 30000 (30 seconds).
   */
  stuckThresholdMs?: number;
};

/**
 * Mid-stream resource_change notice. Mirrors the fields a downstream hook
 * (e.g., `useResourceCollection`) needs to decide whether a change touches
 * its ref — without leaking the full transient SSE item shape.
 */
export type ResourceChangeNotice = {
  readonly resourcePath: string;
  readonly changeType: "created" | "updated" | "deleted";
  readonly seq: number;
};

/**
 * Reactive session view returned by useSession.
 */
export type SessionView = {
  readonly flowKind: string;
  readonly sessionId?: string;
  readonly userId: string;
  /**
   * Org id the session is bound to, mirrored from `detail.orgId` once the
   * session record has loaded. `undefined` for unbound sessions.
   */
  readonly orgId?: string;
  readonly isLoading: boolean;
  readonly isStreaming: boolean;
  /** True when the main execution chain has completed but background work tasks are still running. */
  readonly isFinishing: boolean;
  /**
   * True when the SSE stream has gone silent for longer than
   * `stuckThresholdMs` while a request is (or was) in flight. Surfaces a
   * "connection lost" affordance when the stream drops without producing
   * a terminal event. Cleared on the next terminal status, successful
   * dismiss, or new `sendAction`.
   */
  readonly isStuck: boolean;
  /** True when the session can accept a new sendAction call (not blocked by an in-flight request). */
  readonly canSendAction: boolean;
  /**
   * Request-scoped status slot — the most recent value passed to
   * `ctx.emitStatus()` during the in-flight request. Empty string when no
   * block has emitted a status yet (or when a block explicitly cleared it).
   * Resets to `""` when the request terminates.
   */
  readonly statusMessage: string;
  readonly error: Error | null;
  readonly detail: SessionDetail | null;
  readonly snapshot: SessionStateSnapshotResponse | null;
  /**
   * Most recent request on this session, regardless of status. `null` until
   * the first list fetch resolves or when the session has no requests yet.
   * Refreshed on mount and whenever an SSE stream reaches a terminal state.
   */
  readonly latestRequest: SessionRequestSummary | null;
  readonly items: OutputItem[];
  /**
   * Mid-stream resource_change notices, in arrival order. Independent of the
   * `items` filter — these are surfaced even when transients are filtered out
   * of `items`, so subscribers (e.g., `useResourceCollection`) can react to
   * in-flight resource mutations without setting `includeTransient: true` on
   * the caller's `useSession` call.
   */
  readonly resourceChanges: ReadonlyArray<ResourceChangeNotice>;
  /** Returns items owned by a container scope (items where `ownedBy === blockInstanceId`). */
  getOwnedItems: (ownedBy: string) => OutputItem[];
  /** Returns items stamped with the given `agentName`. Useful for rendering per-agent panels. */
  getItemsByAgent: (agentName: string) => OutputItem[];
  /** Returns items matching the given visibility predicate. */
  getItemsByVisibility: (predicate: Partial<ItemVisibility>) => OutputItem[];
  sendAction: (
    action: string,
    input: unknown,
    options?: { metadata?: Record<string, unknown>; userMessage?: string }
  ) => Promise<ExecuteActionResponse>;
  /** Abort the currently in-flight request. No-op if nothing is in flight. */
  abortRequest: () => Promise<void>;
  /**
   * Dismiss a stuck request without requiring a live SSE connection.
   * Sends the abort signal to the server, closes any local stream
   * handle, injects a synthetic abort item so the user sees the prior
   * request was stopped, and refreshes the latest server snapshot.
   *
   * The target id is resolved in this order: explicit argument →
   * captured-on-error id → active stream id → `latestRequest.id`. No-op
   * (with a console warning) if no id can be resolved.
   */
  dismissRequest: (requestId?: string) => Promise<void>;
  /**
   * Re-dispatch the most recent request and attach to the new stream.
   * No-op when there is no latest request, or when its status is not one
   * that the server will retry (`interrupted` or `failed`).
   */
  resumeLatestRequest: () => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Subscribe to streaming TTS audio chunks (FIX-523). Chunks are live-only
   * and not retained in session item state — the durable representation is
   * the eventual `OutputAudioContent` snapshot delivered via `items`. The
   * returned function unsubscribes. Used by `useVoice` for gapless playback;
   * external consumers can attach a custom handler when implementing their
   * own player.
   */
  subscribeAudioDelta: (handler: (event: ContentAudioDeltaEvent) => void) => () => void;
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

/**
 * Client-side item filter. The server already strips non-client items from the
 * SSE stream, so this only handles transience and explicit type filtering.
 */
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

  return true;
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
  const orgId = options?.orgId;
  const baseUrl = options?.baseUrl ?? context.baseUrl;
  const autoResume = options?.autoResume === true;
  const stuckThresholdMs = options?.stuckThresholdMs ?? 30_000;

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
  const [latestRequest, setLatestRequest] = useState<SessionRequestSummary | null>(null);
  const [items, setItems] = useState<OutputItem[]>([]);
  // Mid-stream resource_change notices. These items are transient on the SSE
  // stream and are therefore filtered out of `items` by default — so a hook
  // like `useResourceCollection` cannot observe them through the items log.
  // Track them in a small, per-request-scoped array so subscribers can react
  // to mid-stream resource mutations (e.g., a memo flipping from `writing` to
  // `published`) without forcing the consumer to set `includeTransient: true`.
  const [resourceChanges, setResourceChanges] = useState<ResourceChangeNotice[]>([]);
  const resourceChangeSeqRef = useRef(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  // Request-scoped status slot mirror — driven by status items arriving in the
  // SSE stream. Always tracked (even when transient items are filtered from
  // `items`) so consumers can render a single in-flight indicator.
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [error, setError] = useState<Error | null>(null);

  const streamHandleRef = useRef<RequestStreamHandle | null>(null);
  /** The requestId of the currently in-flight request, used for abort. */
  const activeRequestIdRef = useRef<string | null>(null);
  /**
   * Captured at the moment the SSE stream emits `onError`, before
   * `activeRequestIdRef` is cleared. Lets `dismissRequest` target the
   * request that just dropped — `latestRequest.id` may not have caught
   * up yet, and `activeRequestIdRef` is null by the time the user clicks
   * the "Dismiss" button.
   */
  const latestRequestIdAfterDropRef = useRef<string | null>(null);
  /**
   * Wall-clock timestamp of the most recent SSE event or heartbeat. The
   * watchdog reads this to decide whether the stream has gone silent
   * past `stuckThresholdMs`.
   */
  const lastEventAtRef = useRef<number>(Date.now());
  /**
   * Mirror of `isStuck` state. Reads from a ref let `sendAction` and
   * `dismissRequest` consult the latest stuck-flag without depending on
   * the `isStuck` state directly, which would churn their useCallback
   * identities every time the watchdog flips.
   */
  const isStuckRef = useRef(false);
  /**
   * Mirror of `latestRequest` state. Same motive as `isStuckRef` —
   * `dismissRequest`'s id-resolution chain reads this without taking
   * `latestRequest` as a dep, so the callback stays stable across
   * request lifecycle transitions.
   */
  const latestRequestRef = useRef<SessionRequestSummary | null>(null);
  const itemsByIdRef = useRef<Map<string, OutputItem>>(new Map());
  const sortedItemIdsRef = useRef<string[]>([]);
  const deltaQueueRef = useRef<Map<string, ContentDeltaAccumulator>>(new Map());
  /**
   * Buffer for `state_change` items received before the initial snapshot
   * lands. The reducer (`mergeStateChangeIntoSnapshot`) bails when
   * `prev === null`, so without this buffer any state mutations emitted
   * between SSE subscribe and snapshot fetch resolution would be lost —
   * users would only see the terminal snapshot's "all published" state
   * with no intermediate transitions. Drained in `applySnapshot`.
   */
  const pendingStateChangesRef = useRef<StateChangeItem[]>([]);
  const flushHandleRef = useRef<number | null>(null);
  const optimisticIdRef = useRef<string | null>(null);
  /** Maps container ownedBy values to sets of item IDs for O(1) container lookups. */
  const ownershipIndexRef = useRef<Map<string, Set<string>>>(new Map());
  /** Tracks whether resource changes occurred during streaming, so we can batch one refresh at completion. */
  const resourceChangedDuringStreamRef = useRef(false);
  /**
   * Subscribers attached via `subscribeAudioDelta` (FIX-523). The set lives
   * on a ref so handler identities can mutate over the lifetime of a
   * subscriber without forcing re-renders. We dispatch synchronously inside
   * the SSE callback so downstream consumers (the audio player) get the
   * chunk before any React state update batching.
   */
  const audioDeltaListenersRef = useRef<Set<(event: ContentAudioDeltaEvent) => void>>(
    new Set()
  );

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

  // Mirror state into refs so callbacks that consult these values can
  // stay stable across renders. Without these mirrors, `sendAction` and
  // `dismissRequest` would have to take the underlying state as deps and
  // get recreated on every state transition (defeating useCallback's
  // identity stability).
  useEffect(() => {
    isStuckRef.current = isStuck;
  }, [isStuck]);
  useEffect(() => {
    latestRequestRef.current = latestRequest;
  }, [latestRequest]);

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

  const recoveryClient = useMemo(
    () => createRecoveryClient({ baseUrl }),
    [baseUrl]
  );

  /** Fetch the single most recent request for this session. */
  const refreshLatestRequest = useCallback(async () => {
    if (sessionId === undefined) {
      setLatestRequest(null);
      return;
    }
    try {
      const list = await sessionClient.listSessionRequests(sessionId, { limit: 1 });
      setLatestRequest(list[0] ?? null);
    } catch {
      // Best effort — a missing latest request shouldn't surface as a
      // session-level error. Consumers see the previous value.
    }
  }, [sessionId, sessionClient]);

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
      // Drain any state_changes that arrived while snapshot was null. The
      // snapshot represents server state at fetch time; replaying queued
      // events on top brings the local view up to whatever state the
      // server has emitted since. Events emitted *before* the snapshot's
      // read time are already reflected in `nextSnapshot.clientData`, so
      // re-applying them is at worst idempotent — the next forward
      // state_change in the queue overwrites any momentary regression.
      const pending = pendingStateChangesRef.current;
      pendingStateChangesRef.current = [];
      let merged: SessionStateSnapshotResponse = nextSnapshot;
      for (const sc of pending) {
        const next = mergeStateChangeIntoSnapshot(merged, sc);
        if (next !== null) {
          merged = next;
        }
      }
      setSnapshot(merged);

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
      setIsStuck(false);
      latestRequestIdAfterDropRef.current = null;
      // Baseline the watchdog at stream open so it doesn't fire instantly
      // on the first slow response.
      lastEventAtRef.current = Date.now();
      // New request — reset any lingering status from a previous request so
      // the in-flight indicator starts at "Thinking…" until a block emits.
      setStatusMessage("");

      const filter = {
        includeTransient: itemConfig.includeTransient,
        itemTypes: itemConfig.itemTypes
      };

      const sseCallbacks: RequestSSECallbacks = {
        onEvent: () => {
          lastEventAtRef.current = Date.now();
        },
        onHeartbeat: () => {
          lastEventAtRef.current = Date.now();
        },
        onItemAdded: (event) => {
          if (event.item.type === "status") {
            const statusItem = event.item as OutputItem & {
              blocked?: boolean;
              message?: string;
            };
            if (statusItem.blocked === false) {
              setIsFinishing(true);
            }
            // Mirror the server-side status slot. Items carry the slot value
            // whether the caller passed a message or just updated signals, so
            // we always track the latest. Filtered separately below (status
            // items are transient by default).
            if (typeof statusItem.message === "string") {
              setStatusMessage(statusItem.message);
            }
          }

          // resource_change and state_change are the framework's two
          // invalidation paths (both InvalidationItem leaves in core). The
          // asymmetry below is intentional, not a gap: resources have separate
          // content endpoints, so a resource_change flags a batched snapshot
          // refetch at completion; state_change carries the delta inline, so it
          // merges into clientData mid-stream (see the FIX-576 block below).
          //
          // Track that resources changed during streaming. Rather than firing
          // individual HTTP fetches per resource_change (which creates bursts
          // during artifact-heavy flows), we batch into one refresh at request
          // completion. The onRequestStatus handler checks this flag.
          if (event.item.type === "resource_change") {
            resourceChangedDuringStreamRef.current = true;
            const rc = event.item as ResourceChangeItem;
            resourceChangeSeqRef.current++;
            const notice: ResourceChangeNotice = {
              resourcePath: rc.resourcePath,
              changeType: rc.changeType,
              seq: resourceChangeSeqRef.current
            };
            setResourceChanges((prev) => [...prev, notice]);
          }

          // FIX-576: reduce session/user/org-scope state_change items into the
          // cached snapshot's clientData so useClientData reflects mid-stream
          // patches without waiting for the terminal-status snapshot refresh.
          // Falls through to the items-log path below for non-transient cases.
          //
          // Race: the SSE stream subscribes immediately when an action is
          // dispatched, but the initial snapshot fetch is async. State_change
          // items that land before the snapshot resolves can't merge (the
          // reducer needs a non-null prev), so buffer them here and replay
          // in `applySnapshot` once the snapshot lands. Without this buffer,
          // first-run sessions miss every intermediate state transition.
          if (isReducibleStateChange(event.item)) {
            const sc = event.item as StateChangeItem;
            setSnapshot((prev) => {
              if (prev === null) {
                pendingStateChangesRef.current.push(sc);
                return prev;
              }
              return mergeStateChangeIntoSnapshot(prev, sc);
            });
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
        onContentAudioDelta: (event) => {
          // Fan out to subscribers (useVoice or any external consumer
          // that attached via session.subscribeAudioDelta). A misbehaving
          // listener must not block delivery to the rest of the set.
          for (const listener of audioDeltaListenersRef.current) {
            try {
              listener(event);
            } catch {
              // Swallow — the listener's caller owns reporting.
            }
          }
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
            event.status === "interrupted" ||
            event.status === "aborted" ||
            event.status === "suspended"
          ) {
            flushContentDeltas();
            setIsStreaming(false);
            setIsFinishing(false);
            setIsStuck(false);
            latestRequestIdAfterDropRef.current = null;
            // Status slot clears automatically on request termination per FIX-387.
            setStatusMessage("");
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

            // Refresh the latestRequest summary so consumers can render
            // recovery affordances (e.g. a Resume button when status moves
            // to `interrupted`).
            void refreshLatestRequest();
          }
        },
        onError: () => {
          // Capture the in-flight requestId BEFORE clearing the active ref so
          // the watchdog and any subsequent dismissRequest() call still have a
          // target to address. After capturing, clear the active ref — its
          // role is "stream is open"; the post-error sentinel is
          // latestRequestIdAfterDropRef.
          if (activeRequestIdRef.current !== null) {
            latestRequestIdAfterDropRef.current = activeRequestIdRef.current;
            activeRequestIdRef.current = null;
          }
          flushContentDeltas();
          setIsStreaming(false);
          setStatusMessage("");
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
      refreshLatestRequest,
      scheduleContentFlush,
      flushContentDeltas,
      trackOwnership
    ]
  );

  useEffect(() => {
    if (sessionId === undefined) {
      resourceChangedDuringStreamRef.current = false;
      resourceChangeSeqRef.current = 0;
      itemsByIdRef.current = new Map();
      sortedItemIdsRef.current = [];
      deltaQueueRef.current.clear();
      ownershipIndexRef.current = new Map();
      pendingStateChangesRef.current = [];
      cancelScheduledFlush();
      setDetail(null);
      setSnapshot(null);
      setLatestRequest(null);
      setItems([]);
      setResourceChanges([]);
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
          fetchSessionSnapshot(),
          refreshLatestRequest()
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
  }, [sessionId, sessionClient, fetchSessionSnapshot, applySnapshot, autoResume, itemConfig.enabled, attachToStream, refreshLatestRequest]);

  // Clean up when sessionId changes — close old stream and reset request state
  // so the new session isn't blocked by the previous session's in-flight request.
  // Resets every request-scoped ref the watchdog reads, so a session switch
  // can't smuggle a stale `activeRequestIdRef` or `lastEventAtRef` into the
  // new session and trip a false-positive `isStuck`.
  useEffect(() => {
    return () => {
      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }

      setIsStreaming(false);
      setIsFinishing(false);
      setIsStuck(false);
      activeRequestIdRef.current = null;
      latestRequestIdAfterDropRef.current = null;
      lastEventAtRef.current = Date.now();
      cancelScheduledFlush();
    };
  }, [sessionId, cancelScheduledFlush]);

  // Stuck-request watchdog. Polls a clock against `lastEventAtRef`; if the
  // SSE stream has produced no event or heartbeat in `stuckThresholdMs`
  // while a request is (or just was) in flight, flip `isStuck` so the host
  // can render a dismiss affordance. This is a genuine side effect (timer
  // polling for an external signal), not derived state — `useEffect` is
  // the right primitive (BP-010).
  useEffect(() => {
    if (!Number.isFinite(stuckThresholdMs) || stuckThresholdMs <= 0) {
      return;
    }
    const tickMs = Math.max(1000, Math.floor(stuckThresholdMs / 4));
    const timer = setInterval(() => {
      const inFlight =
        activeRequestIdRef.current !== null ||
        latestRequestIdAfterDropRef.current !== null;
      if (!inFlight) return;
      const gap = Date.now() - lastEventAtRef.current;
      if (gap > stuckThresholdMs) {
        setIsStuck(true);
      }
    }, tickMs);
    return () => {
      clearInterval(timer);
    };
  }, [stuckThresholdMs]);

  /**
   * Insert a synthetic abort `status` item into the local items log so the
   * user has a visible record of the request being stopped. Idempotent on
   * the same `requestId` (the id is derived from it, so a second call
   * overwrites the same map entry).
   */
  const injectSyntheticAbortItem = useCallback(
    (requestId: string) => {
      if (!itemConfig.enabled) return;
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
    },
    [itemConfig.enabled]
  );

  const dismissRequest = useCallback(
    async (requestId?: string) => {
      const targetId =
        requestId ??
        latestRequestIdAfterDropRef.current ??
        activeRequestIdRef.current ??
        latestRequestRef.current?.id ??
        null;

      if (targetId === null) {
        console.warn(
          "[flow-state] dismissRequest: no in-flight or recent request to dismiss"
        );
        return;
      }

      try {
        await client.abortRequest(targetId);
      } catch {
        // Network failure or a 409 against an already-terminal record both
        // land here. The local cleanup below still runs so the UI clears.
      }

      streamHandleRef.current?.close();
      streamHandleRef.current = null;
      activeRequestIdRef.current = null;
      latestRequestIdAfterDropRef.current = null;

      flushContentDeltas();
      setIsStreaming(false);
      setIsFinishing(false);
      setIsStuck(false);

      injectSyntheticAbortItem(targetId);

      // Pull authoritative server state — covers 409 (already terminal)
      // and 404 (unknown id) gracefully without surfacing them as errors.
      void refreshSnapshot();
      void refreshLatestRequest();
    },
    [
      client,
      flushContentDeltas,
      injectSyntheticAbortItem,
      refreshSnapshot,
      refreshLatestRequest
    ]
  );

  const sendAction = useCallback(
    async (
      action: string,
      input: unknown,
      actionOptions?: { metadata?: Record<string, unknown>; userMessage?: string }
    ): Promise<ExecuteActionResponse> => {
      if (sessionId === undefined) {
        throw new Error("useSession.sendAction requires a sessionId");
      }

      // Auto-dismiss a stuck prior request before kicking off a new one.
      // The synthetic abort item from `dismissRequest` keeps the prior
      // attempt visible in the items log instead of silently dropping it.
      // Reads via refs so this callback's identity stays stable across
      // every isStuck/latestRequest state transition (a cold-path check
      // shouldn't churn the cb that consumers pass as a prop).
      if (
        isStuckRef.current &&
        (latestRequestIdAfterDropRef.current !== null ||
          activeRequestIdRef.current !== null ||
          latestRequestRef.current !== null)
      ) {
        await dismissRequest();
      }

      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }

      setError(null);
      setIsFinishing(false);
      setIsStuck(false);
      latestRequestIdAfterDropRef.current = null;

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
          orgId,
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
      refreshSnapshot,
      dismissRequest,
      orgId
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

  const getItemsByAgent = useCallback(
    (agentName: string): OutputItem[] =>
      items.filter((item) => item.agentName === agentName),
    [items]
  );

  const getItemsByVisibility = useCallback(
    (predicate: Partial<ItemVisibility>): OutputItem[] =>
      items.filter((item) => {
        const resolved = resolveItemVisibility(item);
        if (predicate.client !== undefined && resolved.client !== predicate.client) return false;
        if (predicate.history !== undefined && resolved.history !== predicate.history) return false;
        return true;
      }),
    [items]
  );

  const abortRequest = useCallback(async () => {
    const requestId = activeRequestIdRef.current;
    if (requestId === null) return;

    // Mark the request as abort-requested in the persistent store. This
    // flag lets the server distinguish an intentional stop from an
    // accidental disconnect (browser reload, network drop).
    try {
      await client.abortRequest(requestId);
    } catch {
      // Best-effort — if the endpoint is unreachable the server will
      // treat the subsequent disconnect as "interrupted" instead.
    }

    // Close the SSE connection. On the server, request.signal fires
    // and the catch block checks the abortRequested flag to decide
    // between "aborted" (intentional) or "interrupted" (accidental).
    streamHandleRef.current?.close();
    streamHandleRef.current = null;
    activeRequestIdRef.current = null;
    latestRequestIdAfterDropRef.current = null;

    flushContentDeltas();
    setIsStreaming(false);
    setIsFinishing(false);
    setIsStuck(false);

    injectSyntheticAbortItem(requestId);
  }, [client, flushContentDeltas, injectSyntheticAbortItem]);

  const refresh = useCallback(async () => {
    await refreshSnapshot();
  }, [refreshSnapshot]);

  const resumeLatestRequest = useCallback(async () => {
    if (sessionId === undefined) return;
    const target = latestRequest;
    if (target === null) return;
    if (target.status !== "interrupted" && target.status !== "failed") {
      // Server only retries interrupted/failed records; bail rather than
      // round-trip and surface a 409.
      return;
    }
    if (streamHandleRef.current !== null) {
      streamHandleRef.current.close();
      streamHandleRef.current = null;
    }
    setError(null);

    try {
      const { newRequestId } = await recoveryClient.retry({
        flowKind: target.flowKind,
        sessionId,
        requestId: target.id
      });

      activeRequestIdRef.current = newRequestId;
      attachToStream(newRequestId);
      // The new request is fresh in_progress; reflect it immediately so any
      // UI gating on `latestRequest.status === "interrupted"` updates without
      // waiting for the next list fetch.
      void refreshLatestRequest();
    } catch (cause) {
      const normalized = cause instanceof Error ? cause : new Error(String(cause));
      setError(normalized);
      throw normalized;
    }
  }, [sessionId, latestRequest, recoveryClient, attachToStream, refreshLatestRequest]);

  const subscribeAudioDelta = useCallback(
    (handler: (event: ContentAudioDeltaEvent) => void) => {
      audioDeltaListenersRef.current.add(handler);
      return () => {
        audioDeltaListenersRef.current.delete(handler);
      };
    },
    []
  );

  return {
    flowKind: resolvedFlowKind,
    sessionId,
    userId,
    orgId: detail?.orgId ?? orgId,
    isLoading,
    isStreaming,
    isFinishing,
    isStuck,
    canSendAction: !isStreaming || isFinishing,
    statusMessage,
    error,
    detail,
    snapshot,
    latestRequest,
    items,
    resourceChanges,
    getOwnedItems,
    getItemsByAgent,
    getItemsByVisibility,
    sendAction,
    abortRequest,
    dismissRequest,
    resumeLatestRequest,
    refresh,
    subscribeAudioDelta
  };
}
