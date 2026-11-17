// @vitest-environment happy-dom
/**
 * Behavioral tests for the react `useRequestStream` hook after its port onto the
 * shared `@flow-state-dev/client` store + `bindStoreToCallbacks`. The transport
 * (a request's `stream()` on the client / `createSSEClientFromResponse`) is
 * mocked to capture the callbacks so the test drives events directly
 * (replicating the client's event dispatcher). The first test is the regression guard for the "no streaming
 * text" bug: with the old hand-rolled reducer it failed (deltas were dropped).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Content } from "@flow-state-dev/core/items";
import { renderHook, act, cleanup } from "@testing-library/react";

// Capture the callbacks handed to the transport so the test can drive events.
const { connections } = vi.hoisted(() => ({
  connections: [] as Array<{ callbacks: Record<string, ((e: unknown) => void) | undefined>; closed: boolean }>,
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const make = (options: Record<string, ((e: unknown) => void) | undefined>) => {
    const rec = { callbacks: options, closed: false };
    connections.push(rec);
    return { close() { rec.closed = true; }, get lastEventId() { return undefined; } };
  };
  const { fakeClient } = await import("./support/fake-client");
  return {
    ...actual,
    createClient: () => fakeClient({ requestStream: make as never }),
    createSSEClientFromResponse: make
  };
});

import { useRequestStream } from "../src/hooks/useRequestStream";

function firstText(message: { content: readonly Content[] } | undefined): string | undefined {
  const part = message?.content[0];
  return part !== undefined && "text" in part ? part.text : undefined;
}

let seq = 0;
function base() {
  return { stream: "request", requestId: "r1", sequence_number: ++seq, ts: Date.now() };
}
function requestCreated() {
  return { ...base(), type: "request.created", status: "in_progress" };
}
function requestStatus(type: string, status: string) {
  return { ...base(), type, status };
}
function itemAdded(item: unknown) {
  return { ...base(), type: "item.added", item };
}
function itemDone(item: unknown) {
  return { ...base(), type: "item.done", item };
}
function contentDelta(itemId: string, contentIndex: number, delta: string) {
  return { ...base(), type: "content.delta", itemId, contentIndex, delta };
}
function sessionMetadataChanged() {
  return { ...base(), type: "session.metadata.changed" };
}
function makeMessage(id: string, text: string) {
  return {
    id,
    type: "message",
    status: "in_progress",
    requestId: "r1",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    content: [{ type: "output_text", text }],
  };
}
function makeReasoning(id: string, text: string) {
  return {
    id,
    type: "reasoning",
    status: "in_progress",
    requestId: "r1",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    summary: [{ type: "reasoning_text", text }],
  };
}
function makeStatus(id: string, blocked: boolean) {
  return {
    id,
    type: "status",
    requestId: "r1",
    itemIndex: 1,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 2000,
    blocked,
    message: "working",
  };
}

/** Replicate the client's `dispatchRequestEvent`: onEvent, then the typed callback. */
function feed(event: { type: string } & Record<string, unknown>) {
  const cb = connections[connections.length - 1]!.callbacks;
  cb.onEvent?.(event);
  switch (event.type) {
    case "request.created": cb.onRequestCreated?.(event); break;
    case "request.in_progress":
    case "request.completed":
    case "request.incomplete":
    case "request.failed":
    case "request.suspended":
    case "request.interrupted":
    case "request.aborted": cb.onRequestStatus?.(event); break;
    case "item.added": cb.onItemAdded?.(event); break;
    case "item.done": cb.onItemDone?.(event); break;
    case "content.delta": cb.onContentDelta?.(event); break;
    case "session.metadata.changed": cb.onSessionMetadataChanged?.(event); break;
  }
}

