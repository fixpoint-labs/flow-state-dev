/**
 * What a workspace transition retires on readers that stay mounted.
 *
 * The navigator session list is not under the workspace remount — two same-kind
 * rows stay on screen while the operator moves between them — so a late list
 * can still land in the wrong row. The detail readers (session state, resources,
 * collections, suspensions) remount with `workspaceKey`; those cases used to
 * live here as a second fence and do not.
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
