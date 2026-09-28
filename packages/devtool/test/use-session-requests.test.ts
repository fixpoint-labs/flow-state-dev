/**
 * Tests for the request-row refresh sweep gating (FIX-865). The request-row
 * refresh sweep must stay OFF unless the host explicitly opted in via
 * `autoRecoverInterrupted` — merely opening/refreshing a session must not
 * mutate a stale `in_progress` row to `interrupted` as a side effect of a
 * panel that just wants to display it.
 *
 * This used to be stated as a contrast with the session-list sweep, which was
 * unconditional (FIX-467). There is no longer a session-list sweep to contrast
 * with: the rail's list moved into `FlowNavigator` and `checkInterrupted` did
 * not go with it, deliberately — a sweep on every leaf expand is a second
 * round trip a rail should not pay for. The accepted cost is that a request
 * abandoned by a dead process reads `in_progress` in the rail until the
 * mount-time sweep or something else clears it. So the gate below is now the
 * only sweep gate in the panel, not the stricter of two.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

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
    // Restored here rather than at the end of the one test that swaps it, so a
    // failing assertion cannot leak the replacement client into its neighbours.
    devToolState.sessionClient = sessionClientMock;
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

/**
 * Switching sessions (FIX-1071).
 *
 * These rows are not only rendered — live mode picks its SSE subscription
 * target out of them. Carrying the previous session's rows across a switch
 * therefore makes the panel attach to a request in the session the user just
 * left, and render that request's items under the newly opened one. Descending
 * into a ChildSession while the conversation that started it is still running is
 * the reliable way to hit it.
 */
