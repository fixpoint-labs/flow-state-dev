/**
 * `<DevToolPanel />` — public React component that mounts the full DevTool UI
 * inside any framework app. Construct once with a `userId` and the panel
 * fills its container with the same nav + workspace + detail layout the
 * standalone `fsdev dev` shell renders.
 *
 * Embedded hosts (kitchen-sink, custom apps) typically pass
 * `userIdControl="host"` so the panel doesn't expose its own userId editor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, PanelLeft, User } from "lucide-react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { ChildSessionSummary } from "@flow-state-dev/client";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

import { DevToolProvider, useDevTool, type UserIdControl } from "./context/devtool-context";
import { SelectionProvider } from "./context/selection-context";
import { DebugProvider } from "./context/debug-context";
import { TraceLookupProvider } from "./context/trace-context";

import { FlowRail } from "./components/flows/flow-rail";
import { SettingsSheet } from "./components/shared/settings-sheet";
import { StreamView, type RequestGroup } from "./components/workspace/stream-view";
import { TraceView } from "./components/workspace/trace-view";
import { TaskCollectionsView } from "./components/workspace/task-collections-view";
import { DispatchRunNodes } from "./components/workspace/dispatch-run-nodes";
import { SuspensionsView } from "./components/workspace/suspensions-view";
import {
  InventoryProvider,
  InventoryTabContent,
  InventoryTabTrigger,
} from "./components/workspace/inventory-view";
import { ActionBar } from "./components/workspace/action-bar";
import { LiveSwitch } from "./components/workspace/live-switch";
import { SessionContextPanel } from "./components/detail/session-context";
import { TokenUsageSummary } from "./components/detail/token-usage-summary";
import { ItemDetail } from "./components/detail/item-detail";
import { FlowStateMark } from "./components/shared/flow-state-mark";

import { useRequestStream } from "./hooks/use-request-stream";
import { useActionDispatch } from "./hooks/use-action-dispatch";
import { useSessionRequests } from "./hooks/use-session-requests";
import { useReplay } from "./hooks/use-replay";
import { useContinueRequest } from "./hooks/use-continue-request";
import { useLiveMode } from "./hooks/use-live-mode";
import { useFocusRevalidate } from "./hooks/use-focus-revalidate";
import { useDispatchRuns } from "./hooks/use-dispatch-runs";
import { useReadFence } from "@flow-state-dev/react";
import { flattenTaskItems } from "./lib/task-collection-state";
import { pickFurthestStatus } from "./lib/request-status";

const NAV_EXPANDED_WIDTH = 300;
const NAV_COLLAPSED_WIDTH = 64;
const NAV_MAX_WIDTH = 320;
const DETAIL_DEFAULT_WIDTH = 500;
const DETAIL_MIN_WIDTH = 280;
const DETAIL_MAX_WIDTH = 520;
const MAIN_MIN_WIDTH = 560;

export type DevToolPanelProps = {
  /** Identity used for all DevTool client traffic. The host owns it. */
  userId: string;
  /**
   * Bearer token sent as `Authorization: Bearer` on flow requests, for
   * debugging bearer-gated flows. Under `fsdev dev` this comes from the app's
   * `fsdev.config.ts` `devtool.bearerToken`; embedded hosts usually omit it.
   */
  bearerToken?: string;
  /** Optional API base URL; defaults to same-origin. */
  baseUrl?: string;
  /**
   * Run an interrupted-request sweep on mount. Defaults to false so embedded
   * panels don't cause side effects in the host app — opt in (e.g. the
   * standalone shell) when the panel is the primary surface.
   */
  autoRecoverInterrupted?: boolean;
  /**
   * `"host"` hides the SettingsSheet's userId editor (recommended for
   * embedded mounts). Defaults to `"internal"` for standalone use.
   */
  userIdControl?: UserIdControl;
  /** Optional outer class on the panel root. */
  className?: string;
};

export function DevToolPanel({
  userId,
  bearerToken,
  baseUrl = "",
  autoRecoverInterrupted = false,
  userIdControl = "internal",
  className,
}: DevToolPanelProps) {
  const initialConfig = useMemo(() => ({ userId, bearerToken }), [userId, bearerToken]);

  return (
    <DevToolProvider
      initialConfig={initialConfig}
      baseUrl={baseUrl}
      autoRecoverInterrupted={autoRecoverInterrupted}
      userIdControl={userIdControl}
    >
      <DebugProvider>
        {/*
          `SelectionProvider` is deliberately NOT here. Trace/block/item detail
          belongs to one workspace, so it is mounted inside `PanelContent` and
          keyed on the visit — see `workspaceKey`. Debug toggles are the
          operator's preference and outlive every switch, so they stay out here.
        */}
        <PanelContent className={className} />
      </DebugProvider>
    </DevToolProvider>
  );
}

