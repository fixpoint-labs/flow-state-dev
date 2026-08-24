// @vitest-environment happy-dom
/**
 * Behavioral tests for `useSession`'s `workstreams` axis (FIX-1012).
 *
 * The design is interaction-only: the panel is current as of the last thing
 * the user did. It is read on mount, at the START of every action, and on
 * `refresh()` — and nothing else. There is no polling and no stream-driven
 * refresh, so several tests here assert the *absence* of reads; those are the
 * ones that keep the cost from creeping back.
 *
 * Assertions are on the NUMBER OF READS wherever the rendered list would look
 * identical either way. A list-only assertion passes against a hook that
 * refetches on every event, which is the defect this design exists to avoid.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";

const { sessionClientMock, clientMock, recoveryClientMock } = vi.hoisted(() => ({
  sessionClientMock: {
    getSession: vi.fn(),
    getSessionState: vi.fn(),
    listSessionRequests: vi.fn(),
    listWorkstreams: vi.fn()
  },
  clientMock: {
    sendActionStream: vi.fn(),
    abortRequest: vi.fn()
  },
  recoveryClientMock: {
    continueStream: vi.fn(),
    continue: vi.fn(),
    retry: vi.fn(),
    resumeSuspension: vi.fn(),
    resumeSuspensionStream: vi.fn(),
    checkInterrupted: vi.fn()
  }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const noopSSE = () => ({
    close() {
      /* streams are irrelevant to this axis — it never reads from one */
    },
    get lastEventId() {
      return undefined;
    }
  });
  return {
    ...actual,
    createSSEClient: noopSSE,
    createSSEClientFromResponse: noopSSE,
    createRecoveryClient: () => recoveryClientMock,
    // A FRESH object per call, like the real factory: the hook memoizes the
    // client on `baseUrl`, so a singleton here would hold its identity across
    // a backend change and hide the guard this suite is testing.
    createSessionClient: () => ({ ...sessionClientMock }),
    createClient: () => clientMock
  };
});

import { useSession } from "../src/hooks/useSession";

function snapshot() {
  return {
    sessionId: "sess1",
    flowKind: "demo",
    clientData: {},
    items: [],
    pagination: { offset: 0, limit: 50, total: 0, hasMore: false, nextOffset: 0 }
  };
}

function row(id: string, status?: string) {
  return {
    id,
    parentSessionId: "sess1",
    createdAt: 1,
    updatedAt: 2,
    topic: `topic-${id}`,
    ...(status === undefined ? {} : { status })
  };
}

function sseResponse(): Response {
  return {
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: { cancel: () => Promise.resolve() }
  } as unknown as Response;
}

/** Mount and wait for the mount read to land. */
async function mountSession(options?: Record<string, unknown>) {
  const view = renderHook(() =>
    useSession("sess1", { flowKind: "demo", ...options })
  );
  await waitFor(() => {
    expect(sessionClientMock.listWorkstreams).toHaveBeenCalled();
  });
  return view;
}

