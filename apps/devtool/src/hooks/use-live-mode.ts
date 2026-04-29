/**
 * Live mode coordinator: decides whether the devtool should be actively
 * watching an in-progress request, and which one.
 *
 * Two sources of "live":
 *   - The user dispatched an action from devtools (`dispatchedRequestId` set).
 *     Streaming is implicit — we auto-subscribe via SSE in App.tsx. While
 *     this is happening, the Live toggle is locked ON and uninteractable.
 *   - Live mode is on and there's an in-progress request the user did NOT
 *     dispatch (e.g. fired by the host app). We pick the most recent one
 *     and ask the caller to subscribe. If the SSE stream errors out
 *     (`streamStatus === "disconnected"`), we fall back to polling the
 *     session requests list every 2s.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRequestSummary } from "@flow-state-dev/client";
import type { StreamStatus } from "./use-request-stream";

export type UseLiveModeOptions = {
  requests: SessionRequestSummary[];
  streamStatus: StreamStatus;
  /** Request id that the user dispatched from the action bar, while still in flight. */
  dispatchedRequestId: string | null;
  /** Refresh callback used while polling fallback is active. */
  refreshRequests: () => Promise<void> | void;
};

/**
 * What the system is actually doing right now — distinct from the user's
 * preference. `streaming` and `polling` mean live data is flowing in;
 * `complete`/`failed` reflect the latest request's terminal state when
 * nothing is in progress; `idle` means live mode is on but there's nothing
 * to watch; `off` means the user toggled it off.
 */
export type LiveStatus = "streaming" | "polling" | "complete" | "failed" | "idle" | "off";

export type UseLiveModeResult = {
  /** User-controlled live preference. Defaults to ON. */
  liveMode: boolean;
  /** True while a user-dispatched stream is in flight — toggle should be locked ON. */
  lockedOn: boolean;
  /** Request id the caller should subscribe to via SSE, or null. */
  liveSubscriptionRequestId: string | null;
  /** True when SSE failed and we're polling instead. */
  pollingFallback: boolean;
  /** Derived view of what the system is actually doing. */
  liveStatus: LiveStatus;
  /**
   * Most recent request on this session by start time, regardless of status.
   * Computed once and reused for both `liveStatus` derivation and any UI that
   * needs to gate on the tail (e.g. a Resume button when status is `interrupted`).
   * `null` when the session has no requests yet.
   */
  latestRequest: SessionRequestSummary | null;
  /**
   * True when the UI should expose the toggle: there's an active request the
   * user could choose to watch (or stop watching) — but we're not already
   * streaming it via SSE. When SSE is live there's nothing to toggle; when
   * nothing's in progress there's nothing to toggle either.
   */
  showToggle: boolean;
  toggleLiveMode: (next?: boolean) => void;
};

const POLL_INTERVAL_MS = 2000;

function isInProgress(status: SessionRequestSummary["status"]): boolean {
  return status === "in_progress";
}

function timestamp(req: SessionRequestSummary): number {
  return req.startedAtMs ?? req.createdAt ?? 0;
}

function findLatestInProgress(
  requests: SessionRequestSummary[],
): SessionRequestSummary | undefined {
  let latest: SessionRequestSummary | undefined;
  for (const req of requests) {
    if (!isInProgress(req.status)) continue;
    if (!latest || timestamp(req) > timestamp(latest)) {
      latest = req;
    }
  }
  return latest;
}

function findLatestRequest(
  requests: SessionRequestSummary[],
): SessionRequestSummary | undefined {
  let latest: SessionRequestSummary | undefined;
  for (const req of requests) {
    if (!latest || timestamp(req) > timestamp(latest)) {
      latest = req;
    }
  }
  return latest;
}

export function useLiveMode(options: UseLiveModeOptions): UseLiveModeResult {
  const { requests, streamStatus, dispatchedRequestId, refreshRequests } = options;
  const [liveMode, setLiveMode] = useState(true);
  const [pollingFallback, setPollingFallback] = useState(false);

  const lockedOn =
    dispatchedRequestId !== null &&
    (streamStatus === "streaming" || streamStatus === "connecting");

  // Pick the most recent in-progress request that isn't already covered by a
  // user-dispatched stream.
  let liveSubscriptionRequestId: string | null = null;
  if (liveMode && !dispatchedRequestId) {
    const inProgress = findLatestInProgress(requests);
    if (inProgress) {
      liveSubscriptionRequestId = inProgress.id;
    }
  }

  // Keep latest refresh callback in a ref so the polling effect doesn't
  // re-create its interval every render.
  const refreshRef = useRef(refreshRequests);
  useEffect(() => {
    refreshRef.current = refreshRequests;
  }, [refreshRequests]);

  // Decide whether SSE failed and we need to poll.
  useEffect(() => {
    if (!liveMode || !liveSubscriptionRequestId) {
      setPollingFallback(false);
      return;
    }
    if (streamStatus === "streaming" || streamStatus === "connecting") {
      setPollingFallback(false);
    } else if (streamStatus === "disconnected" || streamStatus === "failed") {
      setPollingFallback(true);
    }
  }, [streamStatus, liveMode, liveSubscriptionRequestId]);

  // Run the polling interval while the fallback is active.
  useEffect(() => {
    if (!pollingFallback) return;
    if (!liveSubscriptionRequestId) return;
    const id = window.setInterval(() => {
      void refreshRef.current?.();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [pollingFallback, liveSubscriptionRequestId]);

  const toggleLiveMode = useCallback((next?: boolean) => {
    setLiveMode((prev) => (typeof next === "boolean" ? next : !prev));
  }, []);

  // Compute once and share with both `deriveLiveStatus` and the returned
  // `latestRequest` so callers don't re-iterate `requests` to find the tail.
  const latestRequest = findLatestRequest(requests) ?? null;

  const liveStatus = deriveLiveStatus({
    liveMode,
    lockedOn,
    streamStatus,
    pollingFallback,
    latestRequest,
  });

  const hasInProgress = requests.some((req) => isInProgress(req.status));
  const showToggle = hasInProgress && liveStatus !== "streaming";

  return {
    liveMode,
    lockedOn,
    liveSubscriptionRequestId,
    pollingFallback,
    liveStatus,
    latestRequest,
    showToggle,
    toggleLiveMode,
  };
}

function deriveLiveStatus(input: {
  liveMode: boolean;
  lockedOn: boolean;
  streamStatus: StreamStatus;
  pollingFallback: boolean;
  latestRequest: SessionRequestSummary | null;
}): LiveStatus {
  const { liveMode, lockedOn, streamStatus, pollingFallback, latestRequest } = input;

  if (lockedOn) return "streaming";
  if (!liveMode) return "off";

  if (streamStatus === "streaming" || streamStatus === "connecting") return "streaming";
  if (pollingFallback) return "polling";

  // No active stream: reflect terminal state of the latest request, if any,
  // so the badge says something truthful instead of "Live" on stale data.
  if (!latestRequest) return "idle";
  if (latestRequest.status === "completed" || latestRequest.status === "incomplete") return "complete";
  if (latestRequest.status === "failed" || latestRequest.status === "interrupted" || latestRequest.status === "aborted") {
    return "failed";
  }
  return "idle";
}
