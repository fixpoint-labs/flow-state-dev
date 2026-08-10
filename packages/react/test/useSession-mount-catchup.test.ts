// @vitest-environment happy-dom
/**
 * Behavioral tests for `useSession`'s mount catch-up read (FIX-1012).
 *
 * On mount the hook reads the session snapshot and *then*, separately, lists
 * in-progress requests to decide whether to attach a stream. A request that
 * finishes between those two reads is invisible to both: nothing is in
 * progress to attach to, and the snapshot already applied predates the
 * request's final items. Before this fix the session stayed incomplete until
 * the consumer remounted or refreshed by hand — which is exactly the drill-in
 * case (opening a background job that is about to finish).
 *
 * `@flow-state-dev/client` is mocked the same way `useSession-continueRequest.test.ts`
 * does. The race is driven by making the two `listSessionRequests` calls
 * disagree, which is what actually happens when the request completes inside
 * the window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const { sessionClientMock } = vi.hoisted(() => ({
  sessionClientMock: {
    getSession: vi.fn(),
    getSessionState: vi.fn(),
    listSessionRequests: vi.fn()
  }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const noopSSE = () => ({
    close() {
      /* no stream is expected in these tests */
    },
    get lastEventId() {
      return undefined;
    }
  });
  return {
    ...actual,
    createSSEClient: noopSSE,
    createSSEClientFromResponse: noopSSE,
    createRecoveryClient: () => ({}),
    createSessionClient: () => sessionClientMock,
    createClient: () => ({ sendActionStream: vi.fn(), abortRequest: vi.fn() })
  };
});

import { useSession } from "../src/hooks/useSession";
import { setFlowContext } from "../src/context/FlowContext";

function message(id: string, text: string) {
  return {
    id,
    type: "message",
    status: "completed",
    requestId: "req1",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    content: [{ type: "output_text", text }]
  };
}

function snapshot(items: unknown[]) {
  return {
    sessionId: "job1",
    flowKind: "demo",
    clientData: {},
    items,
    pagination: {
      offset: 0,
      limit: 50,
      total: items.length,
      hasMore: false,
      nextOffset: 0
    }
  };
}

function request(status: string, id = "req1") {
  return {
    id,
    flowKind: "demo",
    actionName: "go",
    userId: "devuser",
    status
  };
}

