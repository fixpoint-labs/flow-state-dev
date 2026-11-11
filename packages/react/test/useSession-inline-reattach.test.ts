// @vitest-environment happy-dom
/**
 * A turn's inline stream (the SSE body of its POST) can end before the turn
 * does: the engine cuts off a reader that falls too far behind, with no
 * terminal event, and expects it to resume from its last event. `useSession`
 * picks the turn up again on the request's own stream from the last event it
 * applied, so the view finishes the turn instead of hanging as "streaming".
 *
 * The transport is mocked the way `useSession-stop.test.ts` does: the hook's
 * callbacks are handed to the test, which feeds events and ends the stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

type Connection = {
  kind: "inline" | "request";
  options: Record<string, unknown>;
  callbacks: Record<string, ((e?: unknown) => void) | undefined>;
  closed: boolean;
};

const { connections, sessionsMock, flowMock } = vi.hoisted(() => ({
  connections: [] as Connection[],
  sessionsMock: { get: vi.fn(), state: vi.fn(), requests: vi.fn() },
  flowMock: { send: vi.fn(), abort: vi.fn() }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  const open = (kind: Connection["kind"]) => (options: Record<string, unknown>) => {
    const rec: Connection = {
      kind,
      options,
      callbacks: options as Connection["callbacks"],
      closed: false
    };
    connections.push(rec);
    return { close() { rec.closed = true; }, get lastEventId() { return undefined; } };
  };
  return {
    ...actual,
    createSSEClientFromResponse: open("inline"),
    createClient: () =>
      fakeClient({ sessions: { ...sessionsMock }, flow: flowMock, requestStream: open("request") })
  };
});

import { useSession } from "../src/hooks/useSession";

let seq = 0;
function event(requestId: string, type: string, extra: Record<string, unknown> = {}) {
  return { stream: "request", requestId, sequence_number: ++seq, ts: 1000 + seq, type, ...extra };
}
function message(id: string, requestId: string, itemIndex: number, text: string) {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    requestId,
    itemIndex,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000 + itemIndex,
    content: [{ type: "output_text", text }]
  };
}

/** Replicate the client's dispatch: onEvent, then the typed callback. */
function feed(connection: Connection, e: ReturnType<typeof event>) {
  connection.callbacks.onEvent?.(e);
  if (e.type === "item.done") connection.callbacks.onItemDone?.(e);
  else if (e.type.startsWith("request.")) connection.callbacks.onRequestStatus?.(e);
}

function sseResponse(): Response {
  return {
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: { cancel: vi.fn(() => Promise.resolve()) }
  } as unknown as Response;
}

describe("useSession: a turn's inline stream that ends before the turn does", () => {
  beforeEach(() => {
    connections.length = 0;
    seq = 0;
    vi.resetAllMocks();
    sessionsMock.get.mockResolvedValue({ id: "sess1", flowKind: "demo", userId: "devuser", createdAt: 0, updatedAt: 0 });
    sessionsMock.state.mockResolvedValue({
      sessionId: "sess1",
      flowKind: "demo",
      clientData: {},
      items: [],
      pagination: { offset: 0, limit: 100, total: 0, hasMore: false, nextOffset: 0 }
    });
    sessionsMock.requests.mockResolvedValue([]);
    flowMock.send.mockResolvedValue(sseResponse());
  });

  afterEach(() => {
    cleanup();
  });

  it("resumes on the request's stream after the last event it applied, and finishes the turn with every item once", async () => {
    const hook = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    await act(async () => {
      await hook.result.current.sendAction("turn", { prompt: "go" });
    });
    const requestId = (flowMock.send.mock.calls[0]![2] as { requestId: string }).requestId;
    const inline = connections[0]!;
    expect(inline.kind).toBe("inline");

    // The inline stream delivers part of the turn, then the server cuts it off
    // with no terminal event.
    act(() => {
      feed(inline, event(requestId, "request.in_progress", { status: "in_progress" }));
      feed(inline, event(requestId, "item.done", { item: message("m1", requestId, 1, "first") }));
    });
    const lastApplied = seq;
    act(() => {
      inline.callbacks.onClose?.();
    });

    // The hook follows the request again from where the inline stream stopped.
    const resumed = connections[1];
    expect(resumed?.kind).toBe("request");
    expect(resumed?.options.startingAfter).toBe(lastApplied);
    expect(hook.result.current.isStreaming).toBe(true);

    act(() => {
      feed(resumed!, event(requestId, "item.done", { item: message("m2", requestId, 2, "second") }));
      feed(resumed!, event(requestId, "request.completed", { status: "completed" }));
    });

    expect(hook.result.current.isStreaming).toBe(false);
    expect(hook.result.current.isStuck).toBe(false);
    const ids = hook.result.current.items.filter((i) => i.requestId === requestId).map((i) => i.id);
    expect(ids.filter((id) => id === "m1")).toHaveLength(1);
    expect(ids.filter((id) => id === "m2")).toHaveLength(1);
  });

  it("does not resume a turn the caller stopped", async () => {
    flowMock.abort.mockResolvedValue(undefined);
    const hook = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    await act(async () => {
      await hook.result.current.sendAction("turn", { prompt: "go" });
    });
    const inline = connections[0]!;
    await act(async () => {
      await hook.result.current.abortRequest();
    });
    // A late close from the stopped stream changes nothing.
    act(() => {
      inline.callbacks.onClose?.();
    });

    expect(connections).toHaveLength(1);
    expect(hook.result.current.isStreaming).toBe(false);
  });
});
