/**
 * Tests for the DevTool `useRequestStream` hook after its port onto the shared
 * `@flow-state-dev/client` store + `bindStoreToCallbacks`. Drives the captured
 * SSE callbacks directly (replicating the client's event dispatcher) and uses
 * fake timers to control the RAF flush, asserting: item/content changes
 * coalesce on a frame while status changes flush immediately, message AND
 * reasoning content accumulate, the resume cursor (statusEvents +
 * lastSequenceNumber) is tracked, and a reconnectToken bump re-subscribes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Captured connections so tests can drive events and assert close()/re-subscribe.
const { connections } = vi.hoisted(() => ({
  connections: [] as Array<{ callbacks: Record<string, ((e: unknown) => void) | undefined>; closed: boolean; flowKind: string; requestId: string }>,
}));

vi.mock("../src/react/lib/client", () => ({
  connectRequestStream: (
    flowKind: string,
    requestId: string,
    callbacks: Record<string, ((e: unknown) => void) | undefined>,
  ) => {
    const rec = { callbacks, closed: false, flowKind, requestId };
    connections.push(rec);
    return { close() { rec.closed = true; }, get lastEventId() { return undefined; } };
  },
}));

vi.mock("../src/react/context/devtool-context", () => ({
  // The real context always carries `config`; the stream hook reads
  // `config.bearerToken` to forward a bearer on the SSE request.
  useDevTool: () => ({ baseUrl: undefined, config: { userId: "devuser" } }),
}));

import { useRequestStream } from "../src/react/hooks/use-request-stream";

let seq = 0;
function base() {
  return { stream: "request", requestId: "req_1", sequence_number: ++seq, ts: Date.now() };
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
function contentDelta(itemId: string, contentIndex: number, delta: string) {
  return { ...base(), type: "content.delta", itemId, contentIndex, delta };
}
function makeMessage(id: string, text: string) {
  return {
    id,
    type: "message",
    status: "in_progress",
    requestId: "req_1",
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
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    summary: [{ type: "reasoning_text", text }],
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
    case "item.updated": cb.onItemUpdated?.(event); break;
    case "content.added": cb.onContentAdded?.(event); break;
    case "content.delta": cb.onContentDelta?.(event); break;
    case "content.done": cb.onContentDone?.(event); break;
  }
}

describe("useRequestStream (devtool)", () => {
  beforeEach(() => {
    connections.length = 0;
    seq = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces item/content flushes on a RAF — streamed text appears after the frame", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", requestId: "req_1", enabled: true }),
    );

    act(() => { feed(requestCreated()); });
    act(() => {
      feed(itemAdded(makeMessage("m", "")));
      feed(contentDelta("m", 0, "Hel"));
      feed(contentDelta("m", 0, "lo"));
    });

    // RAF hasn't fired yet: the item is in the store but not flushed to React,
    // and the deltas are still buffered.
    expect(result.current.items.length).toBe(0);

    act(() => { vi.runAllTimers(); });

    expect(result.current.items.length).toBe(1);
    expect((result.current.items[0] as { content: { text: string }[] }).content[0]!.text).toBe("Hello");
  });

  it("flushes status transitions immediately (no RAF needed)", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", requestId: "req_1", enabled: true }),
    );

    expect(result.current.streamStatus).toBe("connecting");
    act(() => { feed(requestCreated()); });
    expect(result.current.streamStatus).toBe("streaming");
    act(() => { feed(requestStatus("request.completed", "completed")); });
    expect(result.current.streamStatus).toBe("completed");
  });

  it("derives StreamStatus from the store's RequestStatus for terminal states", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", requestId: "req_1", enabled: true }),
    );
    act(() => { feed(requestCreated()); });

    act(() => { feed(requestStatus("request.suspended", "suspended")); });
    expect(result.current.streamStatus).toBe("completed");
    act(() => { feed(requestStatus("request.failed", "failed")); });
    expect(result.current.streamStatus).toBe("failed");
    act(() => { feed(requestStatus("request.interrupted", "interrupted")); });
    expect(result.current.streamStatus).toBe("disconnected");
  });

  it("accumulates reasoning content (summary array), not just message content", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", requestId: "req_1", enabled: true }),
    );
    act(() => { feed(requestCreated()); });
    act(() => {
      feed(itemAdded(makeReasoning("r", "")));
      feed(contentDelta("r", 0, "thinking"));
    });
    act(() => { vi.runAllTimers(); });

    expect((result.current.items[0] as { summary: { text: string }[] }).summary[0]!.text).toBe("thinking");
  });

  it("tracks the resume cursor — lastSequenceNumber and the status-event log", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", requestId: "req_1", enabled: true }),
    );
    act(() => {
      feed(requestCreated());                                  // seq 1 (not recorded — created)
      feed(itemAdded(makeMessage("m", "hi")));                 // seq 2
      feed(requestStatus("request.completed", "completed"));   // seq 3
    });
    act(() => { vi.runAllTimers(); });

    expect(result.current.lastSequenceNumber).toBe(3);
    // request.created is not a recorded status event; only request.* status frames are.
    expect(result.current.streamState?.statusEvents.map((e) => e.type)).toEqual(["request.completed"]);
  });

  it("surfaces transport errors as the disconnected status", () => {
    const { result } = renderHook(() =>
      useRequestStream({ flowKind: "demo", requestId: "req_1", enabled: true }),
    );
    act(() => {
      (connections[connections.length - 1]!.callbacks.onError as (e: unknown) => void)(new Error("boom"));
    });
    expect(result.current.streamStatus).toBe("disconnected");
    expect(result.current.error).toBe("boom");
  });

  it("re-subscribes and resets the store when reconnectToken is bumped", () => {
    const { result, rerender } = renderHook(
      ({ token }: { token: number }) =>
        useRequestStream({ flowKind: "demo", requestId: "req_1", enabled: true, reconnectToken: token }),
      { initialProps: { token: 0 } },
    );

    act(() => { feed(itemAdded(makeMessage("m", "hi"))); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.items.length).toBe(1);
    expect(connections.length).toBe(1);

    act(() => { rerender({ token: 1 }); });

    // Old wire closed, a fresh subscription opened, and the store was cleared.
    expect(connections.length).toBe(2);
    expect(connections[0]!.closed).toBe(true);
    expect(result.current.items.length).toBe(0);
  });
});
