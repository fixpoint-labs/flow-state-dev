// @vitest-environment happy-dom
/**
 * Behavioral tests for `useSession.continueRequest` (FIX-865) — reattaching to
 * a crash-interrupted request's continuation stream by its own id (not the
 * `resumeLatestRequest` /retry path). `@flow-state-dev/client`'s session and
 * recovery clients are mocked; the SSE transport is mocked the same way
 * `useRequestStream.test.ts` does — capturing the callbacks handed to
 * `createSSEClientFromResponse`/`createSSEClient` so the test can feed events
 * directly instead of parsing real SSE wire bytes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const { connections, recoveryClientMock, sessionClientMock } = vi.hoisted(() => ({
  connections: [] as Array<{
    callbacks: Record<string, ((e: unknown) => void) | undefined>;
    closed: boolean;
  }>,
  recoveryClientMock: {
    continueStream: vi.fn(),
    continue: vi.fn(),
    retry: vi.fn(),
    resumeSuspension: vi.fn(),
    resumeSuspensionStream: vi.fn(),
    checkInterrupted: vi.fn()
  },
  sessionClientMock: {
    getSession: vi.fn(),
    getSessionState: vi.fn(),
    listSessionRequests: vi.fn()
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
    createRecoveryClient: () => recoveryClientMock,
    createSessionClient: () => sessionClientMock,
    createClient: () => ({
      sendActionStream: vi.fn(),
      abortRequest: vi.fn()
    })
  };
});

import { useSession } from "../src/hooks/useSession";
import { setFlowContext } from "../src/context/FlowContext";

let seq = 0;
function base(requestId: string) {
  return { stream: "request", requestId, sequence_number: ++seq, ts: Date.now() };
}
function itemAdded(requestId: string, item: unknown) {
  return { ...base(requestId), type: "item.added", item };
}
function makeMessage(id: string, requestId: string, text: string) {
  return {
    id,
    type: "message",
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    content: [{ type: "output_text", text }]
  };
}

/** Replicate the client's dispatch: onEvent, then the typed callback. */
function feed(event: { type: string } & Record<string, unknown>) {
  const cb = connections[connections.length - 1]!.callbacks;
  cb.onEvent?.(event);
  if (event.type === "item.added") cb.onItemAdded?.(event);
}

function emptySnapshot(sessionId: string) {
  return {
    sessionId,
    flowKind: "demo",
    clientData: {},
    items: [],
    pagination: { offset: 0, limit: 0, total: 0, hasMore: false, nextOffset: 0 }
  };
}

function sseResponse(): Response {
  return {
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: {}
  } as unknown as Response;
}

function jsonAcceptedResponse(): Response {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    body: { cancel: () => Promise.resolve() }
  } as unknown as Response;
}

describe("useSession.continueRequest (FIX-865)", () => {
  beforeEach(() => {
    connections.length = 0;
    seq = 0;
    setFlowContext({});
    vi.clearAllMocks();
    sessionClientMock.getSession.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0
    });
    sessionClientMock.getSessionState.mockResolvedValue(emptySnapshot("sess1"));
    sessionClientMock.listSessionRequests.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    setFlowContext({});
  });

  it("continues the request by the given id and streams its items into the hook (not resumeLatestRequest's /retry path)", async () => {
    recoveryClientMock.continueStream.mockResolvedValue(sseResponse());

    const { result } = renderHook(() =>
      useSession("sess1", { flowKind: "demo" })
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.continueRequest("req_interrupted_1");
    });

    // continueStream (the FIX-865 route) was called with the exact id passed
    // in — not derived from `latestRequest`.
    expect(recoveryClientMock.continueStream).toHaveBeenCalledWith({
      flowKind: "demo",
      sessionId: "sess1",
      requestId: "req_interrupted_1"
    });
    // The /retry-based method must be untouched by this call.
    expect(recoveryClientMock.retry).not.toHaveBeenCalled();

    act(() => {
      feed(itemAdded("req_interrupted_1", makeMessage("m1", "req_interrupted_1", "resumed output")));
    });

    expect(
      result.current.items.find((i) => i.id === "m1")
    ).toMatchObject({ type: "message" });
  });

  it("does not re-POST /continue when the server returns a non-SSE 202 — reconnects via GET instead", async () => {
    recoveryClientMock.continueStream.mockResolvedValue(jsonAcceptedResponse());

    const { result } = renderHook(() =>
      useSession("sess1", { flowKind: "demo" })
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.continueRequest("req_interrupted_2");
    });

    expect(recoveryClientMock.continueStream).toHaveBeenCalledTimes(1);
    // Must not fall back to a second POST via the JSON continue() method.
    expect(recoveryClientMock.continue).not.toHaveBeenCalled();

    // A GET-based reconnect opened a second stream connection (the inline
    // SSE POST body was cancelled, not consumed as a stream).
    expect(connections.length).toBeGreaterThanOrEqual(1);
  });
});