describe("useSession mount catch-up (FIX-1012)", () => {
  beforeEach(() => {
    setFlowContext({});
    // resetAllMocks, not clearAllMocks: the queued `mockResolvedValueOnce`
    // values below outlive a `clear`, so a test that consumes fewer of them
    // than it queues would hand the leftovers to the next test.
    vi.resetAllMocks();
    sessionClientMock.getSession.mockResolvedValue({
      id: "job1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0,
      latestRequestId: "req1"
    });
  });

  afterEach(() => {
    cleanup();
    setFlowContext({});
  });

  it("surfaces the final items when the request completes between the snapshot read and the in-progress lookup", async () => {
    // Snapshot read 1 (mount) is taken while the request is still running, so
    // it predates the final item. Read 2 is the catch-up this fix adds.
    sessionClientMock.getSessionState
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([message("m_final", "the last step")]));

    sessionClientMock.listSessionRequests.mockImplementation(
      async (_sessionId: string, options?: { status?: string }) =>
        options?.status === "in_progress"
          ? // The autoResume lookup, run after the snapshot: the request
            // finished inside the window, so nothing is attachable.
            []
          : // refreshLatestRequest, concurrent with the snapshot read: the
            // request was still running at that moment.
            [request("in_progress")]
    );

    const { result } = renderHook(() =>
      useSession("job1", { flowKind: "demo", autoResume: true })
    );

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toContain("m_final");
    });

    // The catch-up is a second read of the snapshot, not a stream attach —
    // there is no in-progress request left to attach to.
    expect(sessionClientMock.getSessionState).toHaveBeenCalledTimes(2);
  });

  it("leaves the request summary agreeing with the items it caught up on", async () => {
    // Nothing else can correct `latestRequest` on this path: no stream is
    // attached, so no terminal status event ever arrives. Without an explicit
    // re-read the hook shows completed items beside a summary still reading
    // in-flight.
    let statusReads = 0;
    sessionClientMock.listSessionRequests.mockImplementation(
      async (_sessionId: string, options?: { status?: string }) => {
        if (options?.status === "in_progress") return [];
        statusReads += 1;
        // First read (before the snapshot) sees it running; by the time the
        // catch-up re-reads, the request has finished.
        return [request(statusReads === 1 ? "in_progress" : "completed")];
      }
    );
    sessionClientMock.getSessionState
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([message("m_final", "the last step")]));

    const { result } = renderHook(() =>
      useSession("job1", { flowKind: "demo", autoResume: true })
    );

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toContain("m_final");
    });

    await waitFor(() => {
      expect(result.current.latestRequest?.status).toBe("completed");
    });
  });

  it("reads the latest-request status BEFORE the snapshot, so a terminal status proves the snapshot is current", async () => {
    // The condition that drives the catch-up is "was the request running
    // before the snapshot was read". If the two reads race, a server that
    // serves the snapshot while the request is still running and the status
    // after it completed leaves the status terminal and the snapshot stale —
    // and the catch-up is skipped in exactly the case it exists for. That
    // interleaving cannot be built out of mock return values (the two reads
    // are independent), so the property under test is the ORDER itself.
    const order: string[] = [];
    let releaseStatus: (rows: unknown[]) => void = () => {};
    const statusRead = new Promise<unknown[]>((resolve) => {
      releaseStatus = resolve;
    });

    sessionClientMock.listSessionRequests.mockImplementation(
      async (_sessionId: string, options?: { status?: string }) => {
        if (options?.status === "in_progress") {
          order.push("in-progress-lookup");
          return [];
        }
        order.push("status-read:start");
        const rows = await statusRead;
        order.push("status-read:end");
        return rows;
      }
    );
    sessionClientMock.getSessionState.mockImplementation(async () => {
      order.push("snapshot");
      return snapshot([message("m_done", "finished")]);
    });

    renderHook(() => useSession("job1", { flowKind: "demo", autoResume: true }));

    await waitFor(() => {
      expect(order).toContain("status-read:start");
    });

    // The snapshot must not have been requested yet: it is ordered behind the
    // status read, which is what makes a terminal status meaningful.
    expect(order).not.toContain("snapshot");

    releaseStatus([request("completed")]);

    await waitFor(() => {
      expect(order).toContain("snapshot");
    });
    expect(order.indexOf("status-read:end")).toBeLessThan(
      order.indexOf("snapshot")
    );
  });

  it("catches up the older request's items even when a newer request is attachable", async () => {
    // Two requests overlap on one session — a second tab, or work started
    // server-side. Request A was running when the snapshot was read and
    // finished inside the window; request B is newer, still running, and is
    // what the session now points at. Attaching to B is correct, but B's
    // stream is request-scoped and will never replay A's final items. Gating
    // the catch-up on "there was nothing to attach to" therefore loses them,
    // and if B ends without a completion refresh nothing else goes back for
    // them either.
    sessionClientMock.getSession.mockResolvedValue({
      id: "job1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0,
      latestRequestId: "req2"
    });

    sessionClientMock.getSessionState
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([message("m_final", "A's last step")]));

    sessionClientMock.listSessionRequests.mockImplementation(
      async (_sessionId: string, options?: { status?: string }) =>
        options?.status === "in_progress"
          ? // B is running and is the session's latest, so it is attachable.
            [request("in_progress", "req2")]
          : // Before the snapshot, A was the latest and still running.
            [request("in_progress", "req1")]
    );

    const { result } = renderHook(() =>
      useSession("job1", { flowKind: "demo", autoResume: true })
    );

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toContain("m_final");
    });

    // The mount snapshot plus the catch-up.
    expect(sessionClientMock.getSessionState).toHaveBeenCalledTimes(2);
  });

  it("does not re-read the snapshot when the session was already idle at mount", async () => {
    // The common path: nothing was running when the hook mounted, so there is
    // no race to catch up on and the extra read must not happen. Without this
    // the fix would silently double every autoResume consumer's mount reads.
    sessionClientMock.getSessionState.mockResolvedValue(
      snapshot([message("m_done", "finished earlier")])
    );
    sessionClientMock.listSessionRequests.mockImplementation(
      async (_sessionId: string, options?: { status?: string }) =>
        options?.status === "in_progress" ? [] : [request("completed")]
    );

    const { result } = renderHook(() =>
      useSession("job1", { flowKind: "demo", autoResume: true })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(sessionClientMock.getSessionState).toHaveBeenCalledTimes(1);
    expect(result.current.items.map((item) => item.id)).toContain("m_done");
  });
});
