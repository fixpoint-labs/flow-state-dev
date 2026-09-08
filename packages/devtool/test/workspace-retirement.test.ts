/**
 * What a workspace transition retires, on the readers that used to commit an
 * awaited result with no owner check at all.
 *
 * Five hooks — session state, the debug resource tree, resource content,
 * collection pages, suspensions — read for the open session and wrote whatever
 * came back. A switch between two copies of one flow is where that shows: the
 * session id and the request shapes look alike, so the previous copy's state,
 * resources and pending approvals simply stayed on screen under the new one.
 *
 * Each case here holds a read open, moves the workspace, then lets the read
 * land. Two things must be true afterwards: the late result is not written, and
 * nothing from the retired visit is readable in the meantime — not rows, not an
 * error, not a spinner claiming the new workspace is still loading its own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const sessionClient = {
  getSessionState: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  debug: {
    listSuspensions: vi.fn(),
    listResources: vi.fn(),
  },
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

import { useSessionState } from "../src/react/hooks/use-session-state";
import { useListSuspensions } from "../src/react/hooks/use-list-suspensions";
import { useDebugResources } from "../src/react/hooks/use-debug-resources";
import { useSessions } from "../src/react/hooks/use-sessions";

/** A promise a test resolves by hand, so a read can be held across a switch. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Move the workspace the way the provider does. The token is the part that
 * matters: instance and session ids can come back to what they were, so a
 * comparison of values alone would let a retired read agree with them again.
 */
function moveWorkspace(): void {
  devToolState.workspaceToken += 1;
}

describe("workspace retirement", () => {
  beforeEach(() => {
    devToolState.workspaceToken = 0;
    devToolState.sessionClient = sessionClient;
    devToolState.config = { userId: "devuser" };
    sessionClient.getSessionState.mockReset();
    sessionClient.getSession.mockReset();
    sessionClient.listSessions.mockReset().mockResolvedValue([]);
    sessionClient.debug.listSuspensions.mockReset();
    sessionClient.debug.listResources.mockReset();
    recoveryClient.checkInterrupted.mockReset().mockResolvedValue(undefined);
  });

  describe("session state", () => {
    it("drops a snapshot that lands after the workspace moved", async () => {
      const held = deferred<unknown>();
      sessionClient.getSessionState.mockReturnValueOnce(held.promise);
      sessionClient.getSession.mockResolvedValue({ id: "sess_1" });
      // The second visit's own read never settles, so anything readable after
      // the switch can only have come from the first.
      sessionClient.getSessionState.mockReturnValue(new Promise(() => {}));

      const { result, rerender } = renderHook(() => useSessionState("sess_1"));
      await waitFor(() => expect(sessionClient.getSessionState).toHaveBeenCalled());

      moveWorkspace();
      rerender();

      await act(async () => {
        held.resolve({ clientData: { session: { marker: "instance-a" } } });
        await Promise.resolve();
      });

      expect(result.current.snapshot).toBeNull();
    });

    it("shows nothing from the retired visit while the new one is still reading", async () => {
      sessionClient.getSessionState.mockResolvedValue({
        clientData: { session: { marker: "instance-a" } },
      });
      sessionClient.getSession.mockResolvedValue({ id: "sess_1" });

      const { result, rerender } = renderHook(() => useSessionState("sess_1"));
      await waitFor(() => expect(result.current.snapshot).not.toBeNull());

      // The mask is derived during RENDER. An effect-only reset leaves a frame
      // in which the sidebar reads the previous copy's state under the new one.
      sessionClient.getSessionState.mockReturnValue(new Promise(() => {}));
      moveWorkspace();
      rerender();

      expect(result.current.snapshot).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });

    it("drops a failure that lands after the workspace moved", async () => {
      const held = deferred<unknown>();
      sessionClient.getSessionState.mockReturnValueOnce(held.promise);
      sessionClient.getSession.mockResolvedValue({ id: "sess_1" });
      sessionClient.getSessionState.mockReturnValue(new Promise(() => {}));

      const { result, rerender } = renderHook(() => useSessionState("sess_1"));
      await waitFor(() => expect(sessionClient.getSessionState).toHaveBeenCalled());

      moveWorkspace();
      rerender();

      await act(async () => {
        held.reject(new Error("state read failed"));
        await Promise.resolve();
      });

      // A banner naming a read the operator can no longer see is as wrong as
      // stale rows, and it would sit over a workspace that is fine.
      expect(result.current.error).toBeNull();
    });
  });

  describe("suspensions", () => {
    it("drops rows that land after the workspace moved", async () => {
      const held = deferred<unknown>();
      sessionClient.debug.listSuspensions.mockReturnValueOnce(held.promise);
      sessionClient.debug.listSuspensions.mockReturnValue(new Promise(() => {}));

      const { result, rerender } = renderHook(() => useListSuspensions("sess_1"));
      await waitFor(() => expect(sessionClient.debug.listSuspensions).toHaveBeenCalled());

      moveWorkspace();
      rerender();

      await act(async () => {
        held.resolve({
          suspensions: [{ suspensionId: "susp_1", status: "pending" }],
        });
        await Promise.resolve();
      });

      // A pending suspension is not display — it carries approve and reject.
      // Offering one under the wrong copy offers to resolve a gate in a run the
      // operator is not looking at.
      expect(result.current.suspensions).toEqual([]);
    });
  });

  describe("debug resources", () => {
    it("drops a tree that lands after the workspace moved", async () => {
      const held = deferred<unknown>();
      sessionClient.debug.listResources.mockReturnValueOnce(held.promise);
      sessionClient.debug.listResources.mockReturnValue(new Promise(() => {}));

      const { result, rerender } = renderHook(() => useDebugResources("sess_1"));
      await waitFor(() => expect(sessionClient.debug.listResources).toHaveBeenCalled());

      moveWorkspace();
      rerender();

      await act(async () => {
        held.resolve({ resources: [{ ref: "notes", kind: "single" }] });
        await Promise.resolve();
      });

      expect(result.current.data).toBeNull();
    });
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
  });
});