describe("useRequestStream (react)", () => {
  beforeEach(() => {
    connections.length = 0;
    seq = 0;
  });
  afterEach(() => {
    // Unmount rendered hooks (mirrors the devtool suite's setup) so each test's
    // effect cleanup runs — closes the SSE handle and cancels pending RAFs.
    cleanup();
  });

  it("accumulates streamed message text mid-stream, before item.done (FIX-846 regression)", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate" }),
    );

    act(() => {
      feed(requestCreated());
      feed(itemAdded(makeMessage("m", "")));
      feed(contentDelta("m", 0, "Hel"));
      feed(contentDelta("m", 0, "lo"));
    });

    // The deltas are visible before any item.done / terminal event.
    expect(firstText(result.current.messages[0])).toBe("Hello");
  });

  it("coalesces deltas on a RAF in the default flush mode", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useRequestStream({ flowKind: "demo", source: { requestId: "r1" } }),
      );
      act(() => {
        feed(itemAdded(makeMessage("m", "")));
        feed(contentDelta("m", 0, "Hi"));
      });
      // RAF hasn't fired yet — nothing flushed to React.
      expect(result.current.items.length).toBe(0);
      act(() => { vi.runAllTimers(); });
      expect(firstText(result.current.messages[0])).toBe("Hi");
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes a pre-fetched Response via the { response } source (no flowKind needed)", () => {
    // Hoist the Response so its identity is stable across renders — a fresh
    // object each render would (correctly) re-subscribe every render.
    const response = {} as Response;
    const { result } = renderHook(() =>
      useRequestStream({ source: { response }, flush: "immediate" }),
    );
    act(() => {
      feed(itemAdded(makeMessage("m", "")));
      feed(contentDelta("m", 0, "yo"));
    });
    expect(firstText(result.current.messages[0])).toBe("yo");
  });

  it("accumulates reasoning summary content, not just message content", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate" }),
    );
    act(() => {
      feed(itemAdded(makeReasoning("r", "")));
      feed(contentDelta("r", 0, "thinking"));
    });
    const reasoning = result.current.items.find((i) => i.type === "reasoning") as { summary: { text: string }[] };
    expect(reasoning.summary[0]!.text).toBe("thinking");
  });

  it("derives status, isStreaming, and isFinishing from the stream", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate" }),
    );

    expect(result.current.status).toBe("in_progress");
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.isFinishing).toBe(false);

    // An unblocked status item means the main chain is done but work is running.
    act(() => {
      feed(requestCreated());
      feed(itemAdded(makeStatus("s", false)));
    });
    expect(result.current.isFinishing).toBe(true);
    expect(result.current.currentStatus?.id).toBe("s");

    act(() => { feed(requestStatus("request.completed", "completed")); });
    expect(result.current.status).toBe("completed");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isFinishing).toBe(false);
  });

  it("gates items by the type filter", () => {
    const { result } = renderHook(() =>
      useRequestStream({
        flowKind: "demo",
        source: { requestId: "r1" },
        filter: { itemTypes: ["message"] },
        flush: "immediate",
      }),
    );
    act(() => {
      feed(itemAdded(makeStatus("s", true)));
      feed(itemAdded(makeMessage("m", "hi")));
    });
    expect(result.current.items.map((i) => i.type)).toEqual(["message"]);
  });

  it("forwards session metadata changes to the callback", () => {
    const onSessionMetadataChanged = vi.fn();
    renderHook(() =>
      useRequestStream({
        flowKind: "demo",
        source: { requestId: "r1" },
        flush: "immediate",
        onSessionMetadataChanged,
      }),
    );
    act(() => { feed(sessionMetadataChanged()); });
    expect(onSessionMetadataChanged).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes and resets when reconnectToken is bumped", () => {
    const { result, rerender } = renderHook(
      ({ token }: { token: number }) =>
        useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate", reconnectToken: token }),
      { initialProps: { token: 0 } },
    );
    act(() => {
      feed(itemAdded(makeMessage("m", "hi")));
      feed(itemDone(makeMessage("m", "hi")));
    });
    expect(result.current.items.length).toBe(1);
    expect(connections.length).toBe(1);

    act(() => { rerender({ token: 1 }); });

    expect(connections.length).toBe(2);
    expect(connections[0]!.closed).toBe(true);
    expect(result.current.items.length).toBe(0);
  });

  it("keeps its stream open across a re-render with the same inputs", () => {
    // The hook's client is memoized on its transport: a client rebuilt each
    // render would close and re-open the stream every render.
    const { rerender } = renderHook(
      ({ label }: { label: string }) =>
        useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate", filter: undefined, enabled: label.length > 0 }),
      { initialProps: { label: "a" } },
    );
    act(() => { rerender({ label: "b" }); });
    act(() => { rerender({ label: "c" }); });

    expect(connections.length).toBe(1);
    expect(connections[0]!.closed).toBe(false);
  });

  it("opens no connection when initially disabled", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate", enabled: false }),
    );
    expect(connections.length).toBe(0);
    expect(result.current.isStreaming).toBe(false);
  });

  it("is not streaming and preserves items when disabled", () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate", enabled }),
      { initialProps: { enabled: true } },
    );
    act(() => {
      feed(requestCreated());
      feed(itemAdded(makeMessage("m", "hi")));
    });
    expect(result.current.items.length).toBe(1);
    expect(result.current.isStreaming).toBe(true);

    act(() => { rerender({ enabled: false }); });

    // Disabling stops streaming without discarding what already streamed.
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.items.length).toBe(1);
    expect(connections[0]!.closed).toBe(true);
  });

  it("stops streaming when close() is called", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate" }),
    );
    act(() => { feed(requestCreated()); });
    expect(result.current.isStreaming).toBe(true);
    act(() => { result.current.close(); });
    expect(result.current.isStreaming).toBe(false);
    expect(connections[0]!.closed).toBe(true);
  });

  it("opens nothing and asks for no flow while disabled", () => {
    const { result } = renderHook(() => useRequestStream({ source: { requestId: "" }, enabled: false }));
    expect(connections).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
  });

  it("streams through the client it is handed, not the provider's", async () => {
    const { fakeClient } = await import("./support/fake-client");
    const own: Array<{ url: string }> = [];
    const client = fakeClient({
      requestStream: ((options: { url: string }) => {
        own.push(options);
        return { close() {}, lastEventId: undefined };
      }) as never,
    });
    renderHook(() => useRequestStream({ client, flowKind: "demo", source: { requestId: "r1" }, flush: "immediate" }));
    expect(own).toHaveLength(1);
    expect(own[0]!.url).toContain("/demo/requests/r1/stream");
    expect(connections).toEqual([]);
  });

  describe("with reconnect", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const open = () =>
      renderHook(() => useRequestStream({ flowKind: "demo", source: { requestId: "r1" }, flush: "immediate", reconnect: true }));
    const drop = (status?: number) => act(() => connections[connections.length - 1]!.callbacks.onError?.(Object.assign(new Error("dropped"), status === undefined ? {} : { status })));

    it("opens a dropped stream again after a backoff, resuming after the last event it heard, keeping what it showed", () => {
      const { result } = open();
      act(() => {
        feed(requestCreated());
        feed(itemAdded(makeMessage("m", "hi")));
      });
      const heard = seq;
      drop();
      expect(connections[0]!.closed).toBe(true);
      expect(result.current.isStreaming).toBe(true);
      act(() => { vi.advanceTimersByTime(999); });
      expect(connections).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(1); });
      expect(connections).toHaveLength(2);
      expect(connections[1]!.callbacks.startingAfter).toBe(heard);
      expect(result.current.items).toHaveLength(1);
    });

    it("waits twice as long after each drop that heard nothing", () => {
      open();
      drop();
      act(() => { vi.advanceTimersByTime(1_000); });
      drop();
      act(() => { vi.advanceTimersByTime(1_999); });
      expect(connections).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(1); });
      expect(connections).toHaveLength(3);
    });

    it("ends on an answer that says the request is not there for this caller", () => {
      const { result } = open();
      drop(404);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(connections).toHaveLength(1);
      expect(result.current.isStreaming).toBe(false);
    });

    it("opens nothing more once close() is called while it waits to reconnect", () => {
      const { result } = open();
      act(() => { feed(requestCreated()); });
      drop();
      act(() => { result.current.close(); });
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(connections).toHaveLength(1);
      expect(result.current.isStreaming).toBe(false);
    });

    it("ends once the request has ended, and opens nothing after unmount", () => {
      const first = open();
      act(() => { feed(requestStatus("request.completed", "completed")); });
      drop();
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(connections).toHaveLength(1);
      first.unmount();
      const second = open();
      drop();
      second.unmount();
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(connections).toHaveLength(2);
    });
  });
});
