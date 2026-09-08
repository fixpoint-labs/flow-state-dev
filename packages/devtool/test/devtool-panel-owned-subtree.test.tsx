/**
 * The workspace-keyed subtree is what retires the readers inside it.
 *
 * `use-session-state`, the three debug-resource hooks and `use-list-suspensions`
 * carry no read fence of their own. They do not need one: they render below
 * `<SelectionProvider key={workspaceKey}>`, so a workspace transition UNMOUNTS
 * them and a response from the copy just left writes to a component that is
 * gone. That is a real retirement mechanism — but it is one line, and a line
 * that looks removable.
 *
 * So this pins it. Deleting the key, or hoisting `SelectionProvider` back above
 * `PanelContent`, makes these fail rather than silently returning five hooks to
 * committing the previous instance's data under the newly selected one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

const demoInstance = {
  id: "engineer-a",
  kind: "engineer",
  cardinality: "collection" as const,
  requireUser: false,
  actions: [],
  actionSchemas: {},
};

const devToolState = {
  config: { userId: "u1" },
  client: { listFlows: vi.fn().mockResolvedValue([]) },
  sessionClient: { listSessions: vi.fn().mockResolvedValue([]) },
  recoveryClient: { checkInterrupted: vi.fn().mockResolvedValue([]), continueStream: vi.fn() },
  activeFlowId: "engineer-a",
  activeFlow: demoInstance,
  activeSessionId: "sess_1",
  workspaceToken: 0,
  flows: [demoInstance],
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
  selectWorkspace: vi.fn(),
};

vi.mock("../src/react/context/devtool-context", () => ({
  DevToolProvider: ({ children }: { children: React.ReactNode }) => children,
  useDevTool: () => devToolState,
}));

vi.mock("../src/react/hooks/use-session-requests", () => ({
  useSessionRequests: () => ({ requests: [], refresh: vi.fn() }),
}));
vi.mock("../src/react/hooks/use-child-sessions", () => ({
  useChildSessions: () => ({
    childSessions: [],
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

/**
 * Stands in for the detail sidebar, which is where the unfenced readers live.
 * Counts its own mounts and renders the session it was mounted for, so a test
 * can tell "remounted for the new workspace" from "still the old instance".
 */
const detailMounts: string[] = [];

vi.mock("../src/react/components/detail/session-context", () => ({
  SessionContextPanel: ({ sessionId }: { sessionId: string | null }) => {
    React.useEffect(() => {
      detailMounts.push(sessionId ?? "none");
    }, []);
    return <div data-testid="detail">{sessionId ?? "none"}</div>;
  },
}));

import { DevToolPanel } from "../src/react/DevToolPanel";

describe("the workspace-keyed subtree retires what it contains", () => {
  beforeEach(() => {
    detailMounts.length = 0;
    devToolState.activeFlowId = "engineer-a";
    devToolState.activeFlow = demoInstance;
    devToolState.activeSessionId = "sess_1";
    devToolState.workspaceToken = 0;
  });

  it("remounts the detail readers when the selected instance changes", async () => {
    const { rerender } = await act(async () => render(<DevToolPanel userId="u1" />));
    expect(detailMounts).toEqual(["sess_1"]);

    // The provider moves instance, session and visit together.
    devToolState.activeFlowId = "engineer-b";
    devToolState.activeFlow = { ...demoInstance, id: "engineer-b" };
    devToolState.activeSessionId = "sess_2";
    devToolState.workspaceToken = 1;
    await act(async () => rerender(<DevToolPanel userId="u1" />));

    // A FRESH mount, not an update. Without it the hooks inside keep running
    // and a late response from `engineer-a` commits under `engineer-b`.
    expect(detailMounts).toEqual(["sess_1", "sess_2"]);
  });

  it("remounts them on a credential change that leaves the ids alone", async () => {
    const { rerender } = await act(async () => render(<DevToolPanel userId="u1" />));
    expect(detailMounts).toEqual(["sess_1"]);

    // Same instance, same session, new client — the reads in flight belong to
    // the previous credentials and must not land.
    devToolState.workspaceToken = 1;
    await act(async () => rerender(<DevToolPanel userId="u1" />));

    expect(detailMounts).toEqual(["sess_1", "sess_1"]);
  });

  it("does not remount them when nothing about the workspace moved", async () => {
    const { rerender } = await act(async () => render(<DevToolPanel userId="u1" />));
    await act(async () => rerender(<DevToolPanel userId="u1" />));

    // A key that changed on every render would throw away in-flight reads and
    // the operator's open detail selection continuously.
    expect(detailMounts).toEqual(["sess_1"]);
    expect(screen.getByTestId("detail").textContent).toBe("sess_1");
  });
});
