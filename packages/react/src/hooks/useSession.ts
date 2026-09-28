/**
 * Session-focused reactive hook for session lifecycle, request streaming, and item views.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compareItemOrder,
  createClient,
  createRecoveryClient,
  createRequestStreamStore,
  createSessionClient,
  createSessionSSEClient,
  createSSEClient,
  createSSEClientFromResponse,
  type ExecuteActionResponse,
  type RequestSSECallbacks,
  type RequestStreamHandle,
  type SessionDetail,
  type SessionRequestSummary,
  type SessionStateSnapshotResponse,
  type ChildSessionSummary
} from "@flow-state-dev/client";
import type {
  ContentAudioDeltaEvent,
  ItemVisibility,
  MessageItem,
  OutputItem,
  ReasoningItem,
  ResourceChangeItem,
  SessionItemEvent,
  SessionMetadataChangedEvent,
  SessionRun,
  StateChangeItem
} from "@flow-state-dev/core/items";
import type { ResumeAction } from "@flow-state-dev/core/types";
// Canonical helper from the zero-dependency contracts layer (value-import).
// Previously hand-mirrored here because react may only type-import core.
import { resolveItemVisibility } from "@flow-state-dev/contracts";
import { useFlowContext } from "../context/FlowContext";
import {
  isReducibleStateChange,
  mergeStateChangeIntoSnapshot
} from "../internal/mergeStateChangeIntoSnapshot";
import {
  isReducibleResourceChange,
  mergeResourceChangeIntoSnapshot
} from "../internal/mergeResourceChangeIntoSnapshot";

const DEFAULT_STATE_PAGE_LIMIT = 100;

/**
 * How many times a paged snapshot read starts over because the session's
 * history moved under it, before it fails rather than show part of the
 * history as all of it.
 */
const SNAPSHOT_READ_ATTEMPTS = 5;

/**
 * Where one snapshot read stands, taken when it is requested: how many live
 * copies had arrived by then, and its place among the reads requested.
 */
type SnapshotRead = { arrivalsBefore: number; sequence: number };

/**
 * Rows the mount's in-progress lookup reads.
 *
 * Above one so the lookup can report on a request that is no longer the
 * newest: under `allow` concurrency the session's latest request and the one
 * that was running when the snapshot was read can be different requests, both
 * in flight. A session with more than this many requests genuinely running at
 * once falls back to the same behaviour as before — the older one reads as
 * finished and earns one spare snapshot read, never a missed one.
 */
const IN_PROGRESS_LOOKUP_LIMIT = 10;

/**
 * The id of the user message the view shows for a request while it is sent,
 * until the server's own copy replaces it.
 */
function optimisticIdOf(requestId: string): string {
  return `item_msg_optimistic_${requestId}`;
}

/**
 * The key the view holds an item under: request and item id together, since
 * two requests can keep the same id (a keyed item's id comes from its key).
 */
function itemKey(requestId: string, itemId: string): string {
  return `${requestId}\u0000${itemId}`;
}

/** {@link itemKey} of an item. */
function keyOfItem(item: OutputItem): string {
  return itemKey(item.requestId, item.id);
}

/**
 * Whether a copy of an item is finished. The view joins three sources that can
 * deliver one item in any order: its own request stream, the session stream,
 * and snapshots. Once the view holds a finished copy, an unfinished copy of
 * that item is older than it, whichever source it came from.
 */
function isFinished(item: OutputItem | undefined): boolean {
  return item !== undefined && item.status !== "in_progress";
}

/**
 * Whether `next` may replace `held`, two copies of one item. Never an
 * unfinished copy over a finished one, and never a finished copy over one the
 * server stamped later. A keyed item is sent again, finished, each time it is
 * emitted, with a later time and index (`compareItemOrder`), and its copies can
 * arrive in any order.
 */
function mayReplace(held: OutputItem | undefined, next: OutputItem): boolean {
  if (held === undefined || !isFinished(held)) return true;
  return isFinished(next) && compareItemOrder(next, held) >= 0;
}

/** How many content parts a message or reasoning item holds. */
function partCount(item: OutputItem): number {
  if (item.type === "message") return (item as MessageItem).content?.length ?? 0;
  if (item.type === "reasoning") return (item as ReasoningItem).summary?.length ?? 0;
  return 0;
}

/**
 * The background-work read asks for one page, never for the whole history.
 *
 * The axis is re-read on every interaction, so paging to exhaustion would make
 * an ordinary turn cost a number of requests that grows with the
 * conversation's history. Rows come back newest-first, so what a longer
 * history loses off the end is the oldest finished work, never work that just
 * started.
 *
 * How large that page is belongs to the **server**, which is why no default
 * appears here. The route's maximum is configurable per deployment and the
 * hook cannot see it, so a number hardcoded on this side would be rejected
 * outright by any deployment that set a smaller ceiling — turning an ordinary
 * mount into a 400 and an empty axis. Sending nothing lets the route apply its
 * own default, which is always within its own bounds. An app that wants a
 * specific page says so with `childSessions: { limit }` and owns the result.
 */

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
 * Background-work list configuration for useSession.
 */
export type SessionChildSessionsOptions = {
  /**
   * Rows each read asks for, newest first. Omitted by default, which lets the
   * server apply its own page size.
   *
   * Set it when a conversation runs more background work than that page holds
   * — the list is all-time history, not just what is currently running, so it
   * grows with everything the conversation has ever started, and anything past
   * one page is not reachable from the hook.
   *
   * The server caps this and rejects a larger value with a 400, which surfaces
   * as `childSessionsStale` rather than rows. The cap defaults to 100 and is
   * raised with `maxChildSessionListLimit` on the server, so a value above what
   * the deployment permits is a misconfiguration on the app's side, not a
   * silent truncation.
   */
  limit?: number;
};

