// @vitest-environment happy-dom
/**
 * Behavioral tests for the react `useRequestStream` hook after its port onto the
 * shared `@flow-state-dev/client` store + `bindStoreToCallbacks`. The transport
 * (`createSSEClient` / `createSSEClientFromResponse`) is mocked to capture the
 * callbacks so the test drives events directly (replicating the client's event
 * dispatcher). The first test is the regression guard for the "no streaming
 * text" bug: with the old hand-rolled reducer it failed (deltas were dropped).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  return { ...actual, createSSEClient: make, createSSEClientFromResponse: make };
});

import { useRequestStream } from "../src/hooks/useRequestStream";
import { setFlowContext } from "../src/context/FlowContext";

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
    setFlowContext({});
  });
  afterEach(() => {
    // Unmount rendered hooks (mirrors the devtool suite's setup) so each test's
    // effect cleanup runs — closes the SSE handle and cancels pending RAFs.
    cleanup();
    setFlowContext({});
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
    expect(result.current.messages[0]?.content[0]?.text).toBe("Hello");
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
      expect(result.current.messages[0]?.content[0]?.text).toBe("Hi");
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes a pre-fetched Response via the { response } source (no flowKind needed)", () => {
    const { result } = renderHook(() =>
      useRequestStream({ source: { response: {} as Response }, flush: "immediate" }),
    );
    act(() => {
      feed(itemAdded(makeMessage("m", "")));
      feed(contentDelta("m", 0, "yo"));
    });
    expect(result.current.messages[0]?.content[0]?.text).toBe("yo");
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
});