describe("useSession workstreams axis (FIX-1012)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionClientMock.getSession.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0
    });
    sessionClientMock.getSessionState.mockResolvedValue(snapshot());
    sessionClientMock.listSessionRequests.mockResolvedValue([]);
    sessionClientMock.listWorkstreams.mockResolvedValue([]);
    clientMock.sendActionStream.mockResolvedValue(sseResponse());
  });

  afterEach(() => {
    cleanup();
  });

  it("costs one read on mount and yields an empty axis for a session with no background work", async () => {
    const { result } = await mountSession();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(sessionClientMock.listWorkstreams).toHaveBeenCalledTimes(1);
    expect(sessionClientMock.listWorkstreams).toHaveBeenCalledWith(
      "sess1",
      undefined
    );
    expect(result.current.workstreams).toEqual([]);
    expect(result.current.workstreamsStale).toBe(false);
    // The second path (BP-035): the conversation is untouched by this feature.
    expect(result.current.items).toEqual([]);
  });

  it("exposes one row per body of work, carrying the state the row renders", async () => {
    sessionClientMock.listWorkstreams.mockResolvedValue([
      row("ws1", "active"),
      row("ws2", "failed")
    ]);

    const { result } = await mountSession();

    await waitFor(() => {
      expect(result.current.workstreams).toHaveLength(2);
    });
    expect(result.current.workstreams.map((w) => w.id)).toEqual(["ws1", "ws2"]);
    // Failed work stays listed rather than disappearing (decision 3).
    expect(result.current.workstreams[1]?.status).toBe("failed");
  });

  it("reads EXACTLY ONCE per turn — at the start of the action, not twice", async () => {
    const { result } = await mountSession();
    sessionClientMock.listWorkstreams.mockClear();

    await act(async () => {
      await result.current.sendAction("go", {});
    });

    // The pinned number for interaction-only. Two would mean the terminal
    // read crept back in; zero would mean a launched job is never discovered.
    expect(sessionClientMock.listWorkstreams).toHaveBeenCalledTimes(1);
  });

  it("still reads exactly once per turn with items disabled", async () => {
    const { result } = await mountSession({ items: false });
    sessionClientMock.listWorkstreams.mockClear();

    await act(async () => {
      await result.current.sendAction("go", {});
    });

    // The read is a local fact about the interaction, not a stream signal, so
    // turning streaming off cannot remove it.
    expect(sessionClientMock.listWorkstreams).toHaveBeenCalledTimes(1);
  });

  it("does not read again while the user simply waits — nothing polls", async () => {
    vi.useFakeTimers();
    try {
      const view = renderHook(() => useSession("sess1", { flowKind: "demo" }));
      await vi.waitFor(() => {
        expect(sessionClientMock.listWorkstreams).toHaveBeenCalled();
      });
      sessionClientMock.listWorkstreams.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      // Interaction-only: two minutes of sitting still costs nothing. This is
      // the assertion that fails if a poll is ever reintroduced.
      expect(sessionClientMock.listWorkstreams).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refresh() covers the axis, so work launched after mount reaches the screen with no action", async () => {
    const { result } = await mountSession();

    await waitFor(() => {
      expect(result.current.workstreams).toEqual([]);
    });

    sessionClientMock.listWorkstreams.mockResolvedValue([row("ws_new", "active")]);

    await act(async () => {
      await result.current.refresh();
    });

    // Under interaction-only this is the app's only way to surface a
    // just-launched job without sending another action.
    expect(result.current.workstreams.map((w) => w.id)).toEqual(["ws_new"]);
  });

  it("an older read cannot overwrite a newer one within the same session", async () => {
    let releaseFirst: (rows: unknown[]) => void = () => {};
    const firstRead = new Promise<unknown[]>((resolve) => {
      releaseFirst = resolve;
    });

    sessionClientMock.listWorkstreams
      // The mount read: slow, and carries a row that is still running.
      .mockImplementationOnce(() => firstRead)
      // A later read: fast, and sees that same work already finished.
      .mockResolvedValueOnce([row("ws1", "completed")]);

    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.workstreams[0]?.status).toBe("completed");
    });

    // Now let the stale mount read land last.
    await act(async () => {
      releaseFirst([row("ws1", "active")]);
      await Promise.resolve();
    });

    // The newer rows survive: a terminal row must never be regressed to
    // active by a response that was simply slower.
    expect(result.current.workstreams[0]?.status).toBe("completed");
  });

  it("discards a read in flight when baseUrl changes under a constant session id", async () => {
    let releaseOldBackend: (rows: unknown[]) => void = () => {};
    const oldBackendRead = new Promise<unknown[]>((resolve) => {
      releaseOldBackend = resolve;
    });

    sessionClientMock.listWorkstreams
      .mockImplementationOnce(() => oldBackendRead)
      .mockResolvedValue([row("ws_new_backend", "active")]);

    const { result, rerender } = renderHook(
      ({ baseUrl }: { baseUrl: string }) =>
        useSession("sess1", { flowKind: "demo", baseUrl }),
      { initialProps: { baseUrl: "https://old.example" } }
    );

    rerender({ baseUrl: "https://new.example" });

    await waitFor(() => {
      expect(result.current.workstreams.map((w) => w.id)).toEqual([
        "ws_new_backend"
      ]);
    });

    await act(async () => {
      releaseOldBackend([row("ws_old_backend", "active")]);
      await Promise.resolve();
    });

    // A guard keyed to the session id alone would let the old backend's rows
    // land here, because the session id never changed.
    expect(result.current.workstreams.map((w) => w.id)).toEqual([
      "ws_new_backend"
    ]);
  });

  it("keeps the last known rows and marks them stale when a read fails, then clears the mark on success", async () => {
    sessionClientMock.listWorkstreams.mockResolvedValue([row("ws1", "active")]);
    const { result } = await mountSession();

    await waitFor(() => {
      expect(result.current.workstreams).toHaveLength(1);
    });

    sessionClientMock.listWorkstreams.mockRejectedValue(new Error("network"));
    await act(async () => {
      await result.current.refresh();
    });

    // Retained, not cleared — dropping them would claim the work vanished.
    expect(result.current.workstreams.map((w) => w.id)).toEqual(["ws1"]);
    expect(result.current.workstreamsStale).toBe(true);

    sessionClientMock.listWorkstreams.mockResolvedValue([row("ws1", "completed")]);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.workstreamsStale).toBe(false);
    expect(result.current.workstreams[0]?.status).toBe("completed");
  });

  it("names no page size of its own, so a deployment's smaller ceiling cannot reject the read", async () => {
    await mountSession();

    // The route's maximum is configurable and this side cannot see it. Any
    // number hardcoded here is one a deployment can set its ceiling below, and
    // the route answers an over-limit `limit` with a 400 rather than clamping
    // — so an ordinary mount would return no rows at all on that deployment.
    const [, listOptions] = sessionClientMock.listWorkstreams.mock.calls[0] ?? [];
    expect(listOptions?.limit).toBeUndefined();
  });

  it("asks for the caller's limit, because the default is too small for a large orchestration", async () => {
    // The list is all-time history, not just what is running, so a long-lived
    // conversation outgrows any fixed number. An app that knows it runs more
    // background work than the default has to be able to say so.
    await mountSession({ workstreams: { limit: 500 } });

    expect(sessionClientMock.listWorkstreams).toHaveBeenCalledWith(
      "sess1",
      expect.objectContaining({ limit: 500 })
    );
  });

  it("does not re-read on every render when the limit is passed as an inline object", async () => {
    const { rerender } = renderHook(() =>
      // A fresh object identity every render — the ordinary way an app writes
      // this. Keying the read on the object rather than the number inside it
      // turns each render into another read.
      useSession("sess1", { flowKind: "demo", workstreams: { limit: 250 } })
    );

    await waitFor(() => {
      expect(sessionClientMock.listWorkstreams).toHaveBeenCalled();
    });

    rerender();
    rerender();

    expect(sessionClientMock.listWorkstreams).toHaveBeenCalledTimes(1);
  });

  it("a read that fails after a newer one succeeded does not mark fresh rows stale", async () => {
    let rejectFirst: (cause: Error) => void = () => {};
    const firstRead = new Promise<unknown[]>((_resolve, reject) => {
      rejectFirst = reject;
    });

    sessionClientMock.listWorkstreams
      // The mount read: slow, and destined to fail.
      .mockImplementationOnce(() => firstRead)
      // A later read that succeeds while the first is still outstanding.
      .mockResolvedValueOnce([row("ws1", "completed")]);

    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.workstreams[0]?.status).toBe("completed");
    });

    await act(async () => {
      rejectFirst(new Error("network"));
      await Promise.resolve();
    });

    // The rows on screen came from the newer read and are current. A failure
    // from a read that was already superseded says nothing about them, so
    // presenting them as possibly out of date would be a lie the user acts on.
    expect(result.current.workstreams[0]?.status).toBe("completed");
    expect(result.current.workstreamsStale).toBe(false);
  });

  it("a read that succeeds after a newer one failed does not clear the stale mark", async () => {
    let releaseFirst: (rows: unknown[]) => void = () => {};
    const firstRead = new Promise<unknown[]>((resolve) => {
      releaseFirst = resolve;
    });

    sessionClientMock.listWorkstreams
      // The mount read: slow, carrying rows that are already out of date.
      .mockImplementationOnce(() => firstRead)
      // A later read that fails while the first is still outstanding.
      .mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.workstreamsStale).toBe(true);
    });

    await act(async () => {
      releaseFirst([row("ws1", "active")]);
      await Promise.resolve();
    });

    // The newest thing known about this list is that reading it failed. An
    // older response arriving afterwards is not evidence it is current again,
    // and applying it would also regress the rows.
    expect(result.current.workstreamsStale).toBe(true);
    expect(result.current.workstreams).toHaveLength(0);
  });

  it("clears the axis when the session changes", async () => {
    sessionClientMock.listWorkstreams.mockResolvedValue([row("ws1", "active")]);

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSession(id, { flowKind: "demo" }),
      { initialProps: { id: "sess1" } }
    );

    await waitFor(() => {
      expect(result.current.workstreams).toHaveLength(1);
    });

    sessionClientMock.listWorkstreams.mockResolvedValue([]);
    rerender({ id: "sess2" });

    await waitFor(() => {
      expect(result.current.workstreams).toEqual([]);
    });
    expect(result.current.workstreamsStale).toBe(false);
  });

  it("renders a status it has never seen, and a row that has no status at all", async () => {
    sessionClientMock.listWorkstreams.mockResolvedValue([
      // A value from a future server. This package must not enumerate the
      // status vocabulary, so an unknown value renders rather than throwing.
      row("ws_future", "escalated"),
      // Absence is its own state: work that has started nothing.
      row("ws_unstarted")
    ]);

    const { result } = await mountSession();

    await waitFor(() => {
      expect(result.current.workstreams).toHaveLength(2);
    });
    expect(result.current.workstreams[0]?.status).toBe("escalated");
    expect(result.current.workstreams[1]?.status).toBeUndefined();
  });
});

