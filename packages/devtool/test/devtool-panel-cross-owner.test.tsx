/**
 * DevToolPanel — following background work into the instance that owns it, and
 * getting back.
 *
 * Work dispatched into another flow instance produces a child that instance
 * owns, and a same-kind peer is the case that hides: the child looks like an
 * ordinary session of the flow already on screen. Opening it under the parent's
 * copy addresses every subsequent read to the wrong one.
 *
 * So a descent moves BOTH axes in one transition, and each step of the trail
 * remembers the owner it was under, because returning has to undo both.
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

/** The child rows the panel hands to the ChildSessions tab. */
const childRows: Array<Record<string, unknown>> = [];

vi.mock("../src/react/context/devtool-context", () => ({
  DevToolProvider: ({ children }: { children: React.ReactNode }) => children,
  useDevTool: () => devToolState,
}));

vi.mock("../src/react/hooks/use-session-requests", () => ({
  useSessionRequests: () => ({ requests: [], refresh: vi.fn() }),
}));

vi.mock("../src/react/hooks/use-child-sessions", () => ({
  useChildSessions: () => ({
    childSessions: childRows,
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
  useContinueRequest: () => ({ continueRequest: vi.fn(), isContinuing: () => false }),
}));

/** Stand-in for the ChildSessions tab, exposing its open link as a button. */
vi.mock("../src/react/components/workspace/child-sessions-view", () => ({
  ChildSessionsView: ({
    childSessions,
    onOpen,
  }: {
    childSessions: Array<{ id: string }>;
    onOpen: (child: unknown) => void;
  }) => (
    <div>
      {childSessions.map((child) => (
        <button key={child.id} onClick={() => onOpen(child)}>
          open-{child.id}
        </button>
      ))}
    </div>
  ),
}));

import { DevToolPanel } from "../src/react/DevToolPanel";

async function openChildTab() {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name: /ChildSessions/ }));
  });
}

describe("DevToolPanel — cross-owner descent and return", () => {
  beforeEach(() => {
    selectWorkspace.mockReset();
    childRows.length = 0;
    devToolState.activeFlowId = "engineer-a";
    devToolState.activeFlow = engineerA;
    devToolState.activeSessionId = "sess_parent";
    devToolState.workspaceToken = 0;
  });

  it("opens a child under the instance that owns it, not the one on screen", async () => {
    childRows.push({
      id: "child_1",
      parentSessionId: "sess_parent",
      flowId: "engineer-b",
      topic: "review",
      createdAt: 1,
      updatedAt: 1,
    });

    await act(async () => render(<DevToolPanel userId="u1" />));
    await openChildTab();

    await act(async () => {
      fireEvent.click(screen.getByText("open-child_1"));
    });

    // Both axes, in one call. Two updates would leave a render with the child
    // open under `engineer-a`, and that render's reads go to the wrong copy.
    expect(selectWorkspace).toHaveBeenCalledWith("engineer-b", "child_1");
  });

  it("keeps a child with no recorded owner in the instance it was opened from", async () => {
    // Written before owners existed. The only instance that could have started
    // it under the old same-flow rule is the one we are already in.
    childRows.push({
      id: "child_legacy",
      parentSessionId: "sess_parent",
      topic: "legacy",
      createdAt: 1,
      updatedAt: 1,
    });

    await act(async () => render(<DevToolPanel userId="u1" />));
    await openChildTab();

    await act(async () => {
      fireEvent.click(screen.getByText("open-child_legacy"));
    });

    expect(selectWorkspace).toHaveBeenCalledWith("engineer-a", "child_legacy");
  });

  it("returns to the parent's own instance, not whichever copy is selected", async () => {
    childRows.push({
      id: "child_1",
      parentSessionId: "sess_parent",
      flowId: "engineer-b",
      topic: "review",
      createdAt: 1,
      updatedAt: 1,
    });

    const { rerender } = await act(async () => render(<DevToolPanel userId="u1" />));
    await openChildTab();
    await act(async () => {
      fireEvent.click(screen.getByText("open-child_1"));
    });

    // The provider applies the descent: the workspace is now B's child.
    applyWorkspace("engineer-b", "child_1");
    await act(async () => rerender(<DevToolPanel userId="u1" />));

    selectWorkspace.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTitle(/^Back to sess_parent/));
    });

    // The trail carried the parent's owner. Without it, "back" would return the
    // right session under `engineer-b`, which is where we currently are.
    expect(selectWorkspace).toHaveBeenCalledWith("engineer-a", "sess_parent");
  });
});
