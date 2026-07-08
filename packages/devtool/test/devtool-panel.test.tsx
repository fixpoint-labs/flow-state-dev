/**
 * DevToolPanel — legacy Resume button decision (FIX-865).
 *
 * The panel used to expose a single top-level "Resume" button gated on
 * `latestRequest.status === "interrupted"`, calling the JSON
 * `recoveryClient.continue()` and relying on the shared GET-stream reconnect
 * to show progress. That's now redundant with (and a strictly narrower case
 * of) the per-row Continue action on `RequestSeparator` — which works for
 * any interrupted row (not just the latest), is source-gated, and streams
 * inline via `continueStream()`. Rather than keep two affordances for the
 * same action on two different code paths, the top-level button was removed
 * outright; this test locks that decision in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

const requestsState = {
  requests: [] as Array<Record<string, unknown>>,
  refresh: vi.fn(),
};

// Avoid the real client factories (which would hit the network via
// `refreshFlows`/`checkInterrupted`) — the panel's flows/config plumbing
// isn't what this test exercises.
const devToolState = {
  config: { userId: "u1" },
  client: { listFlows: vi.fn().mockResolvedValue([]) },
  sessionClient: {},
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

vi.mock("../src/react/context/devtool-context", () => ({
  DevToolProvider: ({ children }: { children: React.ReactNode }) => children,
  useDevTool: () => devToolState,
}));

vi.mock("../src/react/hooks/use-session-requests", () => ({
  useSessionRequests: () => requestsState,
}));

vi.mock("../src/react/hooks/use-action-dispatch", () => ({
  useActionDispatch: () => ({ sendAction: vi.fn(), isSending: false, lastResponse: null }),
}));

vi.mock("../src/react/hooks/use-request-stream", () => ({
  useRequestStream: () => ({
    streamState: null,
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
  useLiveMode: () => ({
    liveMode: true,
    lockedOn: false,
    liveSubscriptionRequestId: null,
    pollingFallback: false,
    liveStatus: "idle",
    latestRequest: null,
    showToggle: false,
    toggleLiveMode: vi.fn(),
  }),
}));

vi.mock("../src/react/hooks/use-focus-revalidate", () => ({
  useFocusRevalidate: () => {},
}));

vi.mock("../src/react/hooks/use-active-session", () => ({
  useActiveSession: () => ({ activeSessionId: "sess_1" }),
}));

vi.mock("../src/react/hooks/use-continue-request", () => ({
  useContinueRequest: () => ({ continueRequest: vi.fn(), isContinuing: () => false }),
}));

import { DevToolPanel } from "../src/react/DevToolPanel";

describe("DevToolPanel — legacy Resume button removed", () => {
  beforeEach(() => {
    requestsState.requests = [
      {
        id: "req_1",
        flowKind: "demo",
        actionName: "run",
        userId: "u1",
        status: "interrupted",
        source: "http",
        startedAtMs: 1,
        createdAt: 1,
        updatedAt: 1,
        items: [],
      },
    ];
    requestsState.refresh = vi.fn();
  });

  it("does not render a top-level Resume button even when the latest request is interrupted", async () => {
    await act(async () => {
      render(<DevToolPanel userId="u1" />);
    });

    expect(screen.queryByText("Resume")).not.toBeInTheDocument();
    expect(screen.queryByText("Resuming…")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Resume interrupted request")).not.toBeInTheDocument();
  });

  it("still renders the per-row Continue action for the interrupted request instead", async () => {
    await act(async () => {
      render(<DevToolPanel userId="u1" />);
    });

    expect(screen.getByTitle("More actions")).toBeInTheDocument();
  });
});