describe("useSession workstreams — every interaction path is classified (FIX-1012)", () => {
  /**
   * The list of work-starting methods has been wrong three times, so this is
   * an exhaustiveness test rather than a list: it enumerates the callable
   * members the hook returns and requires each to be classified. Adding a
   * method to the view fails this suite until someone decides which bucket it
   * belongs in.
   */
  const SIDE_CHAIN_STARTING = [
    "sendAction",
    "resumeLatestRequest",
    "resumeSuspension",
    "continueRequest"
  ];

  // Each entry states why it does not need to discover background work.
  const NON_SIDE_CHAIN_STARTING: Record<string, string> = {
    refresh: "is itself the read",
    abortRequest: "stops work, never starts it",
    dismissRequest: "drops a stuck request locally",
    subscribeAudioDelta: "registers a listener",
    getOwnedItems: "pure selector over items already held",
    getItemsByAgent: "pure selector over items already held",
    getItemsByVisibility: "pure selector over items already held"
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sessionClientMock.getSession.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0
    });
    sessionClientMock.getSessionState.mockResolvedValue(snapshot());
    sessionClientMock.listSessionRequests.mockResolvedValue([]);
    sessionClientMock.listWorkstreams.mockResolvedValue([]);
    clientMock.sendActionStream.mockResolvedValue(sseResponse());
    recoveryClientMock.continueStream.mockResolvedValue(sseResponse());
    recoveryClientMock.resumeSuspensionStream.mockResolvedValue(sseResponse());
    recoveryClientMock.retry.mockResolvedValue(sseResponse());
  });

  afterEach(() => {
    cleanup();
  });

  it("classifies every callable on the returned view", async () => {
    const { result } = await mountSession();

    const callables = Object.entries(result.current)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);

    const unclassified = callables.filter(
      (name) =>
        !SIDE_CHAIN_STARTING.includes(name) &&
        !Object.hasOwn(NON_SIDE_CHAIN_STARTING, name)
    );

    expect(unclassified).toEqual([]);
    // Guard against the lists rotting the other way — a method that was
    // classified but has since been removed.
    for (const name of SIDE_CHAIN_STARTING) {
      expect(callables).toContain(name);
    }
  });

  it("every work-starting path performs the discovery read", async () => {
    const { result } = await mountSession();

    const drive: Record<string, () => Promise<unknown>> = {
      sendAction: () => result.current.sendAction("go", {}),
      resumeLatestRequest: () => result.current.resumeLatestRequest(),
      resumeSuspension: () =>
        result.current.resumeSuspension({
          suspensionId: "susp1",
          requestId: "req1",
          action: "approve" as never
        }),
      continueRequest: () => result.current.continueRequest("req1")
    };

    for (const name of SIDE_CHAIN_STARTING) {
      sessionClientMock.listWorkstreams.mockClear();
      await act(async () => {
        await drive[name]!().catch(() => {
          // A path that bails for its own reasons still counts: the read is
          // owed to the interaction, not to the outcome.
        });
      });
      expect(
        sessionClientMock.listWorkstreams,
        `${name} must perform the discovery read`
      ).toHaveBeenCalledTimes(1);
    }
  });
});