describe("useSessionRequests — switching sessions", () => {
  beforeEach(() => {
    sessionClientMock.listSessionRequests.mockReset().mockResolvedValue([]);
    recoveryClientMock.checkInterrupted.mockReset().mockResolvedValue(undefined);
    devToolState.config = { userId: "devuser" };
    devToolState.autoRecoverInterrupted = false;
    // Restored here rather than at the end of the one test that swaps it, so a
    // failing assertion cannot leak the replacement client into its neighbours.
    devToolState.sessionClient = sessionClientMock;
  });

  it("drops the previous session's rows before the new session's read lands", async () => {
    const parentRow = { id: "req_parent", status: "in_progress" };
    sessionClientMock.listSessionRequests.mockResolvedValueOnce([parentRow]);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionRequests(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() => expect(result.current.requests).toEqual([parentRow]));

    // A read that never resolves stands in for the window between the switch
    // and the new session's response — the whole window the leak lived in.
    sessionClientMock.listSessionRequests.mockReturnValueOnce(new Promise(() => {}));
    rerender({ sessionId: "sess_child" });

    expect(result.current.requests).toEqual([]);
  });

  it("drops the previous backend's rows when the client is rebuilt under the same session", async () => {
    // `DevToolProvider` rebuilds `sessionClient` when `baseUrl` or the bearer
    // token changes. The session id can stay exactly the same across that, so a
    // reset keyed on the session id alone never runs and the previous backend's
    // rows stay on screen — rows live mode will pick an in-progress request out
    // of and try to stream through the new client.
    const parentRow = { id: "req_old_backend", status: "in_progress" };
    sessionClientMock.listSessionRequests.mockResolvedValue([parentRow]);

    const { result, rerender } = renderHook(() => useSessionRequests("sess_1"));
    await waitFor(() => expect(result.current.requests).toEqual([parentRow]));

    // Same session, different backend. The replacement read is held open so the
    // window between the swap and its response is the whole of the assertion.
    const replacementClient = {
      listSessionRequests: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    devToolState.sessionClient = replacementClient as never;
    rerender();

    expect(result.current.requests).toEqual([]);
  });

  it("returns no rows for a session whose read has not landed, during the render itself", async () => {
    // The gap a reset effect leaves. `requests` is what live mode picks its
    // subscription target out of, and it does so DURING render — so the
    // previous session's `in_progress` row being returned for even one render
    // is enough for the old session's stream to open under the new workspace.
    //
    // Observed per-render rather than from `result.current`, which only ever
    // shows the state after effects have flushed and so cannot see this.
    const parentRow = { id: "req_parent", status: "in_progress" };
    sessionClientMock.listSessionRequests.mockResolvedValue([parentRow]);

    const seen: Array<{ sessionId: string; ids: string[] }> = [];
    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => {
        const view = useSessionRequests(sessionId);
        seen.push({ sessionId, ids: view.requests.map((r) => r.id) });
        return view;
      },
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() =>
      expect(seen.some((s) => s.ids.includes("req_parent"))).toBe(true)
    );

    // The replacement read never lands, so every render below is inside the
    // window this is about.
    sessionClientMock.listSessionRequests.mockReturnValue(new Promise(() => {}));
    seen.length = 0;
    rerender({ sessionId: "sess_child" });

    const leaked = seen.filter(
      (s) => s.sessionId === "sess_child" && s.ids.includes("req_parent")
    );
    expect(leaked).toEqual([]);
  });

  it("refuses a refresh invoked from a closure made for a previous session", async () => {
    // The panel hands `refresh` to children (`handleResumed` calls it). An
    // operator changes sessions while a suspension approval is outstanding, the
    // unmounted view invokes the callback it captured, and that callback names
    // the OLD session.
    //
    // Worse than the same bug in `use-child-sessions`: there a stale closure
    // BORROWED the current identity, here it REDEFINES it — `requestedRef` is
    // assigned inside `refresh`, so a stale call rewrites the shared cell and
    // corrupts the guard for every read, not just its own.
    sessionClientMock.listSessionRequests.mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionRequests(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() =>
      expect(sessionClientMock.listSessionRequests).toHaveBeenCalledWith(
        "sess_parent",
        { includeItems: true }
      )
    );

    const staleRefresh = result.current.refresh;

    sessionClientMock.listSessionRequests.mockResolvedValue([
      { id: "req_child", status: "completed" },
    ]);
    rerender({ sessionId: "sess_child" });
    await waitFor(() =>
      expect(result.current.requests).toEqual([{ id: "req_child", status: "completed" }])
    );

    const callsBefore = sessionClientMock.listSessionRequests.mock.calls.length;
    sessionClientMock.listSessionRequests.mockResolvedValue([
      { id: "req_parent_stale", status: "in_progress" },
    ]);
    await act(async () => {
      await staleRefresh();
    });

    expect(result.current.requests).toEqual([{ id: "req_child", status: "completed" }]);
    // A read it may not write is a read worth not making.
    expect(sessionClientMock.listSessionRequests.mock.calls.length).toBe(callsBefore);
  });

  it("does not let a stale callback discard the current session's in-flight read", async () => {
    // The corruption half. Assigning the shared ref from a stale call makes a
    // legitimate read for the session ON SCREEN fail its own guard on arrival,
    // so live mode is left with no rows at all rather than the wrong ones.
    let resolveChild!: (rows: unknown[]) => void;
    sessionClientMock.listSessionRequests.mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionRequests(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() =>
      expect(sessionClientMock.listSessionRequests).toHaveBeenCalled()
    );
    const staleRefresh = result.current.refresh;

    sessionClientMock.listSessionRequests.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveChild = resolve as (rows: unknown[]) => void;
      })
    );
    rerender({ sessionId: "sess_child" });
    await waitFor(() => expect(resolveChild).toBeDefined());

    sessionClientMock.listSessionRequests.mockResolvedValue([
      { id: "req_parent_stale", status: "in_progress" },
    ]);
    await act(async () => {
      await staleRefresh();
    });

    await act(async () => {
      resolveChild([{ id: "req_child", status: "completed" }]);
      await Promise.resolve();
    });

    expect(result.current.requests).toEqual([{ id: "req_child", status: "completed" }]);
  });

  it("ignores a read that resolves after the session moved on", async () => {
    let resolveParent!: (rows: unknown[]) => void;
    sessionClientMock.listSessionRequests.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveParent = resolve as (rows: unknown[]) => void;
      })
    );

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionRequests(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );

    sessionClientMock.listSessionRequests.mockResolvedValueOnce([]);
    rerender({ sessionId: "sess_child" });

    // The parent's read comes back late. Applying it would put the previous
    // session's in-progress request back in front of live mode.
    resolveParent([{ id: "req_parent", status: "in_progress" }]);
    await waitFor(() =>
      expect(sessionClientMock.listSessionRequests).toHaveBeenCalledTimes(2)
    );

    expect(result.current.requests).toEqual([]);
  });
});

/**
 * One read at a time (FIX-1629).
 *
 * Several callers refresh this list on their own schedules: the Tasks tab's
 * row poll, live mode's fallback poll, the stream's end, focus, the manual
 * button. Every read begins a fence that retires the one before it, so two
 * callers whose slow reads overlap would discard each other's answers, and on
 * a slow connection no snapshot would ever land. A refresh while a read is in
 * flight joins it, and asks for exactly one read after it.
 */
