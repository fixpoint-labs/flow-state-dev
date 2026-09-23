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
 * The hook here is the exception: the panel's own request list, which lives
 * ABOVE that boundary and survives the switch. Nothing unmounts it, so a read
 * fence is the only thing standing between a response for the copy just left
 * and the copy now on screen.
 *
 * The rail's session list used to be the second exception and is no longer in
 * this package — it is `useLeafSessions` inside `FlowNavigator`, fenced on the
 * same primitive, and both of its hazards are pinned by
 * `packages/react/test/flow-navigator-read-fence.test.ts`. What the rail does
 * on a CREDENTIAL change, where this tool rebuilds its clients and the list
 * must not sit there showing the previous operator's sessions, is pinned by
 * `flow-rail.test.tsx` — that one is an integration property of this host, not
 * of the component.
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