/**
 * Options for useSession.
 */
export type UseSessionHookOptions = {
  flowKind?: string;
  userId?: string;
  baseUrl?: string;
  items?: SessionItemsOptions;
  childSessions?: SessionChildSessionsOptions;
  /**
   * When true, on mount the hook checks if the session has an in-progress
   * request and re-attaches to its stream using cursor-based continuation.
   * Default: false.
   */
  autoResume?: boolean;
  /**
   * When true, the view also hears requests it didn't send: another tab,
   * another person, an agent answering in the same session. The hook opens one
   * stream for the session after its first snapshot, and each finished item
   * any request keeps joins `items` about a second later, in the order a
   * reload shows. `childSessions` is re-read whenever a run under the session
   * starts or finishes, and keeps an unfinished run the page lacks.
   *
   * The stream holds a connection open while the view is mounted, and the
   * server reads the session about once a second for it. Leave it off for a
   * view only one person writes to: the request stream already carries
   * everything there. A server without the stream, or one that refuses it,
   * leaves the view as it is without `live`, with no error. Once the stream
   * has named the runs, losing it (a reconnect that fails, a refusal, the
   * session gone) keeps the rows and raises `childSessionsStale`.
   * Default: false.
   */
  live?: boolean;
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
   * `ctx.emit.status()` during the in-flight request. Empty string when no
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
  /**
   * Background work running under this session — one entry per body of work,
   * not per attempt, and finished work stays listed. Empty for a session that
   * never launched any.
   *
   * Separate from `items` on purpose: background work is not part of the
   * conversation, and nothing here is folded into the transcript. An app that
   * wants "here's what came back" to appear in the chat writes that itself.
   *
   * Current as of the last thing the user did: re-read on mount, at the start
   * of every action, and whenever the app calls `refresh()`. With `live: true`
   * it is also re-read whenever a run starts or finishes, and an unfinished
   * run older than the page stays listed until it finishes.
   *
   * One page of the most recent entries, newest first, sized by the server
   * unless the app names a page with `childSessions: { limit }`. This is
   * all-time history rather than only what is running now, so it grows with
   * everything the conversation has ever started; past one page the oldest
   * finished work falls off the end and is not reachable from here.
   *
   * A row's `status` is absent until its work has run anything, and `"active"`
   * means only *not finished*. Without `live`, the list may be stale: never
   * render `"active"` as "running", "working" or "thinking", and never treat
   * it as proof a worker is alive. With `live: true` the list is re-read as
   * runs start and finish, so `"active"` may read as "working", which clears
   * when the run ends; a paused or stopped run reads the same.
   */
  readonly childSessions: ReadonlyArray<ChildSessionSummary>;
  /**
   * True when the most recent attempt to re-read `childSessions` failed. The
   * rows already read are kept rather than cleared, so this is the difference
   * between "this is the current list" and "this is the last list we could
   * get" — without it a job that has since failed renders as still running.
   * Cleared by the next successful read.
   *
   * With `live: true`, also true while the session stream, having named the
   * runs, is not following the session: once a reconnect has failed, until a
   * connection names the runs again, and for good once the stream is refused
   * or the session is gone. The rows are kept either way.
   */
  readonly childSessionsStale: boolean;
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
  /**
   * Resolve a pending durable-execution suspension (approve/reject) and stream
   * the continuation back into this session's `items`. The resume POSTs with
   * `Accept: text/event-stream`, so the resumed run streams from the POST
   * response on the same instance that handled it — the post-suspension output
   * renders live, with no page refresh, even on serverless (where a separate GET
   * reconnect couldn't reach the in-flight continuation). Falls back to a GET
   * re-attach + snapshot refresh when the server returns a 202 instead of SSE.
   *
   * `requestId` is the suspended request's id (carried on the suspension item).
   * The continuation re-enters that same id (FIX-811), so its items merge into
   * the existing stream rather than creating a new request.
   */
  resumeSuspension: (args: {
    suspensionId: string;
    requestId: string;
    action: ResumeAction;
    data?: unknown;
    resumedBy?: string;
  }) => Promise<void>;
  /**
   * Continue a crash-interrupted request under its OWN id (FIX-865) and stream
   * the re-entry's items back into this session's `items`. Unlike
   * `resumeLatestRequest` (which re-dispatches the session's most recent
   * request via `/retry` under a NEW id), this targets a specific `requestId`
   * — the caller resolves which interrupted request to continue, this does
   * not assume "latest".
   *
   * POSTs inline with `Accept: text/event-stream` so the continuation streams
   * from the same POST response on the instance that handled it (mirrors
   * `resumeSuspension`'s inline-streaming rationale — essential on
   * serverless). If the server instead returns a 202 (no inline streaming
   * support), the continuation has already been accepted server-side — this
   * does NOT re-POST `/continue` (the record has left `interrupted`, so a
   * second POST would 409/race). It cancels the unused body and reconnects
   * via a GET stream instead.
   */
  continueRequest: (requestId: string) => Promise<void>;
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

export function useSession(
  sessionId: string | undefined,
  options?: UseSessionHookOptions
): SessionView {
  const context = useFlowContext();
  const resolvedFlowKind = normalizeFlowKind(options?.flowKind ?? context.flowKind ?? "");
  const userId = options?.userId ?? context.userId ?? "devuser";
  const baseUrl = options?.baseUrl ?? context.baseUrl;
  const autoResume = options?.autoResume === true;
  const live = options?.live === true;
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

  // Read off as a primitive rather than memoizing the options object: callers
  // pass `childSessions` as an inline literal, so a new object identity every
  // render would re-create `refreshChildSessions` and re-fire the mount read on
  // every render. `undefined` when the app named no page — see the note on the
  // read below for why nothing is substituted here.
  const childSessionLimit = options?.childSessions?.limit;

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
  // Background work running under this session. Read from the server, never
  // derived from the conversation's own items — a ChildSession is a separate
  // session, not a message.
  const [childSessions, setChildSessions] = useState<ChildSessionSummary[]>([]);
  const [childSessionsStale, setChildSessionsStale] = useState(false);
  // `live: true` only. The unfinished runs the session stream last named, kept
  // past the page `childSessions` reads; null until a stream has named any.
  const [liveRuns, setLiveRuns] = useState<SessionRun[] | null>(null);
  // `live: true` only. The stream had named the runs and has stopped following
  // the session: a reconnect failed, or it was refused for good. The rows stay,
  // the last the view heard, and read as stale until a connection names the
  // runs again.
  const [liveLapsed, setLiveLapsed] = useState(false);
  // The session whose first snapshot has been applied: the live stream opens
  // only after it, so its first read covers the gap the snapshot left.
  const [snapshotAppliedFor, setSnapshotAppliedFor] = useState<string | undefined>(undefined);
  // Every live copy the view took, by key, with its place in arrival order,
  // until a snapshot whose read began after it arrived settles it. The count
  // is how many copies have arrived so far.
  const liveItemsRef = useRef(new Map<string, number>());
  const liveArrivalsRef = useRef(0);
  // The server time the applied snapshot's read began. The live stream starts
  // from it, so nothing kept after that read is missed however long the
  // snapshot took to arrive.
  const snapshotAtRef = useRef<number | undefined>(undefined);
  // Snapshot reads overlap: the mount read and its catch-up, a request's
  // closing read, `refresh()`. Each takes a place in order when it is
  // requested, and one lands only if no read requested after it has landed:
  // an older read can lack an item a newer one settled, and no stream sends
  // that item again.
  const snapshotSequenceRef = useRef(0);
  const snapshotAppliedSequenceRef = useRef(0);
  // Two guards, and they answer different questions. The generation asks
  // "is this response still about the thing we are reading?" and advances
  // whenever the read identity changes (session id, or the client itself,
  // which is rebuilt when `baseUrl` changes). The sequence asks "of two
  // responses that are both still relevant, which is newer?" — needed
  // because the mount read, an action-start read and a manual `refresh()`
  // all share one identity and can be in flight together.
  const childSessionGenerationRef = useRef(0);
  const childSessionSequenceRef = useRef(0);
  const childSessionAppliedSequenceRef = useRef(0);
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
  const storeRef = useRef(createRequestStreamStore({ keyOf: keyOfItem }));
  // Item ids the filter rejected this stream. The shared store keeps deltas for
  // not-yet-present items buffered (so early deltas survive), so a filtered item
  // — which never enters the store — would otherwise buffer deltas forever.
  // Mirrors the filter seam in `bindStoreToCallbacks`: drop its deltas on
  // arrival. Reset per stream in `attachToStream`.
  const rejectedItemIdsRef = useRef<Set<string>>(new Set());
  /**
   * Buffer for `state_change` items received before the initial snapshot
   * lands. The reducer (`mergeStateChangeIntoSnapshot`) bails when
   * `prev === null`, so without this buffer any state mutations emitted
   * between SSE subscribe and snapshot fetch resolution would be lost —
   * users would only see the terminal snapshot's "all published" state
   * with no intermediate transitions. Drained in `applySnapshot`.
   */
  const pendingStateChangesRef = useRef<StateChangeItem[]>([]);
  /**
   * Buffer for `live: true` `resource_change` items received before the initial
   * snapshot lands — the resource-side twin of `pendingStateChangesRef`
   * (FIX-739). `mergeResourceChangeIntoSnapshot` bails when `prev === null`, so
   * mid-stream resource deltas emitted before the snapshot resolves would be
   * lost without this buffer. Drained in `applySnapshot`.
   */
  const pendingResourceChangesRef = useRef<ResourceChangeItem[]>([]);
  const flushHandleRef = useRef<number | null>(null);
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

  /**
   * Fetch the single most recent request for this session.
   *
   * Returns the record it read (or `null`) as well as storing it, so a caller
   * that needs the value it just fetched does not have to wait a render for
   * the state to settle. The mount effect uses this to tell "the latest
   * request was still running when we read the snapshot" from "the session was
   * already idle" — see the catch-up read below.
   */
  const refreshLatestRequest = useCallback(async (): Promise<SessionRequestSummary | null> => {
    if (sessionId === undefined) {
      setLatestRequest(null);
      return null;
    }
    try {
      const list = await sessionClient.listSessionRequests(sessionId, { limit: 1 });
      const latest = list[0] ?? null;
      setLatestRequest(latest);
      return latest;
    } catch {
      // Best effort — a missing latest request shouldn't surface as a
      // session-level error. Consumers see the previous value.
      return null;
    }
  }, [sessionId, sessionClient]);

  /**
   * Re-read this session's background work.
   *
   * One read per call — there is no digest and no coalescing, because the
   * panel is current as of the caller's last interaction, or with `live`, the
   * last run that started or finished. A failed read keeps the rows already
   * on screen and raises `childSessionsStale`; it never clears the list,
   * because showing nothing would claim the work went away.
   */
  const refreshChildSessions = useCallback(async () => {
    if (sessionId === undefined) {
      setChildSessions([]);
      setChildSessionsStale(false);
      return;
    }

    const generation = childSessionGenerationRef.current;
    const sequence = ++childSessionSequenceRef.current;

    try {
      const rows = await sessionClient.listChildSessions(
        sessionId,
        // Omitted entirely when the app named no page, so the route applies
        // its own default rather than being handed a number this side guessed.
        childSessionLimit === undefined ? undefined : { limit: childSessionLimit }
      );

      // Superseded: we are now reading a different session, or the same
      // session from a different backend.
      if (generation !== childSessionGenerationRef.current) return;
      // A newer read of this same session already landed. Applying this one
      // would regress the list — including turning a finished row back into
      // an unfinished one.
      if (sequence <= childSessionAppliedSequenceRef.current) return;

      childSessionAppliedSequenceRef.current = sequence;
      setChildSessions(rows);
      setChildSessionsStale(false);
    } catch {
      if (generation !== childSessionGenerationRef.current) return;
      // A failure is an outcome, so it is ordered like one. Without this a
      // slow read that rejects after a newer read succeeded would flag fresh
      // rows as stale; and because a failure that skipped the ordering never
      // advanced the applied sequence, an older read settling later would
      // then be applied on top and clear the flag.
      if (sequence <= childSessionAppliedSequenceRef.current) return;

      childSessionAppliedSequenceRef.current = sequence;
      // Keep the last known rows, but stop presenting them as current.
      setChildSessionsStale(true);
    }
  }, [sessionId, sessionClient, childSessionLimit]);

  const flushContentDeltas = useCallback(() => {
    flushHandleRef.current = null;
    if (storeRef.current.flushDeltas()) {
      setItems(storeRef.current.getSorted());
    }
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

  /**
   * Take one copy of an item from a live source: the view's own request
   * stream (`own`) or the session stream (`session`). Every live copy comes
   * through here, so each rule of the join holds whichever source it came
   * from:
   *
   * - The server's user message for a request replaces the one the view
   *   showed while that request was sent.
   * - A finished copy stands: no unfinished copy replaces it, and no finished
   *   copy the server stamped earlier (a keyed item's earlier emission). Nor
   *   does a session copy replace a finished one stamped the same; that is a
   *   repeat, or the view's own copy, which can hold a part added since the
   *   session's read.
   * - A finished copy holds every text delta, so any still queued for the
   *   item are older than it.
   * - The copy is remembered in arrival order, so a snapshot whose read began
   *   before it arrived doesn't take it away (see `applySnapshot`).
   *
   * Returns whether the view changed.
   */
  const takeLiveItem = useCallback((item: OutputItem, from: "own" | "session"): boolean => {
    const store = storeRef.current;
    const replacedOptimistic =
      item.type === "message" &&
      (item as MessageItem).role === "user" &&
      store.deleteById(itemKey(item.requestId, optimisticIdOf(item.requestId)));

    const key = keyOfItem(item);
    const held = store.getById(key);
    const repeat = held !== undefined && isFinished(held) && compareItemOrder(item, held) === 0;
    if (!mayReplace(held, item) || (from === "session" && repeat)) return replacedOptimistic;

    if (isFinished(item)) store.discardDeltas(key);
    liveArrivalsRef.current += 1;
    liveItemsRef.current.set(key, liveArrivalsRef.current);
    store.upsert(item);
    return true;
  }, []);

  /** Take a snapshot read's place in order, as it is requested. */
  const beginSnapshotRead = useCallback(
    (): SnapshotRead => ({
      arrivalsBefore: liveArrivalsRef.current,
      sequence: ++snapshotSequenceRef.current
    }),
    []
  );

  /**
   * Load a snapshot over the view, unless a read requested after this one has
   * already landed; returns whether it did. It settles the live copies that
   * had arrived when its read was requested, and none that came after.
   */
  const applySnapshot = useCallback(
    (nextSnapshot: SessionStateSnapshotResponse, read: SnapshotRead): boolean => {
      if (read.sequence <= snapshotAppliedSequenceRef.current) return false;
      snapshotAppliedSequenceRef.current = read.sequence;
      const { arrivalsBefore } = read;
      snapshotAtRef.current = nextSnapshot.at;
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
      // Drain buffered live resource_change deltas the same way (FIX-739).
      const pendingResources = pendingResourceChangesRef.current;
      pendingResourceChangesRef.current = [];
      for (const resourceChange of pendingResources) {
        const next = mergeResourceChangeIntoSnapshot(merged, resourceChange);
        if (next !== null) {
          merged = next;
        }
      }
      setSnapshot(merged);

      if (!itemConfig.enabled) {
        storeRef.current.clear();
        setItems([]);
        return true;
      }

      const filtered = [...(nextSnapshot.items ?? [])]
        .filter((item) =>
          passesItemFilter(item, {
            includeTransient: itemConfig.includeTransient,
            itemTypes: itemConfig.itemTypes
          })
        )
        .sort(compareItemOrder);

      // Put back what the snapshot must not take from the view. A live copy
      // that arrived after the read was requested can be newer than what the
      // read saw, or missing from it, however long the read took; it stays
      // until a later snapshot settles it. A copy that arrived before is
      // settled here. What the session stream sends is already kept, so the
      // read holds it or shows it is gone. (The view's own stream can run a
      // moment ahead of what is kept; its request's closing snapshot settles
      // those.) And a read taken while an item was still being written holds
      // it unfinished, where the view may already hold it finished, or holds
      // an earlier copy of a keyed item the view already holds a later one of.
      const held = storeRef.current.getRaw();
      storeRef.current.loadSnapshot(filtered);
      const live = liveItemsRef.current;
      for (const kept of held) {
        const key = keyOfItem(kept);
        const loaded = storeRef.current.getById(key);
        const arrival = live.get(key);
        if (arrival !== undefined && arrival > arrivalsBefore) {
          if (mayReplace(loaded, kept)) storeRef.current.upsert(kept);
        } else {
          live.delete(key);
          if (loaded !== undefined && !mayReplace(kept, loaded)) storeRef.current.upsert(kept);
        }
      }
      setItems(storeRef.current.getSorted());
      return true;
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

    // Pages are cut by offset from the history as it stands at each request.
    // A request removed from a page already read, or a keyed item emitted
    // again, shifts the later pages, and an item that never changed would be
    // skipped by a read that still passes for whole: the stream follows it
    // from the first page's `at`, and never sends an item kept before that.
    // So each later page starts one item early, on the last item the read
    // holds. If that is not the item there, the history moved, and the read
    // starts over. Each page stays one bounded request, and any server that
    // pages by offset answers it.
    const readPages = async (): Promise<SessionStateSnapshotResponse | null> => {
      let offset = 0;
      let first: SessionStateSnapshotResponse | null = null;
      const mergedItems: OutputItem[] = [];

      while (true) {
        const page = await sessionClient.getSessionState(sessionId, {
          includeItems: true,
          itemTypes: itemConfig.itemTypes,
          offset,
          limit: DEFAULT_STATE_PAGE_LIMIT
        });
        let pageItems = page.items ?? [];

        if (first === null) {
          first = page;
        } else {
          const last = mergedItems[mergedItems.length - 1];
          const overlap = pageItems[0];
          if (last === undefined || overlap === undefined || compareItemOrder(overlap, last) !== 0) {
            return null;
          }
          pageItems = pageItems.slice(1);
        }
        mergedItems.push(...pageItems);

        if (page.pagination?.hasMore !== true) break;
        offset = page.pagination.nextOffset - 1;
      }

      return {
        ...first,
        items: mergedItems,
        pagination: {
          offset: 0,
          limit: mergedItems.length,
          total: mergedItems.length,
          hasMore: false,
          nextOffset: mergedItems.length
        }
      };
    };

    for (let attempt = 1; attempt <= SNAPSHOT_READ_ATTEMPTS; attempt += 1) {
      const whole = await readPages();
      if (whole !== null) return whole;
    }
    throw new Error(
      `Session ${sessionId} changed during each of ${SNAPSHOT_READ_ATTEMPTS} reads of its history; try again.`
    );
  }, [sessionId, sessionClient, itemConfig.enabled, itemConfig.itemTypes]);

  const refreshSnapshot = useCallback(async () => {
    if (sessionId === undefined) {
      return;
    }

    const read = beginSnapshotRead();
    try {
      const [nextDetail, nextSnapshot] = await Promise.all([
        sessionClient.getSession(sessionId),
        fetchSessionSnapshot()
      ]);

      // The detail was read with the snapshot, so it is as old as it is.
      if (nextSnapshot !== null && applySnapshot(nextSnapshot, read)) {
        setDetail(nextDetail);
      }
    } catch (cause) {
      // A newer read already landed: the view is current, whatever this one met.
      if (read.sequence <= snapshotAppliedSequenceRef.current) return;
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, [sessionId, sessionClient, fetchSessionSnapshot, applySnapshot, beginSnapshotRead]);

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
      rejectedItemIdsRef.current.clear();
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
          // invalidation paths (both InvalidationItem leaves in core). There are
          // two resource_change shapes:
          //
          //   - LIVE (`client.live: true`, carries an inline `delta`, FIX-739):
          //     merge the projected delta into the cached snapshot mid-stream —
          //     same mechanism as state_change — and skip the refetch path so a
          //     subscribed useResourceCollectionItem/useResource updates with no
          //     HTTP round-trip.
          //   - DEFAULT (no delta): resources have separate content endpoints,
          //     so flag a single batched snapshot refetch at completion rather
          //     than firing per-change fetches (which burst during
          //     artifact-heavy flows). The onRequestStatus handler checks the
          //     flag; the notice channel drives collection-hook invalidation.
          if (event.item.type === "resource_change") {
            const rc = event.item as ResourceChangeItem;
            if (isReducibleResourceChange(rc)) {
              // Live: merge the delta into the snapshot so a subscribed item
              // updates with no refetch. A create or delete also changes
              // membership/cardinality, which the per-item overlay handles but
              // `count` / list pages don't — flag a single batched refetch at
              // completion to reconcile those (mid-stream item state stays live).
              if (rc.changeType === "created" || rc.changeType === "deleted") {
                resourceChangedDuringStreamRef.current = true;
              }
              setSnapshot((prev) => {
                if (prev === null) {
                  pendingResourceChangesRef.current.push(rc);
                  return prev;
                }
                return mergeResourceChangeIntoSnapshot(prev, rc);
              });
            } else {
              resourceChangedDuringStreamRef.current = true;
              resourceChangeSeqRef.current++;
              const notice: ResourceChangeNotice = {
                resourcePath: rc.resourcePath,
                changeType: rc.changeType,
                seq: resourceChangeSeqRef.current
              };
              setResourceChanges((prev) => [...prev, notice]);
            }
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
            // Never enters the store — drop any deltas it streams (buffered ones
            // now, future ones via the rejected set) so they don't accumulate.
            rejectedItemIdsRef.current.add(event.item.id);
            storeRef.current.discardDeltas(keyOfItem(event.item));
            return;
          }

          if (takeLiveItem(event.item, "own")) setItems(storeRef.current.getSorted());
        },
        onItemDone: (event) => {
          if (!passesItemFilter(event.item, filter)) {
            rejectedItemIdsRef.current.add(event.item.id);
            storeRef.current.discardDeltas(keyOfItem(event.item));
            return;
          }

          if (takeLiveItem(event.item, "own")) setItems(storeRef.current.getSorted());
        },
        onContentAdded: (event) => {
          const key = itemKey(event.requestId, event.itemId);
          // On a finished copy, a part it already has is older than it. A part
          // added after the item finished (synthesized audio, say) is new.
          const held = storeRef.current.getById(key);
          if (held !== undefined && isFinished(held) && event.contentIndex < partCount(held)) return;
          if (storeRef.current.applyContentAdded(key, event.contentIndex, event.content)) {
            setItems(storeRef.current.getSorted());
          }
        },
        onContentDelta: (event) => {
          // Skip deltas for items the filter already rejected — they will never
          // enter the store, so buffering them just grows the queue.
          if (rejectedItemIdsRef.current.has(event.itemId)) return;
          const key = itemKey(event.requestId, event.itemId);
          // Every text delta comes before its item finishes.
          if (isFinished(storeRef.current.getById(key))) return;
          storeRef.current.accumulateDelta(key, event.contentIndex, event.delta);

          scheduleContentFlush();
        },
        onContentDone: (event) => {
          // Settle the slot to its authoritative final content (drops any
          // queued delta for it). Inherited from the shared store — the prior
          // hand-rolled callbacks had no content.done handler.
          const key = itemKey(event.requestId, event.itemId);
          if (storeRef.current.applyContentDone(key, event.contentIndex, event.content)) {
            setItems(storeRef.current.getSorted());
          }
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
      takeLiveItem
    ]
  );

  // Retire every childSession read in flight and clear the axis whenever what
  // we are reading — or where we are reading it from — changes. Declared
  // before the load effect below so the generation has already advanced by
  // the time the new identity's first read is issued.
  useEffect(() => {
    childSessionGenerationRef.current += 1;
    childSessionAppliedSequenceRef.current = 0;
    setChildSessions([]);
    setChildSessionsStale(false);
  }, [sessionId, sessionClient]);

  // The mount read. Besides a `live` view's run notices, this is the only
  // read that is not tied to a user interaction: it covers arriving at a
  // conversation that already has background work running.
  useEffect(() => {
    void refreshChildSessions();
  }, [refreshChildSessions]);

  useEffect(() => {
    // Every read in flight was requested for what the view showed before: a
    // previous session, or another item filter. None may land now.
    snapshotAppliedSequenceRef.current = snapshotSequenceRef.current;

    if (sessionId === undefined) {
      resourceChangedDuringStreamRef.current = false;
      resourceChangeSeqRef.current = 0;
      storeRef.current.clear();
      liveItemsRef.current.clear();
      pendingStateChangesRef.current = [];
      pendingResourceChangesRef.current = [];
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
    setSnapshotAppliedFor(undefined);

    void (async () => {
      try {
        // The catch-up below has to know the latest request was still running
        // BEFORE the snapshot was read, and a status read that RACES the
        // snapshot cannot establish that: the server may serve the snapshot
        // while the request is still running and serve the status after it
        // completed, leaving the status terminal while the snapshot is
        // already stale — so the catch-up would be skipped in exactly the
        // case it exists for. Reading the status first makes a terminal
        // status proof that the snapshot taken after it is current.
        // Sequential on the autoResume path only; every other consumer keeps
        // the single parallel round trip.
        const latestBeforeSnapshot = autoResume ? await refreshLatestRequest() : null;

        if (cancelled) {
          return;
        }

        const read = beginSnapshotRead();
        const [nextDetail, nextSnapshot] = await Promise.all([
          sessionClient.getSession(sessionId),
          fetchSessionSnapshot(),
          autoResume
            ? Promise.resolve(latestBeforeSnapshot)
            : refreshLatestRequest()
        ]);

        if (cancelled) {
          return;
        }

        if (nextSnapshot !== null) {
          // Not landing means a read of this session requested since has.
          if (applySnapshot(nextSnapshot, read)) setDetail(nextDetail);
          setSnapshotAppliedFor(sessionId);
        }

        // Auto-resume: if enabled, check if latest request is in-progress and attach.
        if (
          autoResume &&
          itemConfig.enabled &&
          nextDetail?.latestRequestId !== undefined &&
          streamHandleRef.current === null
        ) {
          // More than one row because this list answers two questions, and the
          // second one needs to see past the newest entry: which request to
          // attach to, and whether the request that was running before the
          // snapshot is still running. Under `allow` concurrency both can be
          // in flight at once, and a single-row read returns only the newer —
          // making the older one's absence prove nothing.
          const requests = await sessionClient.listSessionRequests(sessionId, {
            status: "in_progress",
            limit: IN_PROGRESS_LOOKUP_LIMIT
          });

          if (cancelled) return;

          const activeRequest = requests.find(
            (r) => r.id === nextDetail.latestRequestId
          );

          // Catching up is about ONE request: the one that was running when
          // the snapshot was read. It is worth doing exactly when that request
          // has since finished — then the snapshot may predate its final items
          // and no stream will ever replay them, because a stream is
          // request-scoped and the one we might attach to is a different,
          // newer request.
          //
          // So the condition is its terminality, read from the list above
          // rather than inferred from whether anything is attachable. Absence
          // from an in-progress list that would have contained it is the only
          // evidence here that it finished; "we are attaching to something
          // else" is not, because concurrency allows it to still be running.
          const olderStillRunning = requests.some(
            (r) => r.id === latestBeforeSnapshot?.id
          );

          if (latestBeforeSnapshot?.status === "in_progress" && !olderStillRunning) {
            // It was running before the snapshot and is no longer running, so
            // it finished inside that window. The snapshot we applied may
            // predate its final items, and without this the session sits
            // incomplete until the consumer remounts or refreshes by hand.
            //
            // Ordered before the attach below: `applySnapshot` loads the
            // snapshot over the item store, so running it after a stream had
            // opened would drop whatever that stream had already delivered.
            const catchUpRead = beginSnapshotRead();
            const catchUpSnapshot = await fetchSessionSnapshot();

            if (cancelled) return;

            if (catchUpSnapshot !== null) {
              applySnapshot(catchUpSnapshot, catchUpRead);
            }

            // The summary has to agree with the items we just caught up on.
            // `latestRequest` still holds the in-progress record read before
            // the snapshot. When nothing is attachable nothing else will ever
            // correct it — no stream, so no terminal status event. Leaving it
            // would show completed work beside a summary that reads in-flight
            // — the same inconsistency this branch exists to remove, one
            // field over.
            await refreshLatestRequest();

            if (cancelled) return;
          }

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
  }, [sessionId, sessionClient, fetchSessionSnapshot, applySnapshot, beginSnapshotRead, autoResume, itemConfig.enabled, attachToStream, refreshLatestRequest]);

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

  // `live: true`: follow the whole session. The latest refresher is read
  // through a ref so a new identity doesn't reopen the connection.
  const refreshChildSessionsRef = useRef(refreshChildSessions);
  refreshChildSessionsRef.current = refreshChildSessions;

  useEffect(() => {
    if (!live || sessionId === undefined || snapshotAppliedFor !== sessionId) return;

    const filter = {
      includeTransient: itemConfig.includeTransient,
      itemTypes: itemConfig.itemTypes
    };
    // Held finished already: a request this view sent (its own stream
    // delivered it), or a repeat across a reconnect. Held unfinished: a
    // partial copy, because this view's own stream dropped partway through
    // the item or is still behind, and the finished copy replaces it. A same
    // id from another request is a different item, held under its own key, as
    // a reload holds it.
    const acceptItem = ({ item }: SessionItemEvent): void => {
      if (!itemConfig.enabled || !passesItemFilter(item, filter)) return;
      if (takeLiveItem(item, "session")) setItems(storeRef.current.getSorted());
    };

    // Every connection names the runs first. Until one has, the stream has
    // vouched for nothing, so a stream refused or dropped before then leaves
    // the view as it would be without `live` (BR-16).
    let following = false;

    const handle = createSessionSSEClient({
      sessionId,
      baseUrl,
      since: snapshotAtRef.current,
      itemTypes: itemConfig.itemTypes,
      onItem: acceptItem,
      onRuns: (event) => {
        following = true;
        setLiveRuns(event.runs);
        setLiveLapsed(false);
        void refreshChildSessionsRef.current();
      },
      // The first try after a drop takes about a second, the stream's own
      // pace; once one has failed, the rows are no longer current.
      onReconnecting: ({ attempt }) => {
        if (following && attempt >= 2) setLiveLapsed(true);
      },
      // Refused for good, or the session is gone. Nothing will say when the
      // runs finish, so none of the rows may read as working again.
      onStop: () => {
        if (following) setLiveLapsed(true);
      }
    });

    return () => {
      handle.close();
      setLiveRuns(null);
      setLiveLapsed(false);
    };
  }, [
    live,
    sessionId,
    snapshotAppliedFor,
    baseUrl,
    takeLiveItem,
    itemConfig.enabled,
    itemConfig.includeTransient,
    itemConfig.itemTypes
  ]);

  // What `childSessions` shows: the page, plus any unfinished run the stream
  // named that the page lacks (older than the page, or started since it was
  // read). Those are unfinished by construction.
  const visibleChildSessions = useMemo((): ChildSessionSummary[] => {
    if (liveRuns === null) return childSessions;
    const listed = new Set(childSessions.map((row) => row.id));
    const missing = liveRuns
      .filter((run) => !listed.has(run.id))
      .map((run): ChildSessionSummary => ({ ...run, status: "active" }));
    return missing.length === 0 ? childSessions : [...childSessions, ...missing];
  }, [childSessions, liveRuns]);

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
        itemIndex: storeRef.current.size(),
        provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
        ts: Date.now(),
        message: "Request was stopped.",
        detail: { code: "system.request_aborted" }
      } as OutputItem;

      storeRef.current.upsert(abortItem);
      setItems(storeRef.current.getSorted());
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

      // Discovery, at the start of the interaction (not at its resolution).
      // This is what makes the panel current as of the moment the user acted,
      // and it is deliberately not gated on already knowing about a
      // ChildSession — gating it that way is how a just-launched job would
      // never be discovered at all.
      void refreshChildSessions();

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
      // message without waiting for the server round-trip. The server's own
      // user message for this request replaces it, from whichever stream
      // delivers it first (`takeLiveItem`).
      if (actionOptions?.userMessage !== undefined && itemConfig.enabled) {
        const optimisticItem: OutputItem = {
          id: optimisticIdOf(requestId),
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

        storeRef.current.upsert(optimisticItem);
        setItems(storeRef.current.getSorted());
      }

      try {
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
      refreshSnapshot,
      refreshChildSessions,
      dismissRequest
    ]
  );

  const getOwnedItems = useCallback((ownedBy: string): OutputItem[] => {
    return storeRef.current.getOwnedBy(ownedBy);
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
    // Refreshes the whole view, background work included. Under the
    // interaction-only design this is also the app's way to bring a
    // just-launched job onto the screen without sending another action.
    await Promise.all([refreshSnapshot(), refreshChildSessions()]);
  }, [refreshSnapshot, refreshChildSessions]);

  const resumeLatestRequest = useCallback(async () => {
    if (sessionId === undefined) return;

    // Discovery. This path calls the recovery client directly and bypasses
    // both `sendAction` and `performInlineReentry`, so it needs its own read:
    // retrying a failed parent after a child finished would otherwise leave
    // the panel stale.
    void refreshChildSessions();

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
        // Re-enter through the record's OWNER, the instance that ran it. The
        // stored kind is metadata; for a collection it names no instance, and
        // for a legacy record the bound address is the singleton it implies.
        flowKind: target.flowId ?? resolvedFlowKind,
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
  }, [
    sessionId,
    latestRequest,
    recoveryClient,
    attachToStream,
    refreshLatestRequest,
    refreshChildSessions
  ]);

  // Shared by resumeSuspension (FIX-811) and continueRequest (FIX-865): both
  // re-enter an existing request's own id via a single inline-streaming POST,
  // never followed by a second POST — once the request has gone out, the
  // server has already accepted it (SSE or 202), so a fallback POST would
  // race/409 against the now-resolved record. On a non-streaming 202,
  // reconnect via GET instead of re-posting.
  const performInlineReentry = useCallback(
    async (requestId: string, post: () => Promise<Response>): Promise<void> => {
      // Discovery — the shared path behind `resumeSuspension` and
      // `continueRequest`. A parent that launches background work after a
      // human approval gate comes through here, not through `sendAction`.
      void refreshChildSessions();

      if (streamHandleRef.current !== null) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }
      setError(null);
      setIsFinishing(false);
      setIsStuck(false);
      latestRequestIdAfterDropRef.current = null;
      activeRequestIdRef.current = requestId;

      try {
        const postResponse = await post();

        const contentType = postResponse.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream")) {
          if (itemConfig.enabled) {
            attachToStream(requestId, undefined, postResponse);
          } else {
            postResponse.body?.cancel().catch(() => {});
            void refreshSnapshot();
            void refreshLatestRequest();
          }
          return;
        }

        // Fallback: server returned 202 JSON (no inline streaming). Re-attach
        // via GET and pull the snapshot so the resolution still surfaces.
        postResponse.body?.cancel().catch(() => {});
        if (itemConfig.enabled) {
          attachToStream(requestId);
        }
        void refreshSnapshot();
        void refreshLatestRequest();
      } catch (cause) {
        const normalized = cause instanceof Error ? cause : new Error(String(cause));
        activeRequestIdRef.current = null;
        setError(normalized);
        throw normalized;
      }
    },
    [
      itemConfig.enabled,
      attachToStream,
      refreshSnapshot,
      refreshLatestRequest,
      refreshChildSessions
    ]
  );

  const resumeSuspension = useCallback(
    async (args: {
      suspensionId: string;
      requestId: string;
      action: ResumeAction;
      data?: unknown;
      resumedBy?: string;
    }): Promise<void> => {
      // Stream the resume: POST with Accept: text/event-stream so the
      // continuation streams back from the POST response on the same instance.
      // Mirrors sendAction's inline-streaming path — essential on serverless
      // where a separate GET stream can't reach the in-flight continuation.
      await performInlineReentry(args.requestId, () =>
        recoveryClient.resumeSuspensionStream(resolvedFlowKind, args.requestId, {
          suspensionId: args.suspensionId,
          action: args.action,
          data: args.data,
          resumedBy: args.resumedBy ?? userId
        })
      );
    },
    [recoveryClient, resolvedFlowKind, userId, performInlineReentry]
  );

  const continueRequest = useCallback(
    async (requestId: string): Promise<void> => {
      if (sessionId === undefined) return;

      await performInlineReentry(requestId, () =>
        recoveryClient.continueStream({ flowKind: resolvedFlowKind, sessionId, requestId })
      );
    },
    [sessionId, recoveryClient, resolvedFlowKind, performInlineReentry]
  );

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
    orgId: detail?.orgId,
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
    childSessions: visibleChildSessions,
    childSessionsStale: childSessionsStale || liveLapsed,
    getOwnedItems,
    getItemsByAgent,
    getItemsByVisibility,
    sendAction,
    abortRequest,
    dismissRequest,
    resumeLatestRequest,
    resumeSuspension,
    continueRequest,
    refresh,
    subscribeAudioDelta
  };
}