describe("useSessionRequests — single-flight refresh", () => {
  beforeEach(() => {
    sessionClientMock.listSessionRequests.mockReset();
    recoveryClientMock.checkInterrupted.mockReset().mockResolvedValue(undefined);
    devToolState.config = { userId: "devuser" };
    devToolState.autoRecoverInterrupted = false;
    devToolState.sessionClient = sessionClientMock;
  });

  /** Queue slow reads the test resolves by hand, in order of issue. */
  function slowReads() {
    const pending: Array<(rows: unknown[]) => void> = [];
    sessionClientMock.listSessionRequests.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve as (rows: unknown[]) => void))
    );
    return pending;
  }

  it("installs a snapshot when two callers' slow reads would overlap", async () => {
    const pending = slowReads();
    const { result } = renderHook(() => useSessionRequests("sess_1"));
    await waitFor(() => expect(pending).toHaveLength(1));

    // A second caller (another poller) asks while the mount read is in flight.
    let second!: Promise<void>;
    act(() => {
      second = result.current.refresh();
    });
    expect(sessionClientMock.listSessionRequests).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]!([{ id: "req_a", status: "completed" }]);
    });
    // The first answer lands instead of being retired by the second caller.
    expect(result.current.requests).toEqual([{ id: "req_a", status: "completed" }]);

    // The second caller's own read follows, and its answer lands too.
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[1]!([{ id: "req_a", status: "completed" }, { id: "req_b", status: "completed" }]);
      await second;
    });
    expect(result.current.requests).toHaveLength(2);
  });

  it("gives any number of callers during a read one follow-up read, not one each", async () => {
    const pending = slowReads();
    const { result } = renderHook(() => useSessionRequests("sess_1"));
    await waitFor(() => expect(pending).toHaveLength(1));

    let waits: Array<Promise<void>> = [];
    act(() => {
      waits = [result.current.refresh(), result.current.refresh(), result.current.refresh()];
    });
    await act(async () => {
      pending[0]!([]);
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[1]!([{ id: "req_a", status: "completed" }]);
      await Promise.all(waits);
    });

    expect(sessionClientMock.listSessionRequests).toHaveBeenCalledTimes(2);
    expect(result.current.requests).toEqual([{ id: "req_a", status: "completed" }]);
  });
});

/**
 * A read that never settles (FIX-1629).
 *
 * The transport has no timeout, so one hung list request would otherwise hold
 * the single flight forever: every later refresh would join it, and a poller
 * awaiting its refresh would never tick again. A flight is let go after a
 * stall bound; the next refresh starts a fresh read whose fence retires the
 * hung one, so its answer is discarded if it ever arrives.
 */
describe("useSessionRequests — a stalled read", () => {
  beforeEach(() => {
    sessionClientMock.listSessionRequests.mockReset();
    recoveryClientMock.checkInterrupted.mockReset().mockResolvedValue(undefined);
    devToolState.config = { userId: "devuser" };
    devToolState.autoRecoverInterrupted = false;
    devToolState.sessionClient = sessionClientMock;
  });

  it("lets go of a read that never settles, and a later refresh reads again", async () => {
    let resolveHung!: (rows: unknown[]) => void;
    sessionClientMock.listSessionRequests.mockReturnValueOnce(
      new Promise((resolve) => (resolveHung = resolve as (rows: unknown[]) => void))
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { result } = renderHook(() => useSessionRequests("sess_1"));
      await act(async () => {});
      expect(sessionClientMock.listSessionRequests).toHaveBeenCalledTimes(1);

      // A caller that joined the hung read is released once the bound passes,
      // so a poller awaiting it ticks again.
      let joinedSettled = false;
      act(() => {
        void result.current.refresh().then(() => (joinedSettled = true));
      });
      sessionClientMock.listSessionRequests.mockResolvedValue([{ id: "req_fresh", status: "completed" }]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(joinedSettled).toBe(true);
      expect(sessionClientMock.listSessionRequests).toHaveBeenCalledTimes(2);
      expect(result.current.requests).toEqual([{ id: "req_fresh", status: "completed" }]);

      // The hung read's answer, arriving late, does not overwrite the fresh one.
      await act(async () => {
        resolveHung([{ id: "req_hung", status: "in_progress" }]);
      });
      expect(result.current.requests).toEqual([{ id: "req_fresh", status: "completed" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
