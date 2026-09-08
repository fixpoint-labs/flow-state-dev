/**
 * What a workspace transition retires among the readers that STAY MOUNTED
 * across it.
 *
 * There are two retirement mechanisms in the panel and they cover different
 * readers. Most session-scoped hooks render below `SelectionProvider
 * key={workspaceKey}`, so a transition unmounts them outright and a late
 * response has nowhere to land — that boundary is pinned by
 * `devtool-panel-owned-subtree.test.tsx`, and those hooks deliberately carry no
 * fence of their own.
 *
 * The hooks here are the exceptions: the navigator's session list, and the
 * panel's own request list, both of which live ABOVE that boundary and survive
 * the switch. Nothing unmounts them, so a read fence is the only thing standing
 * between a response for the copy just left and the copy now on screen.
 *
 * Each case holds a read open, moves the workspace, then lets it land.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const sessionClient = {
  listSessions: vi.fn(),
  listSessionRequests: vi.fn(),
};
const recoveryClient = { checkInterrupted: vi.fn() };

const devToolState = {
  sessionClient,
  recoveryClient,
  config: { userId: "devuser" },
  autoRecoverInterrupted: false,
  workspaceToken: 0,
};

vi.mock("../src/react/context/devtool-context", () => ({
  useDevTool: () => devToolState,
}));

import { useSessions } from "../src/react/hooks/use-sessions";
import { useSessionRequests } from "../src/react/hooks/use-session-requests";

/** A promise a test resolves by hand, so a read can be held across a switch. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("workspace retirement, for the readers that outlive the switch", () => {
  beforeEach(() => {
    devToolState.workspaceToken = 0;
    devToolState.sessionClient = sessionClient;
    devToolState.config = { userId: "devuser" };
    sessionClient.listSessions.mockReset().mockResolvedValue([]);
    sessionClient.listSessionRequests.mockReset().mockResolvedValue([]);
    recoveryClient.checkInterrupted.mockReset().mockResolvedValue(undefined);
  });

  describe("the session list", () => {
    it("does not put one copy's sessions under its peer", async () => {
      const held = deferred<unknown>();
      sessionClient.listSessions.mockReturnValueOnce(held.promise);
      sessionClient.listSessions.mockReturnValue(new Promise(() => {}));

      const { result, rerender } = renderHook(
        ({ id }: { id: string }) =>
          useSessions({ id, cardinality: "collection" as const }),
        { initialProps: { id: "engineer-a" } },
      );
      await waitFor(() => expect(sessionClient.listSessions).toHaveBeenCalled());

      rerender({ id: "engineer-b" });

      await act(async () => {
        held.resolve([{ id: "sess-a", flowId: "engineer-a" }]);
        await Promise.resolve();
      });

      // Two navigator rows of one kind is exactly where a late list lands in
      // the wrong place — the rows look alike, and only the id says otherwise.
      // This hook is in the navigator, which does not remount on a switch.
      expect(result.current.sessions).toEqual([]);
    });

    it("lists a singleton by kind, so sessions from before owners were recorded still show", async () => {
      renderHook(() => useSessions({ id: "reports", cardinality: "singleton" as const }));

      await waitFor(() => {
        expect(sessionClient.listSessions).toHaveBeenCalledWith({
          flowKind: "reports",
          userId: "devuser",
        });
      });
    });

    it("lists a collection member by its exact owner", async () => {
      renderHook(() =>
        useSessions({ id: "engineer-b", cardinality: "collection" as const }),
      );

      await waitFor(() => {
        expect(sessionClient.listSessions).toHaveBeenCalledWith({
          flowId: "engineer-b",
          userId: "devuser",
        });
      });
    });

    it("re-lists when the operator identity changes", async () => {
      // Sessions are per user as well as per instance, so the list on screen
      // belongs to whoever was signed in when it was read. The client is
      // rebuilt on a credential change, and the read identity carries both it
      // and the user id — so the list refetches rather than sitting there
      // showing the previous operator's sessions.
      const { rerender } = renderHook(() =>
        useSessions({ id: "reports", cardinality: "singleton" as const }),
      );
      await waitFor(() => expect(sessionClient.listSessions).toHaveBeenCalledTimes(1));

      devToolState.config = { userId: "someone-else" };
      devToolState.sessionClient = { ...sessionClient };
      rerender();

      await waitFor(() => {
        expect(sessionClient.listSessions).toHaveBeenCalledWith({
          flowKind: "reports",
          userId: "someone-else",
        });
      });
    });
  });

  describe("the request list", () => {
    it("drops rows that land after the workspace moved", async () => {
      // Live mode picks its subscription target out of these rows, so a stale
      // `in_progress` row does not just look wrong — it opens a stream on a
      // request in the workspace the operator just left.
      const held = deferred<unknown>();
      sessionClient.listSessionRequests.mockReturnValueOnce(held.promise);
      sessionClient.listSessionRequests.mockReturnValue(new Promise(() => {}));

      const { result, rerender } = renderHook(() => useSessionRequests("sess_1"));
      await waitFor(() =>
        expect(sessionClient.listSessionRequests).toHaveBeenCalled(),
      );

      devToolState.workspaceToken = 1;
      rerender();

      await act(async () => {
        held.resolve([{ id: "req_1", status: "in_progress" }]);
        await Promise.resolve();
      });

      expect(result.current.requests).toEqual([]);
    });

    it("shows nothing from the retired visit while the new one is still reading", async () => {
      sessionClient.listSessionRequests.mockResolvedValue([
        { id: "req_1", status: "completed" },
      ]);

      const { result, rerender } = renderHook(() => useSessionRequests("sess_1"));
      await waitFor(() => expect(result.current.requests.length).toBe(1));

      // Derived during RENDER. An effect-only reset would leave a frame in
      // which the previous visit's rows are what live mode reads.
      sessionClient.listSessionRequests.mockReturnValue(new Promise(() => {}));
      devToolState.workspaceToken = 1;
      rerender();

      expect(result.current.requests).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });
  });
});
