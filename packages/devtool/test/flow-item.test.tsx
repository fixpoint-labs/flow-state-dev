import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FlowListEntry } from "@flow-state-dev/client";

// FlowItem pulls selection + session-list state from hooks/context. Mock those
// so the test can isolate the Sessions ⟳ fan-out wiring (FIX-730): the button
// must refresh the session list AND the open session.
const { refreshSpy, createSessionSpy, setActiveSessionSpy, setActiveSessionIdSpy } = vi.hoisted(() => ({
  refreshSpy: vi.fn(),
  createSessionSpy: vi.fn(),
  setActiveSessionSpy: vi.fn(),
  setActiveSessionIdSpy: vi.fn(),
}));

vi.mock("../src/react/context/devtool-context", () => ({
  useDevTool: () => ({ setActiveSession: setActiveSessionSpy }),
}));
vi.mock("../src/react/hooks/use-sessions", () => ({
  useSessions: () => ({
    sessions: [],
    isLoading: false,
    refresh: refreshSpy,
    createSession: createSessionSpy,
  }),
}));
vi.mock("../src/react/hooks/use-active-session", () => ({
  useActiveSession: () => ({ activeSessionId: null, setActiveSessionId: setActiveSessionIdSpy }),
}));

import { FlowItem } from "../src/react/components/navigator/flow-item";

const flow: FlowListEntry = { id: "demo", kind: "demo", requireUser: false, actions: [] };

describe("FlowItem — Sessions ⟳ fan-out (FIX-730)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the session list AND the open session when ⟳ is clicked", () => {
    const onRefreshActiveSession = vi.fn();
    render(
      <FlowItem flow={flow} isActive onSelect={() => {}} onRefreshActiveSession={onRefreshActiveSession} />,
    );
    fireEvent.click(screen.getByTitle("Refresh sessions"));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(onRefreshActiveSession).toHaveBeenCalledTimes(1);
  });

  it("still refreshes the list when no open-session callback is provided", () => {
    render(<FlowItem flow={flow} isActive onSelect={() => {}} />);
    fireEvent.click(screen.getByTitle("Refresh sessions"));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
