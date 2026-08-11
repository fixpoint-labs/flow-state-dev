/**
 * DevToolPanel — what a session switch has to forget (FIX-1071).
 *
 * `dispatchedRequestId` names the request the USER started from the DevTool. It
 * is what locks the Live toggle, and `useLiveMode` only auto-subscribes to an
 * external in-progress request while it is null.
 *
 * Its ordinary release is the terminal-status effect — the dispatched stream
 * reaching `completed` or `failed`. A session switch never produces either:
 * clearing `activeRequestId` disables the stream, so the status goes to `idle`
 * and the effect never fires. Left set, it names a request in the session the
 * user just LEFT, and live mode then silently declines to follow anything
 * running in the session they just opened — with the toggle still showing live.
 *
 * Descending into a Workstream from a conversation the user started work in is
 * the reliable way to hit it, which is why it is pinned here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import React from "react";

const requestsState = {
  requests: [] as Array<Record<string, unknown>>,
  refresh: vi.fn(),
};

const devToolState = {
  config: { userId: "u1" },
  client: { listFlows: vi.fn().mockResolvedValue([]) },
  sessionClient: { listWorkstreams: vi.fn().mockResolvedValue([]) },
  recoveryClient: { checkInterrupted: vi.fn().mockResolvedValue([]), continueStream: vi.fn() },
  activeFlowKind: "demo",
  activeSessionId: "sess_1",
  flows: [{ kind: "demo", actions: [], actionSchemas: {} }],
  flowsLoading: false,
  flowsError: null,
  baseUrl: undefined,
  userIdControl: "internal" as const,
  autoRecoverInterrupted: false,
  dispatch: vi.fn(),
  refreshFlows: vi.fn(),
  setConfig: vi.fn(),
  setActiveFlow: vi.fn(),
  setActiveSession: vi.fn(),
};

/** The session the panel is looking at, swapped between renders. */
const activeSession = { activeSessionId: "sess_1" };

/** Every `useLiveMode` options object the panel has handed over, newest last. */
const liveModeCalls: Array<{ dispatchedRequestId: string | null }> = [];

vi.mock("../src/react/context/devtool-context", () => ({
  DevToolProvider: ({ children }: { children: React.ReactNode }) => children,
  useDevTool: () => devToolState,
}));

vi.mock("../src/react/hooks/use-session-requests", () => ({
  useSessionRequests: () => requestsState,
}));

vi.mock("../src/react/hooks/use-workstreams", () => ({
  useWorkstreams: () => ({
    workstreams: [],
    isLoading: false,
    error: null,
    truncated: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../src/react/hooks/use-action-dispatch", () => ({
  useActionDispatch: () => ({ sendAction: vi.fn(), isSending: false, lastResponse: null }),
}));

vi.mock("../src/react/hooks/use-request-stream", () => ({
  useRequestStream: () => ({
    streamState: null,
    // The whole point: a detached stream is `idle`, never `completed`, so the
    // terminal-status release never runs on a session switch.
    streamStatus: "idle",
    items: [],
    error: null,
    lastSequenceNumber: 0,
  }),
}));

vi.mock("../src/react/hooks/use-replay", () => ({
  useReplay: () => ({
    replayState: { mode: null, requestId: null },
    isReplaying: false,
    replayFull: vi.fn(),
    replayFromCursor: vi.fn(),
    simulateReconnect: vi.fn(),
    clearReplay: vi.fn(),
  }),
}));

vi.mock("../src/react/hooks/use-live-mode", () => ({
  useLiveMode: (options: { dispatchedRequestId: string | null }) => {
    liveModeCalls.push({ dispatchedRequestId: options.dispatchedRequestId });
    return {
      liveMode: true,
      lockedOn: false,
      liveSubscriptionRequestId: null,
      pollingFallback: false,
      liveStatus: "idle",
      latestRequest: null,
      showToggle: false,
      toggleLiveMode: vi.fn(),
    };
  },
}));

vi.mock("../src/react/hooks/use-focus-revalidate", () => ({
  useFocusRevalidate: () => {},
}));

vi.mock("../src/react/hooks/use-active-session", () => ({
  useActiveSession: () => activeSession,
}));

vi.mock("../src/react/hooks/use-continue-request", () => ({
  useContinueRequest: () => ({ continueRequest: vi.fn(), isContinuing: () => false }),
}));

// Stand-in for the Suspensions panel, exposing the panel's own `onResumed`
// callback as a button. That callback is one of the two places the panel takes
// ownership of a request id, and the only one reachable without driving the
// action form.
vi.mock("../src/react/components/workspace/suspensions-view", () => ({
  SuspensionsView: ({ onResumed }: { onResumed: (id: string) => void }) => (
    <button onClick={() => onResumed("req_dispatched")}>resume-stub</button>
  ),
}));

import { DevToolPanel } from "../src/react/DevToolPanel";

/** What the panel most recently told `useLiveMode`. */
function latestDispatchedId(): string | null {
  return liveModeCalls[liveModeCalls.length - 1]?.dispatchedRequestId ?? null;
}

describe("DevToolPanel — session switch releases the dispatched request", () => {
  beforeEach(() => {
    requestsState.requests = [];
    requestsState.refresh = vi.fn();
    liveModeCalls.length = 0;
    activeSession.activeSessionId = "sess_1";
    devToolState.activeSessionId = "sess_1";
  });

  it("clears dispatchedRequestId when the session changes, so live mode can follow the new one", async () => {
    const { rerender } = await act(async () => render(<DevToolPanel userId="u1" />));

    // `TabsContent` has no `forceMount`, so the stub only exists once its tab
    // is the active one. Radix activates a trigger on mousedown/focus, not on
    // a synthetic click.
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Suspensions" }));
    });

    // The user starts work in this session — live mode is now locked to it.
    await act(async () => {
      fireEvent.click(screen.getByText("resume-stub"));
    });
    expect(latestDispatchedId()).toBe("req_dispatched");

    // Descend into a Workstream (or pick another session from the navigator).
    // `effectiveSessionId` is `activeSessionId ?? stickySession`, so the
    // context's id is the one that moves.
    devToolState.activeSessionId = "sess_child";
    activeSession.activeSessionId = "sess_child";
    await act(async () => {
      rerender(<DevToolPanel userId="u1" />);
    });

    // Still set, this would name a request in the session just left, and
    // `useLiveMode` would refuse to auto-subscribe to anything in the new one.
    expect(latestDispatchedId()).toBeNull();
  });
});
