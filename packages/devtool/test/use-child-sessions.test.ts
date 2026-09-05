/**
 * The ChildSessions listing hook (FIX-1071).
 *
 * Two classes of defect live here, and both are invisible rather than loud —
 * the panel renders a plausible list either way, which is what makes them worth
 * pinning:
 *
 * - **A partial list that reads as complete.** The route pages, ordered by
 *   creation time, so a single unparameterized read shows the OLDEST page and
 *   silently omits the newest background work. The panel prints a count beside
 *   it, so the omission states something false.
 * - **A superseded read landing last.** Reads for the same session overlap (the
 *   mount read, the panel's Refresh, the focus revalidation), and the slower
 *   older one arriving last would overwrite newer rows — regressing a row that
 *   has since completed. A session-id guard cannot see this, because both reads
 *   name the same session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ChildSessionSummary } from "@flow-state-dev/client";

const sessionClientMock = {
  listChildSessions: vi.fn(),
};
const devToolState = { sessionClient: sessionClientMock };

vi.mock("../src/react/context/devtool-context", () => ({
  useDevTool: () => devToolState,
}));

import { useChildSessions } from "../src/react/hooks/use-child-sessions";
import { useReadFence } from "../src/react/hooks/use-read-fence";

function row(id: string, overrides: Partial<ChildSessionSummary> = {}): ChildSessionSummary {
  return {
    id,
    parentSessionId: "sess_parent",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    ...overrides,
  } as ChildSessionSummary;
}

/** A page of `count` distinct rows, numbered from `from`. */
function page(from: number, count: number): ChildSessionSummary[] {
  return Array.from({ length: count }, (_, i) => row(`dsx_${from + i}`));
}

beforeEach(() => {
  sessionClientMock.listChildSessions.mockReset().mockResolvedValue([]);
});

