import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const sessionClientMock = {
  listSessions: vi.fn(),
  createSession: vi.fn(),
};
const recoveryClientMock = {
  checkInterrupted: vi.fn(),
};
const devToolState = {
  sessionClient: sessionClientMock,
  recoveryClient: recoveryClientMock,
  config: { userId: "devuser" },
};

vi.mock("@/context/devtool-context", () => ({
  useDevTool: () => devToolState,
}));

import { useSessions } from "@/hooks/use-sessions";

describe("useSessions", () => {
  beforeEach(() => {
    sessionClientMock.listSessions.mockReset().mockResolvedValue([]);
    sessionClientMock.createSession.mockReset();
    recoveryClientMock.checkInterrupted.mockReset().mockResolvedValue(undefined);
    devToolState.config = { userId: "devuser" };
  });

  it("passes the configured userId to listSessions on initial fetch", async () => {
    renderHook(() => useSessions("demo"));

    await waitFor(() => {
      expect(sessionClientMock.listSessions).toHaveBeenCalledWith({
        flowKind: "demo",
        userId: "devuser",
      });
    });
  });

  it("re-fetches with the new userId when the config changes", async () => {
    const { rerender } = renderHook(() => useSessions("demo"));

    await waitFor(() => {
      expect(sessionClientMock.listSessions).toHaveBeenCalledWith({
        flowKind: "demo",
        userId: "devuser",
      });
    });

    devToolState.config = { userId: "devuser2" };
    rerender();

    await waitFor(() => {
      expect(sessionClientMock.listSessions).toHaveBeenLastCalledWith({
        flowKind: "demo",
        userId: "devuser2",
      });
    });
  });

  it("does not call listSessions when no flowKind is selected", async () => {
    renderHook(() => useSessions(null));

    // Allow effects to flush.
    await Promise.resolve();
    expect(sessionClientMock.listSessions).not.toHaveBeenCalled();
  });
});