function PanelContent({ className }: { className?: string }) {
  const {
    config,
    activeFlow,
    activeFlowId,
    activeSessionId,
    workspaceToken,
    recoveryClient,
    selectWorkspace,
  } = useDevTool();
  const [navExpanded, setNavExpanded] = useState(true);
  const [navWidth, setNavWidth] = useState(NAV_EXPANDED_WIDTH);
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH);

  // The session under the selected instance, and nothing else. The panel used
  // to fold in a second, locally-restored "sticky" session, which meant the
  // navigator and the workspace each held an answer to the same question and
  // could give different ones. The provider owns the restore now, and only
  // installs a saved session once the server has confirmed it belongs to the
  // instance on screen.
  const effectiveSessionId = activeSessionId;

  // The panel's own staleness check, on the same primitive its hooks use.
  //
  // A ref synchronised by a PASSIVE EFFECT cannot serve, which is what this
  // replaced: between a workspace change committing and that effect running
  // there is a window where such a ref still names the session just left. An
  // awaited callback settling in that window passes the check and installs its
  // request as the active stream under the session now open.
  //
  // That is the render-versus-effect trap for the third time here — a
  // generation counter read too late, then captured too early, now a cell
  // updated on a different schedule from the render that changed it. The fence
  // mirrors its identity DURING RENDER, so there is no schedule to be out of
  // step with. A ref written in render would work equally; this is the same
  // question the hooks ask, so it uses the same answer rather than a fourth
  // mechanism.
  //
  // Keyed on the visit token, not the session id alone: leaving instance A for
  // B and coming back restores the same id, and a callback retired on the way
  // out would agree with it again.
  const sessionFence = useReadFence([workspaceToken, effectiveSessionId]);

  const { requests, refresh: refreshRequests } = useSessionRequests(effectiveSessionId);
  // The dispatch runs started from this session, read through the provenance
  // route. The Tasks tab draws a link per task from these rows, and the block
  // tree renders one collapsed node per run, so the list is fetched once here
  // and shared rather than read twice.
  const {
    dispatchRuns,
    truncation: dispatchRunsTruncation,
    isLoading: dispatchRunsLoading,
    error: dispatchRunsError,
    refresh: refreshDispatchRuns,
  } = useDispatchRuns(effectiveSessionId);
  const { sendAction, isSending, lastResponse } = useActionDispatch();

  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  // Tracks the request id the user dispatched from the action bar while it's
  // still in flight. Distinct from `activeRequestId` so we can tell whether
  // the open SSE stream belongs to the user (locks the Live toggle) or was
  // auto-subscribed by live mode (toggle stays interactive).
  const [dispatchedRequestId, setDispatchedRequestId] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<Map<string, OutputItem[]>>(new Map());
  // Raw (uncollapsed) counterpart of `liveItems`, populated only by the
  // per-row Continue action (FIX-865) — see `handleContinueItems` below.
  const [liveRawItems, setLiveRawItems] = useState<Map<string, OutputItem[]>>(new Map());

  const { replayState, isReplaying, replayFull, replayFromCursor, simulateReconnect, clearReplay } = useReplay();

  // Reset transient request state on every workspace transition — an instance
  // switch, a session pick, a credential change. The two item maps are keyed by
  // request id, so they never collide across sessions — but the synthetic group
  // `requestGroups` appends for an `activeRequestId` that is not in `requests`
  // reads straight out of them, which is how the workspace left behind keeps
  // rendering its items under the newly opened one.
  //
  // `dispatchedRequestId` is cleared here too, and only here for this path. Its
  // usual release is the terminal-status effect below, which never fires on a
  // session switch: clearing `activeRequestId` disables the stream, so the
  // status goes to `idle` rather than `completed`. Left set, it names a request
  // in the session we just left, and `useLiveMode` only auto-subscribes when it
  // is null — so live mode would silently ignore an in-progress request in the
  // session the user just opened.
  //
  // ## Why this is not an effect
  //
  // It was, and a real browser caught what that costs. An effect-based reset
  // leaves ONE COMMIT in which `activeFlowId` has already moved to the copy just
  // selected while `activeRequestId` still names the request of the copy just
  // left — and the stream effect in that commit connects the two together,
  // issuing `/api/flows/<new copy>/requests/<old copy's request>/stream`. One
  // instance's request on another's address, sent before the reset it is racing
  // has run.
  //
  // Adjusting the state during render is React's documented answer to exactly
  // this ("adjusting state when a prop changes"): the body re-runs before
  // anything commits, so no child, effect or request ever observes the
  // mismatched pair. It is the same move the read fences make — mirror the
  // identity during render, so there is no schedule to be out of step with.
  const [transientVisit, setTransientVisit] = useState(workspaceToken);
  if (transientVisit !== workspaceToken) {
    setTransientVisit(workspaceToken);
    setActiveRequestId(null);
    setDispatchedRequestId(null);
    setLiveItems(new Map());
    setLiveRawItems(new Map());
    clearReplay();
  }

  const streamRequestId = replayState.requestId ?? activeRequestId;
  // Bumped to force the stream to re-attach to the SAME request id after a
  // same-request continuation (FIX-811). Resume/continue re-enter under the
  // original id, so without this the connect effect (keyed on the id) wouldn't
  // re-run and the resumed run's progress would only show on a page reload.
  const [streamReconnectToken, setStreamReconnectToken] = useState(0);
  const handleSessionMetadataChanged = useCallback(() => {
    setSessionRefreshKey((k) => k + 1);
    setStateRefreshKey((k) => k + 1);
  }, []);

  const { streamState, streamStatus, items: streamItems } = useRequestStream({
    flowId: activeFlowId,
    requestId: streamRequestId,
    startingAfter: replayState.startingAfter,
    lastEventId: replayState.lastEventId,
    enabled: !!streamRequestId,
    reconnectToken: streamReconnectToken,
    onSessionMetadataChanged: handleSessionMetadataChanged,
  });

  const [stateRefreshKey, setStateRefreshKey] = useState(0);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  // Refresh the open session as one unit: the transcript (which the trace and
  // token-usage views derive from) plus the state and resource panels via the
  // shared stateRefreshKey fan-out. Used by the Sessions ⟳ button and on focus
  // revalidation. Does not re-list sessions — callers that need that bump
  // sessionRefreshKey themselves.
  const refreshActiveSession = useCallback(() => {
    void refreshRequests();
    // Background work is never streamed into this session, so nothing else
    // brings the dispatch-run list current — it has to ride the same refresh.
    void refreshDispatchRuns();
    setStateRefreshKey((k) => k + 1);
  }, [refreshRequests, refreshDispatchRuns]);

  // Bring the open session current when the developer returns to the DevTool
  // (tab visible again or window refocused), so out-of-band changes show up
  // without a manual refresh. Stands down while SSE is actively delivering —
  // the live path already keeps the view fresh there.
  useFocusRevalidate(
    useCallback(() => {
      refreshActiveSession();
      setSessionRefreshKey((k) => k + 1);
    }, [refreshActiveSession]),
    {
      enabled:
        !!effectiveSessionId &&
        streamStatus !== "streaming" &&
        streamStatus !== "connecting",
    },
  );

  const { liveMode, lockedOn, liveSubscriptionRequestId, liveStatus, showToggle, toggleLiveMode } =
    useLiveMode({
      requests,
      streamStatus,
      dispatchedRequestId,
      refreshRequests,
    });

  useEffect(() => {
    if (streamStatus === "completed" || streamStatus === "failed") {
      void refreshRequests();
      setStateRefreshKey((k) => k + 1);
      if (isReplaying) clearReplay();
      // The user-dispatched stream finished (or errored). Releasing the id
      // unlocks the Live toggle and lets live mode pick up any external
      // in-progress request that's still running.
      setDispatchedRequestId(null);
    }
  }, [streamStatus, refreshRequests, isReplaying, clearReplay]);

  // Bump the state refresh key whenever a new state_change or resource_change
  // streams in, so SessionContextPanel and its ResourcesPanel can re-fetch
  // the server-side view in step with the runtime. Tracked by count so a
  // batch of N new mutations triggers exactly one refresh cycle per render.
  // Scans `liveItems` too (not just the watched `streamItems`) so a mutation
  // that arrives via a per-row Continue action's own stream (FIX-865) — which
  // only populates `liveItems`, not `streamItems` — also triggers a refresh.
  const lastStateMutationCountRef = useRef(0);
  useEffect(() => {
    let count = 0;
    for (const item of streamItems) {
      if (item.type === "state_change" || item.type === "resource_change") count++;
    }
    // `liveItems[streamRequestId]` is a copy of `streamItems` (see the effect
    // below), so skip it here — otherwise the watched request's own mutations
    // get counted twice and bump stateRefreshKey/refetch twice per mutation.
    for (const [id, items] of liveItems) {
      if (id === streamRequestId) continue;
      for (const item of items) {
        if (item.type === "state_change" || item.type === "resource_change") count++;
      }
    }
    if (count !== lastStateMutationCountRef.current) {
      lastStateMutationCountRef.current = count;
      if (count > 0) setStateRefreshKey((k) => k + 1);
    }
  }, [streamItems, liveItems, streamRequestId]);

  // Live mode wants to subscribe to an external in-progress request. Drop any
  // partial liveItems for it so polled `req.items` show through cleanly if SSE
  // can't connect.
  useEffect(() => {
    if (!liveSubscriptionRequestId) return;
    if (activeRequestId === liveSubscriptionRequestId) return;
    setLiveItems((prev) => {
      if (!prev.has(liveSubscriptionRequestId)) return prev;
      const next = new Map(prev);
      next.delete(liveSubscriptionRequestId);
      return next;
    });
    setActiveRequestId(liveSubscriptionRequestId);
  }, [liveSubscriptionRequestId, activeRequestId]);

  // Live mode turned off while an auto-subscribed external stream is open: close it.
  // The user-dispatched stream (if any) is preserved.
  useEffect(() => {
    if (liveMode) return;
    if (!activeRequestId) return;
    if (activeRequestId === dispatchedRequestId) return;
    if (replayState.requestId) return;
    setActiveRequestId(null);
  }, [liveMode, activeRequestId, dispatchedRequestId, replayState.requestId]);

  useEffect(() => {
    if (streamRequestId && streamItems.length > 0) {
      setLiveItems((prev) => {
        const next = new Map(prev);
        next.set(streamRequestId, [...streamItems]);
        return next;
      });
    }
  }, [streamRequestId, streamItems, workspaceToken]);

  const requestGroups: RequestGroup[] = useMemo(() => {
    // Reconcile the watched request's status between the live stream and the
    // session-requests snapshot (FIX-811). The snapshot only refetches on
    // terminal / refresh, so a mid-flight transition (in_progress → suspended)
    // must read from `streamState`. But `streamState` persists after the wire
    // closes — a suspended-run stream freezes at `suspended` — so it must NOT
    // override a fresher status the store already has once the stream settles.
    // Rule: while the stream is actively connected it's the real-time truth;
    // once it settles, show whichever side is furthest along. Every other
    // request uses its list status.
    const liveStreamStatus = streamState?.status;
    const streamIsLive =
      streamStatus === "streaming" || streamStatus === "connecting";
    const groups: RequestGroup[] = [];
    for (const req of requests) {
      const isWatched = req.id === streamRequestId && liveStreamStatus !== undefined;
      const status = isWatched
        ? streamIsLive
          ? liveStreamStatus
          : pickFurthestStatus(liveStreamStatus, req.status)
        : req.status;
      groups.push({
        requestId: req.id,
        action: req.actionName,
        status,
        startedAt: req.startedAtMs ?? req.createdAt,
        duration: req.completedAtMs && req.startedAtMs ? req.completedAtMs - req.startedAtMs : undefined,
        items: liveItems.get(req.id) ?? req.items ?? [],
        // `req.items` (from `listSessionRequests({ includeItems: true })`) is
        // the raw, uncollapsed log already — but it's the polled snapshot, so
        // it can be empty/stale while a request is actively streaming. A
        // per-row Continue action's own stream (`liveRawItems`) takes
        // priority; for the watched main-stream request, fall back to the
        // live `streamState.rawItems` (trace-inclusive) before the polled list.
        rawItems: liveRawItems.get(req.id) ?? (isWatched ? streamState?.rawItems : undefined) ?? req.items ?? [],
        source: req.source,
        metadata: req.metadata,
      });
    }
    if (activeRequestId && !requests.find((r) => r.id === activeRequestId)) {
      groups.push({
        requestId: activeRequestId,
        action: lastResponse?.request.actionName ?? "action",
        status: liveStreamStatus ?? "in_progress",
        startedAt: Date.now(),
        items: liveItems.get(activeRequestId) ?? [],
        rawItems: liveRawItems.get(activeRequestId) ?? streamState?.rawItems ?? [],
      });
    }
    return groups;
  }, [requests, liveItems, liveRawItems, activeRequestId, lastResponse, streamState, streamStatus, streamRequestId]);

  // The flat item stream the Tasks tab and the block tree fold. Derived here
  // rather than in the JSX because `flatMap` returns a NEW array on every
  // render: computing it at each call site handed those panels a fresh `items`
  // reference every time, so their own `useMemo`s recomputed even when the
  // items were unchanged — which is the memo doing nothing at all.
  //
  // The fold itself deliberately stays inside each panel. `TabsContent` has no
  // `forceMount`, so Radix unmounts the inactive tab and at most one of the two
  // is ever mounted; lifting the fold here would instead run it on every
  // `requestGroups` change no matter which tab is open, i.e. on every streamed
  // item while the user is watching the Stream tab, for nothing.
  //
  // Flattened through `flattenTaskItems` rather than a bare `flatMap`, because
  // `requestGroups` is newest-first and the fold settles a same-millisecond tie
  // by walk order — which is right within a request and inverted across them.
  // Ordering the requests here fixes the axis without disturbing the Stream and
  // Trace tabs, which read `requestGroups` directly and want it newest-first.
  const taskItems = useMemo(() => flattenTaskItems(requestGroups), [requestGroups]);

  // Opening a dispatch run is opening a session — the same move as picking one
  // from the rail, because that is what a run now is. It carries no trail and
  // no way back beyond the rail itself: the run is listed there, under the
  // session that started it, so there is nothing to retrace.
  //
  // The run's own admitted owner, when the server recorded one. A record
  // written before owners existed has none, and the only honest reading of that
  // is "the instance we are already in" — it is the one that could have started
  // it under the old same-flow rule.
  //
  // Instance and session move in ONE transition. Two updates would leave a
  // render in which the run is open under the other instance, and the reads
  // that render fires would be addressed to the wrong copy.
  const handleOpenDispatchRun = useCallback(
    (run: ChildSessionSummary) => {
      if (activeFlowId === null || effectiveSessionId === run.id) return;
      selectWorkspace(run.flowId ?? activeFlowId, run.id);
    },
    [effectiveSessionId, activeFlowId, selectWorkspace],
  );

  // The dispatch-run axis is interaction-scoped
  // (`docs/architecture/server-and-client.md`): it advances on every
  // work-starting call, and on nothing else. The panel's paths, against the
  // four that contract names, so the set is enumerated rather than rediscovered
  // one report at a time:
  //
  // - `sendAction`          → `handleSendAction`   — refreshed.
  // - `resumeSuspension`    → `handleResumed`      — refreshed.
  // - `continueRequest`     → `handleContinue`     — refreshed.
  // - `resumeLatestRequest` → NO EQUIVALENT. The top-level Resume button was
  //   removed in FIX-865 as a strictly narrower case of the per-row Continue
  //   above; `devtool-panel.test.tsx` pins its absence.
  //
  // Deliberately NOT refreshed: `handleReplayFull`, `handleReplayFromCursor`
  // and `handleReconnect`. Replay re-streams a request that already ran — it
  // starts no work and can start no dispatch run, so a read there would be a
  // request per inspection with nothing to find.
  //
  // A SECOND enumeration over the same callbacks, because they carry a second
  // hazard: which of them can still be invoked after the session has changed,
  // and therefore act on one workspace while another is open? Only a callback
  // reached across an `await` can — a click handler cannot fire after its
  // component is gone.
  //
  // - `handleSendAction`  — awaits its dispatch. Fenced on `sessionFence`.
  // - `handleResumed`     — invoked by `SuspensionsView` after ITS await, so it
  //                         outlives the component. Fenced at entry, below.
  // - `handleContinueItems` — fires during a continuation stream, but
  //                         `useContinueRequest` carries an owner token bumped
  //                         on `sessionId` precisely so it is not called into a
  //                         stale view. Guarded upstream; nothing owed here.
  // - `handleContinue`, `handleReplay*`, `handleReconnect`,
  //   `handleOpenDispatchRun` — synchronous click handlers with no await before
  //   their writes, so there is no window in which the session can move
  //   underneath them.
  const handleSendAction = useCallback(
    async (action: string, input: unknown) => {
      if (!activeFlowId || !effectiveSessionId) return;
      const stillCurrent = sessionFence.begin();
      if (stillCurrent === null) return;
      // Re-read the dispatch-run axis at the START of the call, which is what
      // `docs/architecture/server-and-client.md` specifies and what
      // `useSession` does. The reason it is the start rather than the end: the
      // read is anchored to a local fact — this panel dispatched an interaction
      // — so nothing the turn then does can remove it. A board that declares
      // nothing detached, a dropped connection, an action that throws: none of
      // them skip a read that already happened. Anchoring it to the response
      // would make the refresh conditional on the very thing most likely to
      // fail.
      //
      // It needs no session fence of its own: nothing is awaited before it, so
      // it always names the session on screen, and the hook already retires its
      // own read by generation if the workspace moves while it is in flight.
      void refreshDispatchRuns();
      const response = await sendAction(activeFlowId, effectiveSessionId, action, input);
      // The workspace can move while this is in flight — opening a dispatch run
      // is a click away — and the session-change reset has already cleared both
      // ids by the time we resume. Installing them now would put a request from
      // the session just LEFT in front of the live stream, and render its items
      // under the session now open.
      //
      // `sessionFence` is the panel's record of which session the workspace is
      // on, mirrored during render, so it is the right thing to compare against
      // rather than a second generation counter.
      if (!stillCurrent()) return;
      if (response?.request.id) {
        setActiveRequestId(response.request.id);
        setDispatchedRequestId(response.request.id);
      }
    },
    [activeFlowId, effectiveSessionId, sendAction, refreshDispatchRuns, sessionFence],
  );

  // After a suspension is resolved, re-attach the live stream to the continued
  // (same-id) request. The request stream follows the continuation through the
  // resume (the server keeps the wire open while the continuation lease is held,
  // FIX-811), so the post-resume output renders without a manual refresh.
  const handleResumed = useCallback(
    (requestId: string) => {
      // Fenced at ENTRY, covering everything below rather than each thing
      // separately. `SuspensionsView`'s resume is an async handler: the operator
      // can navigate while it awaits, and the unmounted component then invokes
      // the `onResumed` it captured — this callback, built for the session that
      // has been left. Installing that request id would put the previous
      // session's continuation in front of the live stream.
      //
      // `isCurrent`, NOT `begin`. There is no read here — the damage is state
      // writes and a forced reconnect, which happen before anything is
      // fetched — so all this wants is the question. Asking it through `begin`
      // also takes a sequence number, and that number is what arbitrates reads
      // of the SAME data racing each other: consuming one here retired the
      // dispatch awaiting its response a few lines up, discarding a request id
      // the operator had just asked for in a session that never changed.
      //
      // One question, asked once, at the boundary the staleness actually
      // crosses — so anything added to this callback later is covered by
      // construction.
      //
      // Guarded here rather than in `SuspensionsView` because the only signal
      // the child has is its own mounted-ness, which is a PROXY for session
      // identity — and proxies for identity are what produced the last three
      // findings on this surface. The panel owns the identity, so it owns the
      // check. `useResumeSuspension` is no better a home: unlike
      // `useContinueRequest`, which carries an owner token for exactly this, it
      // takes no session and could not tell.
      if (!sessionFence.isCurrent()) return;
      setActiveRequestId(requestId);
      setDispatchedRequestId(requestId);
      // Force a reconnect: the id is unchanged (same-request continuation), so
      // the stream's connect effect won't re-run on the id alone.
      setStreamReconnectToken((t) => t + 1);
      void refreshRequests();
      // `resumeSuspension` on the contract's list of work-starting calls: a
      // resumed run can reach a board and file background work, so the axis has
      // to advance here too.
      //
      // Not start-anchored the way the dispatch is, because the panel does not
      // own this dispatch — `SuspensionsView` does, and this is its success
      // notification. That IS the earliest point the panel learns of it, which
      // is the same principle applied where it can be: a local fact, read
      // immediately, with nothing downstream able to skip it.
      void refreshDispatchRuns();
    },
    [refreshRequests, refreshDispatchRuns, sessionFence],
  );

  // Per-row Continue action (FIX-865) — supersedes the legacy top-level
  // Resume button. Each request row gets its own Continue action in its
  // separator's overflow menu (gated on `interrupted` + non-webhook source),
  // so the latest-only Resume button was redundant with (and used a
  // different, non-inline-streaming code path than) the general case.
  const handleContinueItems = useCallback(
    (requestId: string, items: OutputItem[], rawItems: OutputItem[]) => {
      setLiveItems((prev) => { const next = new Map(prev); next.set(requestId, items); return next; });
      setLiveRawItems((prev) => { const next = new Map(prev); next.set(requestId, rawItems); return next; });
    },
    [],
  );
  const { continueRequest, isContinuing } = useContinueRequest({
    recoveryClient,
    flowId: activeFlowId,
    sessionId: effectiveSessionId,
    onItems: handleContinueItems,
    // The row's status in `requests` (polled) is stale the moment the
    // continuation settles (terminal status, or a non-streaming 202
    // fallback) — refresh so it stops reading `interrupted`.
    onSettled: () => void refreshRequests(),
  });

  const handleContinue = useCallback(
    (requestId: string) => {
      const req = requests.find((r) => r.id === requestId);
      // Seed from the raw (uncollapsed) log, not the canonical one — the
      // continuation store's `loadSnapshot` treats its seed as the raw log
      // itself (see `use-continue-request`), so seeding from `liveItems`
      // (already collapsed) loses any earlier continuation's pre-recovery
      // boundary rows the first update would otherwise overwrite
      // `liveRawItems` with. Mirrors the same raw-then-canonical priority
      // `groups` above uses when rendering this row's Trace tab.
      const isWatched = requestId === streamRequestId && streamState !== undefined;
      const existingItems =
        liveRawItems.get(requestId) ??
        (isWatched ? streamState?.rawItems : undefined) ??
        liveItems.get(requestId) ??
        req?.items ??
        [];
      // `continueRequest` on the contract's list, and start-anchored like the
      // dispatch: a continuation resumes a run mid-flight, which can reach a
      // board that dispatches detached work. Read before the call so a
      // continuation that hangs or throws cannot skip it.
      void refreshDispatchRuns();
      void continueRequest(requestId, existingItems).catch((err) => {
        console.error("[devtool] continue failed", err);
      });
    },
    [
      requests,
      liveItems,
      liveRawItems,
      streamState,
      streamRequestId,
      continueRequest,
      refreshDispatchRuns,
    ],
  );

  const handleReplayFull = useCallback(
    (requestId: string) => {
      setLiveItems((prev) => { const next = new Map(prev); next.delete(requestId); return next; });
      // A prior per-row Continue may have left this row's raw trace log in
      // `liveRawItems`, which takes priority over the replay stream's own
      // rawItems — clear it so Replay isn't stuck showing the stale continuation.
      setLiveRawItems((prev) => { const next = new Map(prev); next.delete(requestId); return next; });
      replayFull(requestId);
    },
    [replayFull],
  );

  const handleReplayFromCursor = useCallback(
    (requestId: string) => {
      const items = liveItems.get(requestId) ?? [];
      setLiveRawItems((prev) => { const next = new Map(prev); next.delete(requestId); return next; });
      replayFromCursor(requestId, items.length);
    },
    [replayFromCursor, liveItems],
  );

  const handleReconnect = useCallback(
    (requestId: string) => {
      const items = liveItems.get(requestId) ?? [];
      setLiveRawItems((prev) => { const next = new Map(prev); next.delete(requestId); return next; });
      simulateReconnect(requestId, `${requestId}:${items.length}`);
    },
    [simulateReconnect, liveItems],
  );

  const onStartResize = (panel: "nav" | "detail", startClientX: number) => {
    const startNav = navWidth;
    const startDetail = detailWidth;
    const onMove = (event: MouseEvent) => {
      if (panel === "nav") {
        setNavWidth(Math.min(NAV_MAX_WIDTH, Math.max(NAV_COLLAPSED_WIDTH, startNav + (event.clientX - startClientX))));
      } else {
        const next = Math.max(DETAIL_MIN_WIDTH, Math.min(DETAIL_MAX_WIDTH, startDetail - (event.clientX - startClientX)));
        const maxDetail = Math.max(DETAIL_MIN_WIDTH, window.innerWidth - MAIN_MIN_WIDTH - (navExpanded ? navWidth : NAV_COLLAPSED_WIDTH));
        setDetailWidth(Math.min(next, maxDetail));
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const rootClass = ["fsd-devtool-panel", "h-full overflow-hidden bg-slate-950 text-slate-100", className]
    .filter(Boolean)
    .join(" ");

  // The identity of this workspace VISIT, used to key the owned subtree.
  //
  // This component's own transient state is reset during render (above), so it
  // needs no key. What the key is for is everything MOUNTED BELOW: state,
  // resources, suspensions and the trace/block/item selection all live in
  // components whose own reset would be a passive effect, leaving one render
  // with the new selection and the previous workspace's content still in place.
  // That render is the flash of A's content under B. Remounting on the key
  // removes the frame it could appear in, and retires those readers outright.
  //
  // The token is in the key because A → B → A must not restore the subtree A
  // left behind: the ids come back, the visit does not.
  const workspaceKey = `${activeFlowId ?? "none"}:${effectiveSessionId ?? "none"}:${workspaceToken}`;

  return (
    <TraceLookupProvider requestGroups={requestGroups}>
    <div className={rootClass}>
      <header className="flex h-10 select-none items-center justify-between border-b border-slate-800 px-4">
        <div className="flex items-center gap-2.5">
          <FlowStateMark theme="dark" className="h-[22px] w-[22px] shrink-0" />
          <h1 className="text-sm font-semibold tracking-wide">FSD DevTools</h1>
          <Badge variant="secondary" className="text-[10px]">v0.1.0</Badge>
        </div>
      </header>

      <div className="flex h-[calc(100%-2.5rem)]">
        {/* Navigator */}
        <aside
          className="flex flex-col select-none border-r border-slate-800 bg-slate-900/50"
          style={{ width: navExpanded ? `${navWidth}px` : `${NAV_COLLAPSED_WIDTH}px` }}
        >
          <div className="p-2">
            <Button variant="ghost" size="sm" className="flex w-full justify-between h-7" onClick={() => setNavExpanded((c) => !c)}>
              <span className="inline-flex items-center gap-1.5">
                <PanelLeft className="h-3.5 w-3.5" />
                {navExpanded ? <span className="text-xs">Navigator</span> : null}
              </span>
              {navExpanded ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {navExpanded && (
            <>
              {/*
                The navigator draws its own section label and owns the ONE
                scroll container for the rail — a wrapper with `overflow-auto`
                here would nest a second scrollbar inside 300 pixels.
              */}
              <div className="min-h-0 flex-1 px-1">
                <FlowRail
                  sessionRefreshKey={sessionRefreshKey}
                  onRefreshActiveSession={refreshActiveSession}
                />
              </div>
              <Separator />
              <div className="p-2 space-y-1">
                <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400">
                  <User className="h-3.5 w-3.5" />
                  <span className="truncate">{config.userId}</span>
                </div>
                <SettingsSheet />
              </div>
            </>
          )}
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          className="w-1 cursor-col-resize bg-slate-800/50 hover:bg-sky-500"
          onMouseDown={(e) => onStartResize("nav", e.clientX)}
        />

        {/*
          DO NOT REMOVE THIS KEY. It is not cosmetic and it is not redundant.

          Everything from here to the end of the detail panel belongs to ONE
          workspace visit and remounts with it, and that remount is the ONLY
          thing retiring the readers inside it. `use-session-state`,
          `use-debug-resources`, `use-debug-resource-content`,
          `use-debug-collection-items` and `use-list-suspensions` carry no fence
          of their own precisely because this key unmounts them, so a response
          from the copy just left writes to a component that no longer exists.
          Delete the key and every one of them silently starts committing the
          previous instance's state, resources and pending approvals under the
          newly selected one.

          `devtool-panel-owned-subtree.test.tsx` fails if it goes.

          Which layer owns what, so nobody adds a fifth:
          - THIS KEY retires everything mounted below it: the five readers above,
            and the trace/block/item selection, which names an item inside a
            particular request of a particular session.
          - THE READ FENCE (`useReadFence`, from `@flow-state-dev/react`) retires
            the readers that STAY mounted across a switch — the panel's own
            request and dispatch-run lists, which live above here. The rail's
            session list is fenced inside `FlowNavigator`, not here.
          - THE RENDER-PHASE RESET above retires this component's own transient
            request state (`activeRequestId`, the item maps, replay), which no
            remount covers because `PanelContent` itself does not remount.
          - THE STREAM HOOK closes its own SSE handle on the visit, because a
            live connection outlives a React unmount.

          What this key does NOT do, so nobody below it assumes otherwise: it
          retires reads when the WORKSPACE changes, and does nothing about two
          reads of the SAME identity resolving out of order — a mount read, a
          Refresh click and a `refreshKey` fan-out can be in flight together,
          and the oldest response may land last. That is the second hazard
          `useReadFence` exists for, and the fence is the only thing that
          answers it. The five readers below have never been protected against
          it, before this key or after, so this is a standing gap and not
          something traded away for the remount. A new reader added here
          inherits the same gap; if it needs ordering within one identity, it
          needs a fence of its own as well.
        */}
        <SelectionProvider key={workspaceKey}>
        <InventoryProvider sessionId={effectiveSessionId}>
        {/* Main workspace */}
        <main className="flex min-w-0 min-h-0 flex-1 flex-col bg-slate-950">
          <Tabs defaultValue="stream" className="flex flex-1 flex-col min-h-0">
            <div className="flex select-none items-center justify-between gap-3 px-3 pt-2">
              <TabsList>
                <TabsTrigger value="stream">Stream</TabsTrigger>
                <TabsTrigger value="trace">Trace</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
                <TabsTrigger value="suspensions">Suspensions</TabsTrigger>
                <InventoryTabTrigger />
              </TabsList>
              <div className="flex items-center gap-3 min-w-0">
                <SessionIdBadge sessionId={effectiveSessionId} />
                {(liveStatus !== "idle" || showToggle) && (
                  <LiveSwitch
                    on={lockedOn ? true : liveMode}
                    disabled={lockedOn}
                    status={liveStatus}
                    showToggle={showToggle}
                    onToggle={() => toggleLiveMode()}
                  />
                )}
              </div>
            </div>

            <Separator className="mt-2" />

            <TabsContent value="stream" className="flex-1 min-h-0 m-0">
              <StreamView
                requestGroups={requestGroups}
                streamStatus={streamStatus}
                isReplaying={isReplaying}
                onReplayFull={handleReplayFull}
                onReplayFromCursor={handleReplayFromCursor}
                onReconnect={handleReconnect}
                onContinue={handleContinue}
                isContinuing={isContinuing}
              />
            </TabsContent>

            <TabsContent value="trace" className="flex-1 min-h-0 m-0 overflow-auto">
              <TraceView requestGroups={requestGroups} />
              {/*
                The work this session dispatched, under the work that dispatched
                it. Collapsed, and nothing about a run is read until a reader
                opens one — see `dispatch-run-nodes`.
              */}
              <DispatchRunNodes
                runs={dispatchRuns}
                truncation={dispatchRunsTruncation}
                isLoading={dispatchRunsLoading}
                error={dispatchRunsError}
                onOpen={handleOpenDispatchRun}
              />
            </TabsContent>

            <TabsContent value="tasks" className="flex-1 min-h-0 m-0 overflow-auto">
              <TaskCollectionsView
                items={taskItems}
                dispatchRuns={dispatchRuns}
                truncation={dispatchRunsTruncation}
                onOpenDispatchRun={handleOpenDispatchRun}
              />
            </TabsContent>

            <TabsContent value="suspensions" className="flex-1 min-h-0 m-0">
              <SuspensionsView
                sessionId={effectiveSessionId}
                onResumed={handleResumed}
              />
            </TabsContent>

            <InventoryTabContent sessionId={effectiveSessionId} />

            <Separator />

            <div className="p-2">
              <ActionBar
                flowId={activeFlowId}
                sessionId={effectiveSessionId}
                availableActions={activeFlow?.actions ?? []}
                actionSchemas={activeFlow?.actionSchemas}
                onSendAction={handleSendAction}
                isSending={isSending}
              />
            </div>
          </Tabs>
        </main>
        </InventoryProvider>

        <div
          role="separator"
          aria-orientation="vertical"
          className="w-1 cursor-col-resize bg-slate-800/50 hover:bg-sky-500"
          onMouseDown={(e) => onStartResize("detail", e.clientX)}
        />

        {/* Detail panel */}
        <aside
          className="flex flex-col border-l border-slate-800 bg-slate-900/40 overflow-auto"
          style={{ width: `${detailWidth}px` }}
        >
          <div className="flex-1 p-3 space-y-4">
            <TokenUsageSummary requestGroups={requestGroups} />
            <Separator />
            <SessionContextPanel sessionId={effectiveSessionId} refreshKey={stateRefreshKey} />
            <Separator />
            <ItemDetail />
          </div>
        </aside>
        </SelectionProvider>
      </div>
    </div>
    </TraceLookupProvider>
  );
}

function SessionIdBadge({ sessionId }: { sessionId: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!sessionId) {
    return (
      <span className="text-[10px] text-slate-600 italic">no session</span>
    );
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(sessionId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const truncated = sessionId.length > 12 ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : sessionId;

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Session ID: ${sessionId}\nClick to copy`}
      className="group inline-flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/60 px-2 py-0.5 text-[10px] font-mono text-slate-300 hover:border-slate-700 hover:bg-slate-800"
    >
      <span className="text-[9px] uppercase tracking-wide text-slate-500 font-sans">session</span>
      <span>{truncated}</span>
      {copied ? (
        <Check className="h-3 w-3 text-green-400" />
      ) : (
        <Copy className="h-3 w-3 text-slate-500 group-hover:text-slate-300" />
      )}
    </button>
  );
}
