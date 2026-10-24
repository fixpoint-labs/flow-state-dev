// @vitest-environment happy-dom
/**
 * Behavioral tests for `useSession.continueRequest` (FIX-865) — reattaching to
 * a crash-interrupted request's continuation stream by its own id (not the
 * `resumeLatestRequest` /retry path). `@flow-state-dev/client`'s session and
 * recovery clients are mocked; the SSE transport is mocked the same way
 * `useRequestStream.test.ts` does — capturing the callbacks handed to
 * `createSSEClientFromResponse`/a request's `stream()` so the test can feed events
 * directly instead of parsing real SSE wire bytes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const { connections, requestMock, sessionsMock } = vi.hoisted(() => ({
  connections: [] as Array<{
    callbacks: Record<string, ((e: unknown) => void) | undefined>;
    closed: boolean;
  }>,
  requestMock: {
    continue: vi.fn(),
    retry: vi.fn(),
    resume: vi.fn()
  },
  sessionsMock: {
    get: vi.fn(),
    state: vi.fn(),
    requests: vi.fn()
  }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  const makeSSE = (options: Record<string, ((e: unknown) => void) | undefined>) => {
    const rec = { callbacks: options, closed: false };
    connections.push(rec);
    return { close() { rec.closed = true; }, get lastEventId() { return undefined; } };
  };
  return {
    ...actual,
    createSSEClientFromResponse: makeSSE,
    createClient: () =>
      fakeClient({
        sessions: { ...sessionsMock },
        flow: { send: vi.fn(), abort: vi.fn() },
        request: requestMock,
        requestStream: makeSSE
      })
  };
});

import { useSession } from "../src/hooks/useSession";

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
    vi.clearAllMocks();
    sessionsMock.get.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0
    });
    sessionsMock.state.mockResolvedValue(emptySnapshot("sess1"));
    sessionsMock.requests.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("continues the request by the given id and streams its items into the hook (not resumeLatestRequest's /retry path)", async () => {
    requestMock.continue.mockResolvedValue(sseResponse());

    const { result } = renderHook(() =>
      useSession("sess1", { flowKind: "demo" })
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.continueRequest("req_interrupted_1");
    });

    // The streaming continue (the FIX-865 route) was called with the exact id
    // passed in — not derived from `latestRequest`.
    expect(requestMock.continue).toHaveBeenCalledWith("req_interrupted_1", { stream: true });
    // The /retry-based method must be untouched by this call.
    expect(requestMock.retry).not.toHaveBeenCalled();

    act(() => {
      feed(itemAdded("req_interrupted_1", makeMessage("m1", "req_interrupted_1", "resumed output")));
    });

    expect(
      result.current.items.find((i) => i.id === "m1")
    ).toMatchObject({ type: "message" });
  });

  it("does not re-POST /continue when the server returns a non-SSE 202 — reconnects via GET instead", async () => {
    requestMock.continue.mockResolvedValue(jsonAcceptedResponse());

    const { result } = renderHook(() =>
      useSession("sess1", { flowKind: "demo" })
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.continueRequest("req_interrupted_2");
    });

    // One streaming POST, and no fallback second POST as a JSON continue().
    expect(requestMock.continue).toHaveBeenCalledTimes(1);
    expect(requestMock.continue).toHaveBeenCalledWith("req_interrupted_2", { stream: true });

    // A GET-based reconnect opened a second stream connection (the inline
    // SSE POST body was cancelled, not consumed as a stream).
    expect(connections.length).toBeGreaterThanOrEqual(1);
  });
});