describe("useChildSessions — reading one page", () => {
  it("reads a single page, not the whole history", async () => {
    // `docs/architecture/server-and-client.md` fixes the budget for this axis:
    // "The cost is one ChildSession read per turn, independent of task-board
    // activity." Walking every page made the cost grow with how much background
    // work a session had — on a host configured to a one-row page size, ~500
    // sequential requests on every mount and every action refresh.
    //
    // The listing is ordered `created_at DESC`, so the one page IS the newest
    // work. A short page is the whole list and needs nothing further.
    sessionClientMock.listChildSessions.mockImplementation(
      async (_id: string, opts?: { offset?: number }) =>
        opts?.offset === undefined ? [row("dsx_1"), row("dsx_2")] : []
    );

    const { result } = renderHook(() => useChildSessions("sess_parent"));

    await waitFor(() =>
      expect(result.current.childSessions.map((w) => w.id)).toEqual(["dsx_1", "dsx_2"])
    );
    expect(result.current.truncation).toBe("complete");
    // The page plus its sentinel. Two whatever the session holds — the page
    // size belongs to the deployment, so a short page is not self-evident.
    expect(sessionClientMock.listChildSessions).toHaveBeenCalledTimes(2);
  });

  it("never sends a limit, because a host may cap it below whatever we'd pick", async () => {
    // The route REJECTS an out-of-range limit with a 400 rather than clamping,
    // and `maxChildSessionListLimit` is an operator's setting.
    sessionClientMock.listChildSessions.mockResolvedValue([]);
    renderHook(() => useChildSessions("sess_parent"));

    await waitFor(() => expect(sessionClientMock.listChildSessions).toHaveBeenCalled());
    const [, options] = sessionClientMock.listChildSessions.mock.calls[0]!;
    expect(options ?? {}).not.toHaveProperty("limit");
  });

  it("costs one request when the session has no background work", async () => {
    sessionClientMock.listChildSessions.mockResolvedValue([]);

    const { result } = renderHook(() => useChildSessions("sess_parent"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.childSessions).toEqual([]);
    expect(result.current.truncation).toBe("complete");
    expect(sessionClientMock.listChildSessions).toHaveBeenCalledTimes(1);
  });

  it("says there is more when a full page has a row behind it", async () => {
    // `truncated` has to be right in both directions, so a full page alone is
    // not evidence — it takes one sentinel read to tell "the whole list" from
    // "the first page of a longer one".
    const first = page(0, 25);
    sessionClientMock.listChildSessions.mockImplementation(
      async (_id: string, opts?: { offset?: number }) =>
        opts?.offset === undefined ? first : [row("dsx_beyond")]
    );

    const { result } = renderHook(() => useChildSessions("sess_parent"));

    await waitFor(() => expect(result.current.truncation).toBe("more"));
    expect(result.current.childSessions).toHaveLength(25);
    expect(sessionClientMock.listChildSessions).toHaveBeenCalledWith("sess_parent", {
      offset: 25,
    });
    // Two, and only two — the cost stays constant however much work exists.
    expect(sessionClientMock.listChildSessions).toHaveBeenCalledTimes(2);
  });

  it("reports an unknown index when the read itself fails", async () => {
    // The split-channel bug, stated at its source. `truncation` used to be left
    // alone by the catch, so a first load that never landed reported the list
    // as verified COMPLETE while `error` separately said it had failed. Only a
    // consumer holding both could combine them — and the Tasks tab holds one,
    // which is why it rendered a definitive "no childSession" for every task.
    // Driven through a SUCCESSFUL read first, so `truncation` genuinely holds
    // `"complete"` before the failure. A first-load failure would pass against
    // the bug, because nothing had established completeness to begin with.
    sessionClientMock.listChildSessions.mockImplementation(
      async (_id: string, opts?: { offset?: number }) =>
        opts?.offset === undefined ? [row("dsx_1")] : []
    );

    const { result } = renderHook(() => useChildSessions("sess_parent"));
    await waitFor(() => expect(result.current.truncation).toBe("complete"));

    sessionClientMock.listChildSessions.mockRejectedValue(new Error("network down"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe("network down");
    expect(result.current.truncation).toBe("unknown");
    // The rows stay, because a failed re-read does not mean the list emptied —
    // but nothing about its completeness survives.
    expect(result.current.childSessions).toHaveLength(1);
  });

  it("keeps a page whose sentinel failed, and says the check did not come back", async () => {
    // The sentinel's failure is not the page's failure. Letting it reject threw
    // away rows that had already arrived — nothing at all on a first load, or
    // stale rows on a refresh, because a follow-up probe timed out.
    //
    // The unknown is honest HERE in a way a permanent one would not be: it is
    // caused by a request failing rather than by the protocol being unable to
    // answer, and it is rare. Reporting it as `complete` would assert a
    // completeness nobody checked.
    const first = page(0, 25);
    sessionClientMock.listChildSessions.mockImplementation(
      async (_id: string, opts?: { offset?: number }) => {
        if (opts?.offset === undefined) return first;
        throw new Error("network down");
      }
    );

    const { result } = renderHook(() => useChildSessions("sess_parent"));

    await waitFor(() => expect(result.current.childSessions).toHaveLength(25));
    expect(result.current.truncation).toBe("unknown");
    // The page succeeded, so this is not a failed read.
    expect(result.current.error).toBeNull();
  });

  it("does not claim more when a full page is the whole list", async () => {
    // The other direction, and the one a full-page heuristic gets wrong:
    // exactly a page's worth of childSessions and nothing behind it.
    const first = page(0, 25);
    sessionClientMock.listChildSessions.mockImplementation(
      async (_id: string, opts?: { offset?: number }) =>
        opts?.offset === undefined ? first : []
    );

    const { result } = renderHook(() => useChildSessions("sess_parent"));

    await waitFor(() => expect(result.current.childSessions).toHaveLength(25));
    expect(result.current.truncation).toBe("complete");
  });
});

describe("useChildSessions — a superseded read stops working", () => {
  /** Every page request made, held open so the walk can be stepped one at a time. */
  type PendingRead = {
    sessionId: string;
    offset: number;
    resolve: (rows: ChildSessionSummary[]) => void;
  };

  function armSteppableReads(): PendingRead[] {
    const pending: PendingRead[] = [];
    sessionClientMock.listChildSessions.mockImplementation(
      (sessionId: string, opts?: { offset?: number }) =>
        new Promise((resolve) => {
          pending.push({
            sessionId,
            offset: opts?.offset ?? 0,
            resolve: resolve as (rows: ChildSessionSummary[]) => void,
          });
        })
    );
    return pending;
  }

  it("does not issue its sentinel read once retired", async () => {
    // The window that matters, and the only one there is now that a read is a
    // page plus a sentinel: the identity is retired while the PAGE is still in
    // flight. The fence stops the result being written either way — the point
    // here is that the second request is never made, because a read whose
    // result may not be written is a read worth not making.
    const pending = armSteppableReads();

    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChildSessions(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    // Retired while its page is outstanding.
    rerender({ sessionId: "sess_child" });
    await waitFor(() =>
      expect(pending.some((read) => read.sessionId === "sess_child")).toBe(true)
    );

    // The page lands full, which would otherwise call for a sentinel.
    await act(async () => {
      pending[0]!.resolve(page(0, 25));
    });

    expect(pending.filter((read) => read.sessionId === "sess_parent")).toHaveLength(1);
  });

  it("does not issue its sentinel read after the panel unmounts", async () => {
    // Same window, with the identity retired by teardown rather than by a
    // replacement — the case no identity change announces.
    const pending = armSteppableReads();

    const { unmount } = renderHook(() => useChildSessions("sess_parent"));
    await waitFor(() => expect(pending).toHaveLength(1));

    unmount();

    await act(async () => {
      pending[0]!.resolve(page(0, 25));
    });

    expect(pending).toHaveLength(1);
  });

  it("does not run the reset when the panel unmounts", async () => {
    // Retiring on unmount must STOP reads without clearing state. There is no
    // component left to clear, so it buys nothing — and a caller whose reset
    // ever does more than `setState` would be running it against a workspace
    // that no longer exists.
    const onRetired = vi.fn();
    sessionClientMock.listChildSessions.mockResolvedValue([]);

    const { unmount, rerender } = renderHook(
      ({ id }: { id: string }) => useReadFence([id], onRetired),
      { initialProps: { id: "a" } }
    );
    // Mount runs it once; an identity change runs it again.
    await waitFor(() => expect(onRetired).toHaveBeenCalledTimes(1));
    rerender({ id: "b" });
    await waitFor(() => expect(onRetired).toHaveBeenCalledTimes(2));

    unmount();

    expect(onRetired).toHaveBeenCalledTimes(2);
  });

  it("lands the surviving read's rows, not the abandoned one's", async () => {
    const pending = armSteppableReads();

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChildSessions(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    await act(async () => {
      pending[0]!.resolve(page(0, 25));
    });
    await waitFor(() => expect(pending).toHaveLength(2));

    rerender({ sessionId: "sess_child" });
    const child = await waitFor(() => {
      const found = pending.find((read) => read.sessionId === "sess_child");
      expect(found).toBeDefined();
      return found!;
    });

    // Abandon the parent's walk and complete the child's.
    await act(async () => {
      pending[1]!.resolve(page(25, 25));
      child.resolve([row("dsx_child")]);
    });
    const childTail = await waitFor(() => {
      const found = pending.filter((read) => read.sessionId === "sess_child")[1];
      expect(found).toBeDefined();
      return found!;
    });
    await act(async () => {
      childTail.resolve([]);
    });

    expect(result.current.childSessions.map((w) => w.id)).toEqual(["dsx_child"]);
    // An abandoned walk read fewer rows than exist. Reporting that as a cap
    // would tell the user their list is truncated when it was merely dropped.
    expect(result.current.truncation).toBe("complete");
  });
});

describe("useChildSessions — a callback outliving its identity", () => {
  /** A listing that ends after one page, so a walk terminates. */
  function onePage(rows: ChildSessionSummary[]) {
    return async (_id: string, opts?: { offset?: number }) =>
      opts?.offset === undefined ? rows : [];
  }

  it("refuses a refresh invoked from a closure made for a previous session", async () => {
    // The panel hands `refresh` to children. An operator changes sessions while
    // a suspension approval is still outstanding, and the unmounted view later
    // invokes the callback it captured — which names the OLD session.
    //
    // Reading the guard late while capturing the identity early is what let
    // that through: the closure took whatever generation was current at
    // invocation, so it always agreed with itself and wrote the previous
    // session's rows over the workspace now on screen.
    sessionClientMock.listChildSessions.mockImplementation(onePage([row("dsx_parent")]));

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChildSessions(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() =>
      expect(result.current.childSessions.map((w) => w.id)).toEqual(["dsx_parent"])
    );

    // Captured while the parent was open.
    const staleRefresh = result.current.refresh;

    sessionClientMock.listChildSessions.mockImplementation(onePage([row("dsx_child")]));
    rerender({ sessionId: "sess_child" });
    await waitFor(() =>
      expect(result.current.childSessions.map((w) => w.id)).toEqual(["dsx_child"])
    );

    const callsBefore = sessionClientMock.listChildSessions.mock.calls.length;
    sessionClientMock.listChildSessions.mockImplementation(onePage([row("dsx_stale")]));
    await act(async () => {
      await staleRefresh();
    });

    expect(result.current.childSessions.map((w) => w.id)).toEqual(["dsx_child"]);
    // And it should not have gone to the network at all — a read it may not
    // write is a read worth not making.
    expect(sessionClientMock.listChildSessions.mock.calls.length).toBe(callsBefore);
  });

  it("does not let a stale callback retire the current identity's in-flight read", async () => {
    // The hazard the fix itself could introduce. The sequence number is shared
    // across identities, so a stale closure that takes one would supersede a
    // legitimate read already in flight for the session on screen — trading a
    // wrong write for a silently dropped one.
    let resolveChild!: (rows: ChildSessionSummary[]) => void;

    sessionClientMock.listChildSessions.mockImplementation(onePage([row("dsx_parent")]));
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChildSessions(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() =>
      expect(result.current.childSessions.map((w) => w.id)).toEqual(["dsx_parent"])
    );
    const staleRefresh = result.current.refresh;

    // The child's read is held open.
    sessionClientMock.listChildSessions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveChild = resolve as (rows: ChildSessionSummary[]) => void;
        })
    );
    rerender({ sessionId: "sess_child" });
    await waitFor(() => expect(resolveChild).toBeDefined());

    // The stale callback fires while it is outstanding.
    await act(async () => {
      await staleRefresh();
    });

    // The child's read comes back and must still be the one that lands.
    sessionClientMock.listChildSessions.mockImplementation(
      async (_id: string, opts: { offset: number }) => (opts.offset === 0 ? [] : [])
    );
    await act(async () => {
      resolveChild([row("dsx_child")]);
      await Promise.resolve();
    });

    expect(result.current.childSessions.map((w) => w.id)).toEqual(["dsx_child"]);
  });
});

describe("useChildSessions — superseded reads", () => {
  it("clears the spinner when the session goes away while a read is in flight", async () => {
    // Retiring an identity has to retire its SPINNER too, and the fence that
    // makes the guards correct is what hides this: the in-flight read resolves
    // after the generation moved, so its `finally` declines to touch the flag —
    // correctly, it no longer owns it — and the replacement read takes the
    // no-session path, which starts nothing and so clears nothing. Nobody owns
    // the `true` that is already on screen, and the panel sits on
    // "Loading childSessions…" until some later session completes a read.
    //
    // Driven through the real transition rather than the no-session path alone,
    // because that path in isolation never sets the flag and would pass either
    // way.
    let resolveInFlight!: (rows: ChildSessionSummary[]) => void;
    sessionClientMock.listChildSessions.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInFlight = resolve as (rows: ChildSessionSummary[]) => void;
      })
    );

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string | null }) => useChildSessions(sessionId),
      { initialProps: { sessionId: "sess_parent" as string | null } }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    // The user picks a flow with no active session.
    rerender({ sessionId: null });

    await act(async () => {
      resolveInFlight([row("dsx_1")]);
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.childSessions).toEqual([]);
  });

  it("drops the previous session's rows before the new session's read lands", async () => {
    sessionClientMock.listChildSessions
      .mockResolvedValueOnce([row("dsx_parent")])
      .mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChildSessions(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() => expect(result.current.childSessions).toHaveLength(1));

    // A read that never resolves stands in for the window between the switch
    // and the new session's response.
    sessionClientMock.listChildSessions.mockReturnValueOnce(new Promise(() => {}));
    rerender({ sessionId: "sess_child" });

    expect(result.current.childSessions).toEqual([]);
    // The other side of retiring the spinner with the identity: clearing it must
    // not put a `false` on screen for a switch that immediately starts another
    // read. Both effects run in one commit, so the clear and the new read's
    // `true` batch into a single render — this pins that ordering, which is the
    // only thing making the clear safe here.
    expect(result.current.isLoading).toBe(true);
  });

  it("ignores a read that resolves after the session moved on", async () => {
    let resolveParent!: (rows: ChildSessionSummary[]) => void;
    sessionClientMock.listChildSessions.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveParent = resolve as (rows: ChildSessionSummary[]) => void;
      })
    );

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChildSessions(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );

    sessionClientMock.listChildSessions.mockResolvedValueOnce([]);
    rerender({ sessionId: "sess_child" });

    // The parent's read comes back late. Applying it would relabel the parent
    // conversation's background work as the child's — rows the user can click.
    await act(async () => {
      resolveParent([row("dsx_parent")]);
    });

    expect(result.current.childSessions).toEqual([]);
  });

  it("does not let an older read for the SAME session overwrite newer rows", async () => {
    // The gap a session-id guard cannot close: both reads name `sess_parent`,
    // so only ordering within the session tells them apart. The older one
    // carries a row still `active` that the newer one already saw complete.
    let resolveMount!: (rows: ChildSessionSummary[]) => void;
    sessionClientMock.listChildSessions.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMount = resolve as (rows: ChildSessionSummary[]) => void;
      })
    );

    const { result } = renderHook(() => useChildSessions("sess_parent"));

    // A manual Refresh overlapping the mount read, resolving first.
    sessionClientMock.listChildSessions
      .mockResolvedValueOnce([row("dsx_1", { status: "completed" })])
      .mockResolvedValueOnce([]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.childSessions[0]?.status).toBe("completed");

    // The mount read finally lands, holding the stale pre-completion view.
    await act(async () => {
      resolveMount([row("dsx_1", { status: "active" })]);
    });

    expect(result.current.childSessions[0]?.status).toBe("completed");
  });

  it("does not leave a stale error banner over rows a newer read succeeded with", async () => {
    // The asymmetry that a "nothing newer has APPLIED yet" fence misses: the
    // older read fails while the newer one is still in flight, so it passes
    // that fence and sets `error`. The newer read already cleared the error on
    // its way in, so its success writes rows underneath a failure banner that
    // describes a read nobody is waiting for.
    let rejectMount!: (err: Error) => void;
    sessionClientMock.listChildSessions.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectMount = reject as (err: Error) => void;
      })
    );

    const { result } = renderHook(() => useChildSessions("sess_parent"));

    // A manual Refresh overlaps it and lands FIRST, with real rows.
    sessionClientMock.listChildSessions
      .mockResolvedValueOnce([row("dsx_1")])
      .mockResolvedValueOnce([]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.childSessions).toHaveLength(1);

    // Only now does the older mount read reject. It is superseded, so it owns
    // nothing on screen — its failure must not be reported over the fresh rows.
    await act(async () => {
      rejectMount(new Error("network down"));
      await Promise.resolve();
    });

    expect(result.current.childSessions).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("retires reads from a superseded client, not just a superseded session", async () => {
    // The session client is rebuilt when `baseUrl` or the bearer token changes,
    // so a response from the old client is answering for a different server.
    let resolveOld!: (rows: ChildSessionSummary[]) => void;
    sessionClientMock.listChildSessions.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve as (rows: ChildSessionSummary[]) => void;
      })
    );

    const { result, rerender } = renderHook(() => useChildSessions("sess_parent"));

    devToolState.sessionClient = { listChildSessions: vi.fn().mockResolvedValue([]) } as never;
    rerender();

    await act(async () => {
      resolveOld([row("dsx_stale")]);
    });

    expect(result.current.childSessions).toEqual([]);

    devToolState.sessionClient = sessionClientMock;
  });
});
