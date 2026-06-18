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
import { Check, ChevronLeft, ChevronRight, Copy, PanelLeft, RotateCcw, User } from "lucide-react";
import type { OutputItem } from "@flow-state-dev/core/items";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

import { DevToolProvider, useDevTool, type UserIdControl } from "./context/devtool-context";
import { SelectionProvider } from "./context/selection-context";
import { DebugProvider } from "./context/debug-context";
import { TraceLookupProvider } from "./context/trace-context";

import { FlowList } from "./components/navigator/flow-list";
import { SettingsSheet } from "./components/navigator/settings-sheet";
import { StreamView, type RequestGroup } from "./components/workspace/stream-view";
import { TraceView } from "./components/workspace/trace-view";
import { TaskCollectionsView } from "./components/workspace/task-collections-view";
import { SuspensionsView } from "./components/workspace/suspensions-view";
import { ActionBar } from "./components/workspace/action-bar";
import { LiveSwitch } from "./components/workspace/live-switch";
import { SessionContextPanel } from "./components/detail/session-context";
import { TokenUsageSummary } from "./components/detail/token-usage-summary";
import { ItemDetail } from "./components/detail/item-detail";
import { FlowStateMark } from "./components/shared/flow-state-mark";

import { useActiveSession } from "./hooks/use-active-session";
import { useRequestStream } from "./hooks/use-request-stream";
import { useActionDispatch } from "./hooks/use-action-dispatch";
import { useSessionRequests } from "./hooks/use-session-requests";
import { useReplay } from "./hooks/use-replay";
import { useLiveMode } from "./hooks/use-live-mode";
import { useFocusRevalidate } from "./hooks/use-focus-revalidate";

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
  baseUrl = "",
  autoRecoverInterrupted = false,
  userIdControl = "internal",
  className,
}: DevToolPanelProps) {
  const initialConfig = useMemo(() => ({ userId }), [userId]);

  return (
    <DevToolProvider
      initialConfig={initialConfig}
      baseUrl={baseUrl}
      autoRecoverInterrupted={autoRecoverInterrupted}
      userIdControl={userIdControl}
    >
      <DebugProvider>
        <SelectionProvider>
          <PanelContent className={className} />
        </SelectionProvider>
      </DebugProvider>
    </DevToolProvider>
  );
}

