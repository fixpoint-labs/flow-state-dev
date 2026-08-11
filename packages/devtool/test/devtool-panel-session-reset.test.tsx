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

/** The Workstream axis's own re-read, so the panel's use of it is observable. */
const refreshWorkstreams = vi.fn();

vi.mock("../src/react/hooks/use-workstreams", () => ({
  useWorkstreams: () => ({
    workstreams: [],
    isLoading: false,
    error: null,
    truncated: false,
    refresh: refreshWorkstreams,
  }),
}));

/** The dispatch the panel awaits, held open so a session change can race it. */
const sendAction = vi.fn();

vi.mock("../src/react/hooks/use-action-dispatch", () => ({
  useActionDispatch: () => ({ sendAction, isSending: false, lastResponse: null }),
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

// Same idea for the action bar: `handleSendAction` awaits the dispatch, so it
// is the panel's one callback that can resume across a session change.
vi.mock("../src/react/components/workspace/action-bar", () => ({
  ActionBar: ({
    onSendAction,
  }: {
    onSendAction: (action: string, input: unknown) => void;
  }) => <button onClick={() => onSendAction("run", {})}>send-stub</button>,
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
    sendAction.mockReset().mockResolvedValue(null);
    refreshWorkstreams.mockReset();
  });

  it("re-reads the Workstream axis when an action starts work", async () => {
    // The tab exists to show background work appearing. Without this the count
    // and the per-task links stay as they were until the user clicks Refresh or
    // leaves and refocuses the window — on the one surface whose whole job is
    // noticing that work started.
    //
    // Asserted at the START of the call, per the interaction-scoped contract in
    // `docs/architecture/server-and-client.md`: the read is anchored to having
    // dispatched, so a slow, failing or aborted action cannot skip it.
    let resolveDispatch!: (value: unknown) => void;
    sendAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDispatch = resolve;
      })
    );

    await act(async () => render(<DevToolPanel userId="u1" />));
    refreshWorkstreams.mockClear(); // ignore the mount read

    await act(async () => {
      fireEvent.click(screen.getByText("send-stub"));
    });

    expect(refreshWorkstreams).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDispatch(null);
      await Promise.resolve();
    });
  });

  it("discards a dispatch that resolves after the user moved to another session", async () => {
    // `handleSendAction` awaits the dispatch, so it can resume on the other side
    // of a session change — the same shape as the spinner the identity effect
    // now retires, and newly reachable because this PR is what lets you click
    // from a session into a Workstream mid-flight.
    //
    // Reinstalling the id here points the live stream at a request belonging to
    // the session the user just left, and renders its items under the new one.
    let resolveDispatch!: (value: unknown) => void;
    sendAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDispatch = resolve;
      })
    );

    const { rerender } = await act(async () => render(<DevToolPanel userId="u1" />));

    await act(async () => {
      fireEvent.click(screen.getByText("send-stub"));
    });
    // Nothing installed yet — the dispatch has not come back.
    expect(latestDispatchedId()).toBeNull();

    // The user descends into a Workstream while it is still in flight.
    devToolState.activeSessionId = "sess_child";
    activeSession.activeSessionId = "sess_child";
    await act(async () => {
      rerender(<DevToolPanel userId="u1" />);
    });

    await act(async () => {
      resolveDispatch({ request: { id: "req_old_session" } });
      await Promise.resolve();
    });

    expect(latestDispatchedId()).toBeNull();
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
