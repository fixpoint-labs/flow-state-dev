/**
 * Tests for the request-row refresh sweep gating (FIX-865). Mirrors
 * `use-sessions.test.ts`'s mocking style. Unlike the session-list sweep
 * (unconditional there — FIX-467), the request-row refresh sweep must stay
 * OFF unless the host explicitly opted in via `autoRecoverInterrupted` —
 * merely opening/refreshing a session must not mutate a stale `in_progress`
 * row to `interrupted` as a side effect of a panel that just wants to display
 * it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const sessionClientMock = {
  listSessionRequests: vi.fn(),
};
const recoveryClientMock = {
  checkInterrupted: vi.fn(),
};
const devToolState = {
  sessionClient: sessionClientMock,
  recoveryClient: recoveryClientMock,
  config: { userId: "devuser" },
  autoRecoverInterrupted: false,
};

vi.mock("../src/react/context/devtool-context", () => ({
  useDevTool: () => devToolState,
}));

import { useSessionRequests } from "../src/react/hooks/use-session-requests";

describe("useSessionRequests — interrupted-sweep gating", () => {
  beforeEach(() => {
    sessionClientMock.listSessionRequests.mockReset().mockResolvedValue([]);
    recoveryClientMock.checkInterrupted.mockReset().mockResolvedValue(undefined);
    devToolState.config = { userId: "devuser" };
    devToolState.autoRecoverInterrupted = false;
  });

  it("does not sweep interrupted requests when autoRecoverInterrupted is false", async () => {
    renderHook(() => useSessionRequests("sess_1"));

    await waitFor(() => {
      expect(sessionClientMock.listSessionRequests).toHaveBeenCalled();
    });
    expect(recoveryClientMock.checkInterrupted).not.toHaveBeenCalled();
  });

  it("sweeps interrupted requests before listing when autoRecoverInterrupted is true", async () => {
    devToolState.autoRecoverInterrupted = true;
    renderHook(() => useSessionRequests("sess_1"));

    await waitFor(() => {
      expect(recoveryClientMock.checkInterrupted).toHaveBeenCalledWith({ userId: "devuser" });
    });
    expect(sessionClientMock.listSessionRequests).toHaveBeenCalledWith("sess_1", { includeItems: true });
  });

  it("does not sweep when there is no session, regardless of the flag", async () => {
    devToolState.autoRecoverInterrupted = true;
    renderHook(() => useSessionRequests(null));

    await Promise.resolve();
    expect(recoveryClientMock.checkInterrupted).not.toHaveBeenCalled();
    expect(sessionClientMock.listSessionRequests).not.toHaveBeenCalled();
  });
});