function PanelContent({ className }: { className?: string }) {
  const { config, flows, activeFlowKind, activeSessionId, recoveryClient, setActiveSession } = useDevTool();
  const [navExpanded, setNavExpanded] = useState(true);
  const [navWidth, setNavWidth] = useState(NAV_EXPANDED_WIDTH);
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH);

  const activeFlow = flows.find((f) => f.kind === activeFlowKind);
  const { activeSessionId: stickySession } = useActiveSession(activeFlowKind);

  const effectiveSessionId = activeSessionId ?? stickySession;

  useEffect(() => {
    if (stickySession && !activeSessionId) {
      setActiveSession(stickySession);
    }
  }, [stickySession, activeSessionId, setActiveSession]);

  const { requests, refresh: refreshRequests } = useSessionRequests(effectiveSessionId);
  const { sendAction, isSending, lastResponse } = useActionDispatch();

  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  // Tracks the request id the user dispatched from the action bar while it's
  // still in flight. Distinct from `activeRequestId` so we can tell whether
  // the open SSE stream belongs to the user (locks the Live toggle) or was
  // auto-subscribed by live mode (toggle stays interactive).
  const [dispatchedRequestId, setDispatchedRequestId] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<Map<string, OutputItem[]>>(new Map());

  const { replayState, isReplaying, replayFull, replayFromCursor, simulateReconnect, clearReplay } = useReplay();

  // Reset transient state when switching sessions.
  useEffect(() => {
    setActiveRequestId(null);
    clearReplay();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSessionId]);

  const streamRequestId = replayState.requestId ?? activeRequestId;
  const handleSessionMetadataChanged = useCallback(() => {
    setSessionRefreshKey((k) => k + 1);
    setStateRefreshKey((k) => k + 1);
  }, []);

  const { streamState, streamStatus, items: streamItems } = useRequestStream({
    flowKind: activeFlowKind,
    requestId: streamRequestId,
    startingAfter: replayState.startingAfter,
    lastEventId: replayState.lastEventId,
    enabled: !!streamRequestId,
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
    setStateRefreshKey((k) => k + 1);
  }, [refreshRequests]);

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

  const { liveMode, lockedOn, liveSubscriptionRequestId, liveStatus, latestRequest, showToggle, toggleLiveMode } =
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
  const lastStateMutationCountRef = useRef(0);
  useEffect(() => {
    let count = 0;
    for (const item of streamItems) {
      if (item.type === "state_change" || item.type === "resource_change") count++;
    }
    if (count !== lastStateMutationCountRef.current) {
      lastStateMutationCountRef.current = count;
      if (count > 0) setStateRefreshKey((k) => k + 1);
    }
  }, [streamItems]);

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
  }, [streamRequestId, streamItems, effectiveSessionId]);

  const requestGroups: RequestGroup[] = useMemo(() => {
    const groups: RequestGroup[] = [];
    for (const req of requests) {
      groups.push({
        requestId: req.id,
        action: req.actionName,
        status: req.status,
        startedAt: req.startedAtMs ?? req.createdAt,
        duration: req.completedAtMs && req.startedAtMs ? req.completedAtMs - req.startedAtMs : undefined,
        items: liveItems.get(req.id) ?? req.items ?? [],
        source: req.source,
        metadata: req.metadata,
      });
    }
    if (activeRequestId && !requests.find((r) => r.id === activeRequestId)) {
      groups.push({
        requestId: activeRequestId,
        action: lastResponse?.request.actionName ?? "action",
        status: streamState?.status === "created" ? "in_progress" : (streamState?.status ?? "in_progress"),
        startedAt: Date.now(),
        items: liveItems.get(activeRequestId) ?? [],
      });
    }
    return groups;
  }, [requests, liveItems, activeRequestId, lastResponse, streamState]);

  const handleSendAction = useCallback(
    async (action: string, input: unknown) => {
      if (!activeFlowKind || !effectiveSessionId) return;
      const response = await sendAction(activeFlowKind, effectiveSessionId, action, input);
      if (response?.request.id) {
        setActiveRequestId(response.request.id);
        setDispatchedRequestId(response.request.id);
      }
    },
    [activeFlowKind, effectiveSessionId, sendAction],
  );

  // After a suspension is resolved, re-attach the live stream to the continued
  // (same-id) request so its progress to terminal renders without a manual
  // refresh (FIX-811). Mirrors a dispatch: subscribe + lock live ON; the
  // terminal-status effect above clears `dispatchedRequestId` and refreshes the
  // request list when the continuation settles.
  const handleResumed = useCallback(
    (requestId: string) => {
      setActiveRequestId(requestId);
      setDispatchedRequestId(requestId);
      void refreshRequests();
    },
    [refreshRequests],
  );

  // The Resume button is only meaningful for the *current* tail of the
  // session — `latestRequest` comes from `useLiveMode` so the same scan
  // drives both the Live badge state and this gate.
  const canResume = latestRequest?.status === "interrupted" && !dispatchedRequestId;
  const [isResuming, setIsResuming] = useState(false);

  const handleResume = useCallback(async () => {
    if (!latestRequest || !effectiveSessionId) return;
    setIsResuming(true);
    try {
      const result = await recoveryClient.retry({
        flowKind: latestRequest.flowKind,
        sessionId: effectiveSessionId,
        requestId: latestRequest.id,
      });
      // Treat the retry like a user-dispatched request: lock Live ON and
      // subscribe to the new stream id.
      setActiveRequestId(result.newRequestId);
      setDispatchedRequestId(result.newRequestId);
      void refreshRequests();
    } catch (err) {
      console.error("[devtool] resume failed", err);
    } finally {
      setIsResuming(false);
    }
  }, [latestRequest, effectiveSessionId, recoveryClient, refreshRequests]);

  const handleReplayFull = useCallback(
    (requestId: string) => {
      setLiveItems((prev) => { const next = new Map(prev); next.delete(requestId); return next; });
      replayFull(requestId);
    },
    [replayFull],
  );

  const handleReplayFromCursor = useCallback(
    (requestId: string) => {
      const items = liveItems.get(requestId) ?? [];
      replayFromCursor(requestId, items.length);
    },
    [replayFromCursor, liveItems],
  );

  const handleReconnect = useCallback(
    (requestId: string) => {
      const items = liveItems.get(requestId) ?? [];
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
              <div className="px-2 py-1">
                <span className="text-[10px] font-medium uppercase text-slate-500">Flows</span>
              </div>
              <div className="flex-1 overflow-auto px-1">
                <FlowList
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

        {/* Main workspace */}
        <main className="flex min-w-0 min-h-0 flex-1 flex-col bg-slate-950">
          <Tabs defaultValue="stream" className="flex flex-1 flex-col min-h-0">
            <div className="flex select-none items-center justify-between gap-3 px-3 pt-2">
              <TabsList>
                <TabsTrigger value="stream">Stream</TabsTrigger>
                <TabsTrigger value="trace">Trace</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
                <TabsTrigger value="suspensions">Suspensions</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-3 min-w-0">
                <SessionIdBadge sessionId={effectiveSessionId} />
                {canResume && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={handleResume}
                    disabled={isResuming}
                    title="Resume interrupted request"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {isResuming ? "Resuming…" : "Resume"}
                  </Button>
                )}
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
                key={effectiveSessionId ?? "none"}
                requestGroups={requestGroups}
                streamStatus={streamStatus}
                isReplaying={isReplaying}
                onReplayFull={handleReplayFull}
                onReplayFromCursor={handleReplayFromCursor}
                onReconnect={handleReconnect}
              />
            </TabsContent>

            <TabsContent value="trace" className="flex-1 min-h-0 m-0">
              <TraceView key={effectiveSessionId ?? "none"} requestGroups={requestGroups} />
            </TabsContent>

            <TabsContent value="tasks" className="flex-1 min-h-0 m-0 overflow-auto">
              <TaskCollectionsView
                key={effectiveSessionId ?? "none"}
                items={requestGroups.flatMap((g) => g.items)}
              />
            </TabsContent>

            <TabsContent value="suspensions" className="flex-1 min-h-0 m-0">
              <SuspensionsView
                key={effectiveSessionId ?? "none"}
                sessionId={effectiveSessionId}
                onResumed={handleResumed}
              />
            </TabsContent>

            <Separator />

            <div className="p-2">
              <ActionBar
                flowKind={activeFlowKind}
                sessionId={effectiveSessionId}
                availableActions={activeFlow?.actions ?? []}
                actionSchemas={activeFlow?.actionSchemas}
                onSendAction={handleSendAction}
                isSending={isSending}
              />
            </div>
          </Tabs>
        </main>

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
