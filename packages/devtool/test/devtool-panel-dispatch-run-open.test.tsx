/**
 * DevToolPanel — opening a dispatch run under the instance that owns it.
 *
 * Work dispatched into another flow instance produces a run that instance owns,
 * and a same-kind peer is the case that hides: the run looks like an ordinary
 * session of the flow already on screen. Opening it under the sending copy
 * addresses every subsequent read to the wrong one.
 *
 * So opening a run moves BOTH axes in one transition. There is no trail back:
 * a run is an ordinary session of its flow and is listed as one, so the way
 * back is the rail, not a breadcrumb.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import React from "react";

const engineerA = {
  id: "engineer-a",
  kind: "engineer",
  cardinality: "collection" as const,
  requireUser: false,
  actions: [],
  actionSchemas: {},
};

const selectWorkspace = vi.fn();

const devToolState = {
  config: { userId: "u1" },
  client: { listFlows: vi.fn().mockResolvedValue([]) },
  sessionClient: { listSessions: vi.fn().mockResolvedValue([]) },
  recoveryClient: { checkInterrupted: vi.fn().mockResolvedValue([]), continueStream: vi.fn() },
  activeFlowId: "engineer-a",
  activeFlow: engineerA,
  activeSessionId: "sess_parent",
  workspaceToken: 0,
  flows: [engineerA],
  flowsLoading: false,
  flowsError: null,
  baseUrl: undefined,
  userIdControl: "internal" as const,
  autoRecoverInterrupted: false,
  dispatch: vi.fn(),
  refreshFlows: vi.fn(),
  setConfig: vi.fn(),
  selectInstance: vi.fn(),
  selectSession: vi.fn(),
  selectWorkspace,
};

/** Apply a selection the way the provider would, so the panel sees it land. */
function applyWorkspace(flowId: string, sessionId: string): void {
  devToolState.activeFlowId = flowId;
  devToolState.activeFlow = { ...engineerA, id: flowId };
  devToolState.activeSessionId = sessionId;
  devToolState.workspaceToken += 1;
}

/** The dispatch runs the panel renders as nodes in the block tree. */
const runRows: Array<Record<string, unknown>> = [];

vi.mock("../src/react/context/devtool-context", () => ({
  DevToolProvider: ({ children }: { children: React.ReactNode }) => children,
  useDevTool: () => devToolState,
}));

vi.mock("../src/react/hooks/use-session-requests", () => ({
  useSessionRequests: () => ({ requests: [], refresh: vi.fn() }),
}));

vi.mock("../src/react/hooks/use-dispatch-runs", () => ({
  useDispatchRuns: () => ({
    dispatchRuns: runRows,
    isLoading: false,
    error: null,
    truncation: "complete" as const,
    refresh: vi.fn(),
  }),
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

vi.mock("../src/react/hooks/use-continue-request", () => ({
  useContinueRequest: () => ({
    // Resolves, because the panel chains `.catch` onto it.
    continueRequest: vi.fn().mockResolvedValue(undefined),
    isContinuing: () => false,
  }),
}));

import { DevToolPanel } from "../src/react/DevToolPanel";

/** The runs render as nodes in the block tree, which is the Trace tab. */
async function openTraceTab() {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Trace/ }));
  });
}

describe("DevToolPanel — opening a dispatch run", () => {
  beforeEach(() => {
    selectWorkspace.mockReset();
    runRows.length = 0;
    devToolState.activeFlowId = "engineer-a";
    devToolState.activeFlow = engineerA;
    devToolState.activeSessionId = "sess_parent";
    devToolState.workspaceToken = 0;
  });

  it("opens a run under the instance that owns it, not the one on screen", async () => {
    runRows.push({
      id: "dsx_1",
      parentSessionId: "sess_parent",
      flowId: "engineer-b",
      topic: "review",
      createdAt: 1,
      updatedAt: 1,
    });

    await act(async () => render(<DevToolPanel userId="u1" />));
    await openTraceTab();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open dispatch run dsx_1"));
    });

    // Both axes, in one call. Two updates would leave a render with the run
    // open under `engineer-a`, and that render's reads go to the wrong copy.
    expect(selectWorkspace).toHaveBeenCalledWith("engineer-b", "dsx_1");
  });

  it("keeps a run with no recorded owner in the instance it was opened from", async () => {
    // Written before owners existed. The only instance that could have started
    // it under the old same-flow rule is the one we are already in.
    runRows.push({
      id: "dsx_legacy",
      parentSessionId: "sess_parent",
      topic: "legacy",
      createdAt: 1,
      updatedAt: 1,
    });

    await act(async () => render(<DevToolPanel userId="u1" />));
    await openTraceTab();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open dispatch run dsx_legacy"));
    });

    expect(selectWorkspace).toHaveBeenCalledWith("engineer-a", "dsx_legacy");
  });

});
