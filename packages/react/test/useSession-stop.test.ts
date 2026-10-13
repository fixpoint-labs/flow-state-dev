// @vitest-environment happy-dom
/**
 * Behavioral tests for `useSession.abortRequest`: a stop pressed at any point
 * in a turn stops that turn, and the view keeps saying so.
 *
 * `@flow-state-dev/client` is mocked the way `useSession-continueRequest.test.ts`
 * does: the SSE transport hands its callbacks to the test, and the session and
 * action clients are plain mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

const { connections, sessionClientMock, clientMock } = vi.hoisted(() => ({
  connections: [] as Array<{
    callbacks: Record<string, ((e: unknown) => void) | undefined>;
    closed: boolean;
  }>,
  sessionClientMock: {
    getSession: vi.fn(),
    getSessionState: vi.fn(),
    listSessionRequests: vi.fn()
  },
  clientMock: {
    sendActionStream: vi.fn(),
    abortRequest: vi.fn()
  }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const makeSSE = (options: Record<string, ((e: unknown) => void) | undefined>) => {
    const rec = { callbacks: options, closed: false };
    connections.push(rec);
    return { close() { rec.closed = true; }, get lastEventId() { return undefined; } };
  };
  return {
    ...actual,
    createSSEClient: makeSSE,
    createSSEClientFromResponse: makeSSE,
    createRecoveryClient: () => ({}),
    createSessionClient: () => sessionClientMock,
    createClient: () => clientMock
  };
});

import { useSession } from "../src/hooks/useSession";

const STOP_CODE = "system.request_aborted";

function snapshot(items: unknown[]) {
  return {
    sessionId: "sess1",
    flowKind: "demo",
    clientData: {},
    items,
    pagination: { offset: 0, limit: 100, total: items.length, hasMore: false, nextOffset: 0 }
  };
}

function userMessage(requestId: string) {
  return {
    id: `item_msg_${requestId}`,
    type: "message",
    role: "user",
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
    ts: 1000,
    content: [{ type: "output_text", text: "begin" }]
  };
}

function serverStopItem(requestId: string) {
  return {
    id: `item_status_server_${requestId}`,
    type: "status",
    status: "completed",
    requestId,
    itemIndex: 1,
    provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
    ts: 2000,
    message: "Request was stopped.",
    detail: { code: STOP_CODE }
  };
}

function stopItemsOf(items: readonly unknown[], requestId: string) {
  return items.filter((item) => {
    const i = item as { type: string; requestId: string; detail?: { code?: string } };
    return i.type === "status" && i.requestId === requestId && i.detail?.code === STOP_CODE;
  });
}

function sseResponse(): Response {
  return {
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: { cancel: vi.fn(() => Promise.resolve()) }
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function mountIdle() {
  const hook = renderHook(() => useSession("sess1", { flowKind: "demo" }));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe("useSession.abortRequest: a stop at any point stops the turn", () => {
  beforeEach(() => {
    connections.length = 0;
    vi.resetAllMocks();
    sessionClientMock.getSession.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0
    });
    sessionClientMock.getSessionState.mockResolvedValue(snapshot([]));
    sessionClientMock.listSessionRequests.mockResolvedValue([]);
    clientMock.abortRequest.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("a stop pressed while the turn's POST is still out stops the turn once the server has it", async () => {
    const post = deferred<Response>();
    clientMock.sendActionStream.mockReturnValue(post.promise);
    clientMock.abortRequest.mockRejectedValueOnce(new Error("Abort request failed (404)"));

    const { result } = await mountIdle();

    let send!: Promise<unknown>;
    act(() => {
      send = result.current.sendAction("turn", { prompt: "begin" });
    });
    const requestId = (clientMock.sendActionStream.mock.calls[0]![2] as { requestId: string }).requestId;

    await act(async () => {
      await result.current.abortRequest();
    });
    expect(clientMock.abortRequest).toHaveBeenCalledWith(requestId);

    const response = sseResponse();
    await act(async () => {
      post.resolve(response);
      await send;
    });

    expect(clientMock.abortRequest).toHaveBeenCalledTimes(2);
    expect(clientMock.abortRequest).toHaveBeenLastCalledWith(requestId);
    expect(connections).toHaveLength(0);
    expect(response.body!.cancel).toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(false);
    expect(stopItemsOf(result.current.items, requestId)).toHaveLength(1);
  });

  it("a stop pressed on a turn picked up on mount stops it", async () => {
    sessionClientMock.getSession.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0,
      latestRequestId: "req_running"
    });
    sessionClientMock.getSessionState.mockResolvedValue(snapshot([userMessage("req_running")]));
    sessionClientMock.listSessionRequests.mockResolvedValue([
      { id: "req_running", flowKind: "demo", actionName: "turn", userId: "devuser", status: "in_progress" }
    ]);

    const { result } = renderHook(() =>
      useSession("sess1", { flowKind: "demo", autoResume: true })
    );
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    await act(async () => {
      await result.current.abortRequest();
    });

    expect(clientMock.abortRequest).toHaveBeenCalledWith("req_running");
    expect(connections.at(-1)!.closed).toBe(true);
    expect(result.current.isStreaming).toBe(false);
  });

  it("a stop mid-stream still reads as stopped after a snapshot taken before the server recorded it, without doubling once it has", async () => {
    clientMock.sendActionStream.mockResolvedValue(sseResponse());
    const { result } = await mountIdle();

    await act(async () => {
      await result.current.sendAction("turn", { prompt: "begin" });
    });
    const requestId = (clientMock.sendActionStream.mock.calls[0]![2] as { requestId: string }).requestId;
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      await result.current.abortRequest();
    });
    expect(stopItemsOf(result.current.items, requestId)).toHaveLength(1);

    sessionClientMock.getSessionState.mockResolvedValue(snapshot([userMessage(requestId)]));
    await act(async () => {
      await result.current.refresh();
    });
    expect(stopItemsOf(result.current.items, requestId)).toHaveLength(1);

    sessionClientMock.getSessionState.mockResolvedValue(
      snapshot([userMessage(requestId), serverStopItem(requestId)])
    );
    await act(async () => {
      await result.current.refresh();
    });
    const stops = stopItemsOf(result.current.items, requestId);
    expect(stops).toHaveLength(1);
    expect((stops[0] as { id: string }).id).toBe(`item_status_server_${requestId}`);
  });

  it("a stop that lost the race to the turn's end does not keep claiming the turn was stopped", async () => {
    clientMock.sendActionStream.mockResolvedValue(sseResponse());
    const { result } = await mountIdle();

    await act(async () => {
      await result.current.sendAction("turn", { prompt: "begin" });
    });
    const requestId = (clientMock.sendActionStream.mock.calls[0]![2] as { requestId: string }).requestId;

    const { ClientHttpError } = await import("@flow-state-dev/client");
    clientMock.abortRequest.mockRejectedValueOnce(
      new ClientHttpError("Abort request failed (409)", { status: 409, body: "" })
    );
    await act(async () => {
      await result.current.abortRequest();
    });
    // Nothing claims a stop, not even before the next read.
    expect(stopItemsOf(result.current.items, requestId)).toHaveLength(0);

    sessionClientMock.getSessionState.mockResolvedValue(snapshot([userMessage(requestId)]));
    await act(async () => {
      await result.current.refresh();
    });
    expect(stopItemsOf(result.current.items, requestId)).toHaveLength(0);
  });
});
