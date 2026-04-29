import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SessionRequestSummary } from "@flow-state-dev/client";
import { useLiveMode } from "@/hooks/use-live-mode";

function makeRequest(
  id: string,
  status: SessionRequestSummary["status"],
  createdAt = 0,
): SessionRequestSummary {
  return {
    id,
    flowKind: "demo",
    actionName: "send",
    userId: "u1",
    sessionId: "s1",
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("useLiveMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to live mode on, with no subscription when there are no in-progress requests", () => {
    const { result } = renderHook(() =>
      useLiveMode({
        requests: [makeRequest("r1", "completed")],
        streamStatus: "idle",
        dispatchedRequestId: null,
        refreshRequests: () => {},
      }),
    );
    expect(result.current.liveMode).toBe(true);
    expect(result.current.lockedOn).toBe(false);
    expect(result.current.liveSubscriptionRequestId).toBeNull();
  });

  it("locks ON while a user-dispatched stream is in flight", () => {
    const { result } = renderHook(() =>
      useLiveMode({
        requests: [makeRequest("r1", "in_progress")],
        streamStatus: "streaming",
        dispatchedRequestId: "r1",
        refreshRequests: () => {},
      }),
    );
    expect(result.current.lockedOn).toBe(true);
    // While locked-on, we don't expose a separate subscription target — the
    // dispatched stream is already covering it.
    expect(result.current.liveSubscriptionRequestId).toBeNull();
  });

  it("subscribes to the latest in-progress external request when no dispatched stream exists", () => {
    const requests = [
      makeRequest("r-old", "completed", 1),
      makeRequest("r-new", "in_progress", 2),
    ];
    const { result } = renderHook(() =>
      useLiveMode({
        requests,
        streamStatus: "idle",
        dispatchedRequestId: null,
        refreshRequests: () => {},
      }),
    );
    expect(result.current.liveSubscriptionRequestId).toBe("r-new");
  });

  it("picks the most recent in-progress request when multiple are in flight", () => {
    const requests = [
      makeRequest("r-a", "in_progress", 1),
      makeRequest("r-b", "completed", 2),
      makeRequest("r-c", "in_progress", 3),
    ];
    const { result } = renderHook(() =>
      useLiveMode({
        requests,
        streamStatus: "idle",
        dispatchedRequestId: null,
        refreshRequests: () => {},
      }),
    );
    expect(result.current.liveSubscriptionRequestId).toBe("r-c");
  });

  it("does not auto-subscribe when live mode is off", () => {
    const { result } = renderHook(() =>
      useLiveMode({
        requests: [makeRequest("r1", "in_progress")],
        streamStatus: "idle",
        dispatchedRequestId: null,
        refreshRequests: () => {},
      }),
    );
    act(() => result.current.toggleLiveMode(false));
    expect(result.current.liveMode).toBe(false);
    expect(result.current.liveSubscriptionRequestId).toBeNull();
  });

  it("toggleLiveMode flips state when called without args", () => {
    const { result } = renderHook(() =>
      useLiveMode({
        requests: [],
        streamStatus: "idle",
        dispatchedRequestId: null,
        refreshRequests: () => {},
      }),
    );
    expect(result.current.liveMode).toBe(true);
    act(() => result.current.toggleLiveMode());
    expect(result.current.liveMode).toBe(false);
    act(() => result.current.toggleLiveMode());
    expect(result.current.liveMode).toBe(true);
  });

  it("falls back to polling when SSE disconnects, refreshing every 2s", () => {
    const refresh = vi.fn();
    const requests = [makeRequest("r1", "in_progress")];
    const { result, rerender } = renderHook(
      ({ streamStatus }: { streamStatus: "streaming" | "disconnected" }) =>
        useLiveMode({
          requests,
          streamStatus,
          dispatchedRequestId: null,
          refreshRequests: refresh,
        }),
      { initialProps: { streamStatus: "streaming" as const } },
    );

    expect(result.current.pollingFallback).toBe(false);

    rerender({ streamStatus: "disconnected" });
    expect(result.current.pollingFallback).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("stops polling once the in-progress request finishes", () => {
    const refresh = vi.fn();
    const { result, rerender } = renderHook(
      ({ requests }: { requests: SessionRequestSummary[] }) =>
        useLiveMode({
          requests,
          streamStatus: "disconnected",
          dispatchedRequestId: null,
          refreshRequests: refresh,
        }),
      { initialProps: { requests: [makeRequest("r1", "in_progress")] } },
    );

    expect(result.current.pollingFallback).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ requests: [makeRequest("r1", "completed")] });
    expect(result.current.pollingFallback).toBe(false);
    expect(result.current.liveSubscriptionRequestId).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears polling fallback when SSE reconnects", () => {
    const requests = [makeRequest("r1", "in_progress")];
    const { result, rerender } = renderHook(
      ({ streamStatus }: { streamStatus: "disconnected" | "streaming" }) =>
        useLiveMode({
          requests,
          streamStatus,
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      { initialProps: { streamStatus: "disconnected" as const } },
    );
    expect(result.current.pollingFallback).toBe(true);

    rerender({ streamStatus: "streaming" });
    expect(result.current.pollingFallback).toBe(false);
  });

  describe("liveStatus", () => {
    it("reports 'streaming' while a user-dispatched stream is in flight", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "streaming",
          dispatchedRequestId: "r1",
          refreshRequests: () => {},
        }),
      );
      expect(result.current.liveStatus).toBe("streaming");
    });

    it("reports 'streaming' while auto-watching an external in-progress request", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "streaming",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.liveStatus).toBe("streaming");
    });

    it("reports 'polling' when SSE has fallen back", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "disconnected",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.liveStatus).toBe("polling");
    });

    it("reports 'complete' when latest request finished and nothing is in progress", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [
            makeRequest("r-old", "completed", 1),
            makeRequest("r-new", "completed", 2),
          ],
          streamStatus: "idle",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.liveStatus).toBe("complete");
    });

    it("reports 'failed' when latest request failed and nothing is in progress", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "failed", 1)],
          streamStatus: "idle",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.liveStatus).toBe("failed");
    });

    it("reports 'idle' when there are no requests at all", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [],
          streamStatus: "idle",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.liveStatus).toBe("idle");
    });

    it("reports 'off' when the user toggles live mode off", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "idle",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      act(() => result.current.toggleLiveMode(false));
      expect(result.current.liveStatus).toBe("off");
    });
  });

  describe("showToggle", () => {
    it("hides toggle when there is no in-progress request", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "completed")],
          streamStatus: "idle",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.showToggle).toBe(false);
    });

    it("hides toggle while SSE is actively streaming", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "streaming",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.showToggle).toBe(false);
    });

    it("hides toggle when a user-dispatched stream is locked on", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "streaming",
          dispatchedRequestId: "r1",
          refreshRequests: () => {},
        }),
      );
      expect(result.current.showToggle).toBe(false);
    });

    it("shows toggle when active and SSE has fallen back to polling", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "disconnected",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      expect(result.current.showToggle).toBe(true);
    });

    it("shows toggle when active and live mode is off", () => {
      const { result } = renderHook(() =>
        useLiveMode({
          requests: [makeRequest("r1", "in_progress")],
          streamStatus: "idle",
          dispatchedRequestId: null,
          refreshRequests: () => {},
        }),
      );
      act(() => result.current.toggleLiveMode(false));
      expect(result.current.showToggle).toBe(true);
    });
  });
});
