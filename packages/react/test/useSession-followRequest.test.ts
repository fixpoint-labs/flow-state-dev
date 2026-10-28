// @vitest-environment happy-dom
/**
 * `useSession.followRequest` (FIX-2265): a request sent without the hook is
 * followed only when the page asks, so until then the page stays on the
 * request it follows.
 *
 * The client is faked (`support/fake-client`); the request streams it opens
 * are captured so the test can see which request each follows and feed it.
 *
 * Red states produced before these were trusted:
 *   - attach without making the request the active one, and the "stop
 *     reaches it" case fails (the stop goes to nothing).
 *   - let a stop's cleanup close whatever stream is open when the stop's
 *     answer lands, and the "stop that lands late" case fails: the request
 *     followed meanwhile loses its stream.
 *   - follow a request again from the start after its stream dropped, and
 *     the "picks up after the last event" case fails: the server replays
 *     events the view already applied.
 *   - reset the finishing state on every attach, and the "still finishing"
 *     case fails: the resumed stream skips the status that set it, so the
 *     view blocks actions the request no longer blocks.
 *   - keep the saved cursor across a session change, and the "after the
 *     view left the session" case fails: the request resumes past the
 *     status the cleared view no longer has.
 *   - resume a request whose stream ended rather than dropped, and the
 *     "after it ended" case fails: the stream starts past its own end and
 *     never settles.
 *   - follow a request the person stopped or dismissed, and the "stopped"
 *     and "dismissed" cases fail: the view opens its stream again from the
 *     start.
 *   - keep an earlier stream's cursor when a stream starts from the
 *     beginning, and the "dropped before its first event" case fails: the
 *     next follow resumes past the earlier stream's end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const { connections, sessionsMock, flowMock } = vi.hoisted(() => ({
  connections: [] as Array<{ url: string; callbacks: Record<string, ((e: unknown) => void) | undefined>; closed: boolean }>,
  sessionsMock: { get: vi.fn(), state: vi.fn(), requests: vi.fn() },
  flowMock: { send: vi.fn(), abort: vi.fn() },
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  return {
    ...actual,
    createClient: () =>
      fakeClient({
        sessions: { ...sessionsMock },
        flow: flowMock,
        request: { status: vi.fn(async () => ({ status: "in_progress" })) },
        requestStream: (options) => {
          const rec = { url: options.url, callbacks: options as never, closed: false };
          connections.push(rec);
          return { close() { rec.closed = true; }, get lastEventId() { return undefined; } };
        },
      }),
  };
});

import { useSession } from "../src/hooks/useSession";

function message(id: string, requestId: string, text: string) {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    content: [{ type: "output_text", text }],
  };
}

beforeEach(() => {
  connections.length = 0;
  vi.clearAllMocks();
  sessionsMock.get.mockResolvedValue({ id: "sess1", flowKind: "demo", userId: "devuser", createdAt: 0, updatedAt: 0 });
  sessionsMock.state.mockResolvedValue({
    sessionId: "sess1",
    flowKind: "demo",
    clientData: {},
    items: [],
    pagination: { offset: 0, limit: 0, total: 0, hasMore: false, nextOffset: 0 },
  });
  sessionsMock.requests.mockResolvedValue([]);
  flowMock.abort.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("useSession.followRequest (FIX-2265)", () => {
  it("streams the named request's items into the session, and sends nothing", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_line"));

    expect(flowMock.send).not.toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(true);
    const stream = connections.at(-1)!;
    expect(stream.url).toContain("/requests/req_line/stream");
    act(() => stream.callbacks.onItemAdded?.({ type: "item.added", item: message("m1", "req_line", "BRAVO") }));
    expect(result.current.items.find((item) => item.id === "m1")).toMatchObject({ requestId: "req_line" });
  });

  it("closes the stream it followed before", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    const first = connections.at(-1)!;
    act(() => result.current.followRequest("req_line"));

    expect(first.closed).toBe(true);
    expect(connections.at(-1)!.url).toContain("/requests/req_line/stream");
  });

  it("followed again after its stream dropped, picks up after the last event the view had", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    const first = connections.at(-1)!;
    const resumesAfter = (stream: (typeof connections)[number]) => (stream.callbacks as { startingAfter?: number }).startingAfter;
    expect(resumesAfter(first)).toBeUndefined();
    act(() => first.callbacks.onEvent?.({ stream: "request", requestId: "req_turn", sequence_number: 7, ts: 1000, type: "item.added" }));
    act(() => first.callbacks.onError?.(new Error("dropped")));

    // Replayed from the start, an increment or push the view already applied would apply twice.
    act(() => result.current.followRequest("req_turn"));
    expect(resumesAfter(connections.at(-1)!)).toBe(7);
    // Another request still streams from its start.
    act(() => result.current.followRequest("req_line"));
    expect(resumesAfter(connections.at(-1)!)).toBeUndefined();
  });

  it("followed again while finishing, still lets actions through", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    const first = connections.at(-1)!;
    act(() => first.callbacks.onEvent?.({ stream: "request", requestId: "req_turn", sequence_number: 4, ts: 1000, type: "item.added" }));
    act(() =>
      first.callbacks.onItemAdded?.({ type: "item.added", item: { id: "st1", type: "status", requestId: "req_turn", blocked: false, ts: 1000 } })
    );
    expect(result.current.canSendAction).toBe(true);
    act(() => first.callbacks.onError?.(new Error("dropped")));

    act(() => result.current.followRequest("req_turn"));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.canSendAction).toBe(true);
  });

  it("followed again after the view left the session and came back, streams from the start", async () => {
    const { result, rerender } = renderHook(({ id }) => useSession(id, { flowKind: "demo" }), { initialProps: { id: "sess1" } });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    const first = connections.at(-1)!;
    act(() => first.callbacks.onEvent?.({ stream: "request", requestId: "req_turn", sequence_number: 4, ts: 1000, type: "item.added" }));
    rerender({ id: "sess2" });
    rerender({ id: "sess1" });
    await act(async () => {
      await Promise.resolve();
    });

    // The session change cleared the view's request state, so the request replays it from the start.
    act(() => result.current.followRequest("req_turn"));
    expect((connections.at(-1)!.callbacks as { startingAfter?: number }).startingAfter).toBeUndefined();
  });

  it("followed again after it ended, streams from the start", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    const first = connections.at(-1)!;
    act(() => first.callbacks.onEvent?.({ stream: "request", requestId: "req_turn", sequence_number: 9, ts: 1000, type: "request.completed" }));
    act(() => first.callbacks.onRequestStatus?.({ stream: "request", requestId: "req_turn", sequence_number: 9, ts: 1000, type: "request.completed", status: "completed" }));

    // Past its end there is nothing to stream, so the view would never settle.
    act(() => result.current.followRequest("req_turn"));
    expect((connections.at(-1)!.callbacks as { startingAfter?: number }).startingAfter).toBeUndefined();
  });

  it("followed again from the start and dropped before its first event, streams from the start", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    const first = connections.at(-1)!;
    act(() => first.callbacks.onEvent?.({ stream: "request", requestId: "req_turn", sequence_number: 9, ts: 1000, type: "request.completed" }));
    act(() => first.callbacks.onRequestStatus?.({ stream: "request", requestId: "req_turn", sequence_number: 9, ts: 1000, type: "request.completed", status: "completed" }));
    act(() => result.current.followRequest("req_turn"));
    act(() => connections.at(-1)!.callbacks.onError?.(new Error("dropped")));

    // The first stream's end is not where this one dropped.
    act(() => result.current.followRequest("req_turn"));
    expect((connections.at(-1)!.callbacks as { startingAfter?: number }).startingAfter).toBeUndefined();
  });

  it("does not follow a request the person stopped", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    await act(async () => {
      await result.current.abortRequest();
    });
    const opened = connections.length;

    // The server may list it as running until its worker sees the stop.
    let followed = true;
    act(() => {
      followed = result.current.followRequest("req_turn");
    });
    expect(followed).toBe(false);
    expect(connections.length).toBe(opened);
    expect(result.current.isStreaming).toBe(false);
  });

  it("does not follow a request the person dismissed", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    act(() => connections.at(-1)!.callbacks.onError?.(new Error("dropped")));
    await act(async () => {
      await result.current.dismissRequest();
    });
    const opened = connections.length;

    let followed = true;
    act(() => {
      followed = result.current.followRequest("req_turn");
    });
    expect(followed).toBe(false);
    expect(connections.length).toBe(opened);
  });

  it("makes the followed request the one a stop reaches", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_line"));
    await act(async () => {
      await result.current.abortRequest();
    });

    expect(flowMock.abort).toHaveBeenCalledWith("req_line");
  });

  it("keeps the request followed while a stop was out: the stop closes only the request it stopped", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });
    let answerStop: () => void = () => undefined;
    flowMock.abort.mockImplementation(() => new Promise<void>((resolve) => (answerStop = resolve)));

    act(() => result.current.followRequest("req_turn"));
    let stopped: Promise<void> = Promise.resolve();
    act(() => {
      stopped = result.current.abortRequest();
    });
    // The stopped turn ends before the stop's answer lands, and the page follows the next one.
    act(() => result.current.followRequest("req_line"));
    const line = connections.at(-1)!;
    await act(async () => {
      answerStop();
      await stopped;
    });

    expect(line.url).toContain("/requests/req_line/stream");
    expect(line.closed).toBe(false);
    expect(result.current.isStreaming).toBe(true);
    // A stop now reaches the line.
    flowMock.abort.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.abortRequest();
    });
    expect(flowMock.abort).toHaveBeenLastCalledWith("req_line");
  });
});
