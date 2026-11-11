import { describe, expect, it, vi } from "vitest";
import {
  createClient,
  createSSEClientFromResponse,
  type ClientFetch,
  type RequestStreamOptions
} from "../src";

/** A request's stream, opened through one client's `request(id).stream()`. */
function requestStream({ url, fetcher, ...options }: RequestStreamOptions & { url: string; fetcher: ClientFetch }) {
  const [, flow, id] = /\/api\/flows\/([^/]+)\/requests\/([^/]+)\/stream/.exec(url)!;
  return createClient({ userId: "devuser", baseUrl: "", fetcher }).flow(flow!).request(id!).stream(options);
}

function requestEventFrame(options: {
  id: string;
  event: string;
  data: Record<string, unknown>;
}): string {
  return `id: ${options.id}\nevent: ${options.event}\ndata: ${JSON.stringify(options.data)}\n\n`;
}

async function flushSSE(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("request.stream", () => {
  it("parses request stream events, dedupes by sequence, and tracks lastEventId", async () => {
    const onRequestCreated = vi.fn();
    const onItemAdded = vi.fn();
    const onRequestStatus = vi.fn();

    const streamBody = [
      requestEventFrame({
        id: "req_1:1",
        event: "request.created",
        data: {
          stream: "request",
          type: "request.created",
          requestId: "req_1",
          sequence_number: 1,
          status: "in_progress",
          ts: 1
        }
      }),
      requestEventFrame({
        id: "req_1:2",
        event: "item.added",
        data: {
          stream: "request",
          type: "item.added",
          requestId: "req_1",
          sequence_number: 2,
          ts: 2,
          item: {
            id: "item_1",
            type: "status",
            status: "in_progress",
            requestId: "req_1",
            itemIndex: 0,
            provenance: {
              blockName: "runtime",
              blockInstanceId: "runtime",
              phase: "main"
            },
            ts: 2,
            message: "working"
          }
        }
      }),
      // Duplicate sequence_number should be ignored.
      requestEventFrame({
        id: "req_1:2",
        event: "item.added",
        data: {
          stream: "request",
          type: "item.added",
          requestId: "req_1",
          sequence_number: 2,
          ts: 3,
          item: {
            id: "item_dup",
            type: "status",
            status: "in_progress",
            requestId: "req_1",
            itemIndex: 1,
            provenance: {
              blockName: "runtime",
              blockInstanceId: "runtime",
              phase: "main"
            },
            ts: 3,
            message: "duplicate"
          }
        }
      }),
      requestEventFrame({
        id: "req_1:3",
        event: "request.completed",
        data: {
          stream: "request",
          type: "request.completed",
          requestId: "req_1",
          sequence_number: 3,
          status: "completed",
          ts: 4
        }
      })
    ].join("");

    const fetcher = vi.fn<ClientFetch>(async (_url, init) => {
      expect(init?.headers).toMatchObject({
        accept: "text/event-stream",
        "last-event-id": "req_1:0"
      });

      return new Response(streamBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      });
    });

    const handle = requestStream({
      url: "/api/flows/demo/requests/req_1/stream",
      lastEventId: "req_1:0",
      fetcher,
      onRequestCreated,
      onItemAdded,
      onRequestStatus
    });

    await flushSSE();

    expect(onRequestCreated).toHaveBeenCalledTimes(1);
    expect(onItemAdded).toHaveBeenCalledTimes(1);
    expect(onRequestStatus).toHaveBeenCalledTimes(1);
    expect(handle.lastEventId).toBe("req_1:3");

    handle.close();
  });

  it("routes request.suspended to onRequestStatus (FIX-811)", async () => {
    // Regression: a same-request suspend emits `request.suspended` over the
    // wire; if the dispatcher drops it, the client never leaves "in progress"
    // and a HITL gate can't surface for resume.
    const onRequestStatus = vi.fn();
    const streamBody = [
      requestEventFrame({
        id: "req_s:1",
        event: "request.created",
        data: {
          stream: "request",
          type: "request.created",
          requestId: "req_s",
          sequence_number: 1,
          status: "in_progress",
          ts: 1
        }
      }),
      requestEventFrame({
        id: "req_s:2",
        event: "request.suspended",
        data: {
          stream: "request",
          type: "request.suspended",
          requestId: "req_s",
          sequence_number: 2,
          status: "suspended",
          ts: 2
        }
      })
    ].join("");

    const fetcher = vi.fn<ClientFetch>(
      async () =>
        new Response(streamBody, {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        })
    );

    const handle = requestStream({
      url: "/api/flows/demo/requests/req_s/stream",
      fetcher,
      onRequestStatus
    });

    await flushSSE();

    expect(onRequestStatus).toHaveBeenCalledTimes(1);
    expect(onRequestStatus.mock.calls[0]![0]).toMatchObject({
      type: "request.suspended",
      status: "suspended"
    });

    handle.close();
  });

  it("evicts old dedup keys outside the configured sliding window", async () => {
    const onItemAdded = vi.fn();

    const streamBody = [
      requestEventFrame({
        id: "req_1:1",
        event: "item.added",
        data: {
          stream: "request",
          type: "item.added",
          requestId: "req_1",
          sequence_number: 1,
          ts: 1,
          item: {
            id: "item_1",
            type: "status",
            status: "in_progress",
            requestId: "req_1",
            itemIndex: 0,
            provenance: {
              blockName: "runtime",
              blockInstanceId: "runtime",
              phase: "main"
            },
            ts: 1,
            message: "one"
          }
        }
      }),
      requestEventFrame({
        id: "req_1:2",
        event: "item.added",
        data: {
          stream: "request",
          type: "item.added",
          requestId: "req_1",
          sequence_number: 2,
          ts: 2,
          item: {
            id: "item_2",
            type: "status",
            status: "in_progress",
            requestId: "req_1",
            itemIndex: 1,
            provenance: {
              blockName: "runtime",
              blockInstanceId: "runtime",
              phase: "main"
            },
            ts: 2,
            message: "two"
          }
        }
      }),
      requestEventFrame({
        id: "req_1:1",
        event: "item.added",
        data: {
          stream: "request",
          type: "item.added",
          requestId: "req_1",
          sequence_number: 1,
          ts: 3,
          item: {
            id: "item_1_replayed",
            type: "status",
            status: "in_progress",
            requestId: "req_1",
            itemIndex: 2,
            provenance: {
              blockName: "runtime",
              blockInstanceId: "runtime",
              phase: "main"
            },
            ts: 3,
            message: "one replayed"
          }
        }
      })
    ].join("");

    // The body ends with no terminal status, so the stream resumes after its
    // last event: answer that as a server would, with nothing older.
    const fetcher = vi.fn<ClientFetch>(async (url) =>
      new Response(String(url).includes("starting_after") ? "" : streamBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    );

    const handle = requestStream({
      url: "/api/flows/demo/requests/req_1/stream",
      fetcher,
      dedupWindowSize: 1,
      onItemAdded
    });

    await flushSSE();

    expect(onItemAdded).toHaveBeenCalledTimes(3);

    handle.close();
  });

  it("prefers starting_after query over last-event-id header when both are provided", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      new Response("", {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    );

    const handle = requestStream({
      url: "/api/flows/demo/requests/req_1/stream",
      lastEventId: "req_1:9",
      startingAfter: 5,
      fetcher
    });

    await flushSSE();

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/demo/requests/req_1/stream?starting_after=5"
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      accept: "text/event-stream"
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toMatchObject({
      "last-event-id": "req_1:9"
    });

    handle.close();
  });

  it("dispatches item.updated events to the onItemUpdated callback", async () => {
    const onItemUpdated = vi.fn();

    const streamBody = requestEventFrame({
      id: "req_u:1",
      event: "item.updated",
      data: {
        stream: "request",
        type: "item.updated",
        requestId: "req_u",
        sequence_number: 1,
        ts: 1,
        itemId: "item_x",
        patch: { status: "completed" }
      }
    });

    const fetcher = vi.fn<ClientFetch>(async () =>
      new Response(streamBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    );

    const handle = requestStream({
      url: "/api/flows/demo/requests/req_u/stream",
      fetcher,
      onItemUpdated
    });

    await flushSSE();

    expect(onItemUpdated).toHaveBeenCalledTimes(1);
    expect(onItemUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item.updated",
        itemId: "item_x",
        patch: { status: "completed" }
      })
    );

    handle.close();
  });
});

describe("request.streamFromResponse", () => {
  it("consumes SSE events from a Response body", async () => {
    const onRequestCreated = vi.fn();
    const onRequestStatus = vi.fn();

    const streamBody = [
      requestEventFrame({
        id: "req_1:1",
        event: "request.created",
        data: {
          stream: "request",
          type: "request.created",
          requestId: "req_1",
          sequence_number: 1,
          status: "in_progress",
          ts: 1
        }
      }),
      requestEventFrame({
        id: "req_1:2",
        event: "request.completed",
        data: {
          stream: "request",
          type: "request.completed",
          requestId: "req_1",
          sequence_number: 2,
          status: "completed",
          ts: 2
        }
      })
    ].join("");

    const response = new Response(streamBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });

    const handle = createSSEClientFromResponse({
      response,
      onRequestCreated,
      onRequestStatus
    });

    await flushSSE();

    expect(onRequestCreated).toHaveBeenCalledTimes(1);
    expect(onRequestStatus).toHaveBeenCalledTimes(1);
    expect(handle.lastEventId).toBe("req_1:2");

    handle.close();
  });

  it("calls onError for non-ok responses without consuming the body", async () => {
    const onError = vi.fn();

    const response = new Response("not found", {
      status: 404,
      statusText: "Not Found"
    });

    const handle = createSSEClientFromResponse({ response, onError });

    await flushSSE();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain("404");

    handle.close();
  });

  it("closes cleanly when handle.close() is called", async () => {
    const body = new ReadableStream({
      start() {
        // Never closes — simulates long-lived SSE
      }
    });

    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });

    const handle = createSSEClientFromResponse({ response });
    handle.close();

    // Should not throw
  });

  it("fires onClose when the body ends without a terminal request-status event", async () => {
    // e.g. a pre-transition recovery failure: the server closes the
    // connection without ever emitting request.completed/failed.
    const onRequestStatus = vi.fn();
    const onClose = vi.fn();

    const response = new Response("", {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });

    const handle = createSSEClientFromResponse({ response, onRequestStatus, onClose });
    await flushSSE();

    expect(onRequestStatus).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();

    handle.close();
  });

  it("does not fire onClose when the stream errors", async () => {
    const onError = vi.fn();
    const onClose = vi.fn();

    const response = new Response("not found", {
      status: 404,
      statusText: "Not Found"
    });

    const handle = createSSEClientFromResponse({ response, onError, onClose });
    await flushSSE();

    expect(onError).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    handle.close();
  });

  it("does not fire onClose after a local handle.close()", async () => {
    const onClose = vi.fn();
    const body = new ReadableStream({
      start() {
        // Never closes — simulates long-lived SSE
      }
    });

    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });

    const handle = createSSEClientFromResponse({ response, onClose });
    handle.close();
    await flushSSE();

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("request.stream — heartbeat parsing", () => {
  it("invokes onHeartbeat for `: ping` comment frames and not for normal events", async () => {
    const onHeartbeat = vi.fn();
    const onItemAdded = vi.fn();

    const streamBody = [
      ": ping\n\n",
      requestEventFrame({
        id: "req_1:1",
        event: "item.added",
        data: {
          stream: "request",
          type: "item.added",
          requestId: "req_1",
          sequence_number: 1,
          ts: 1,
          item: {
            id: "item_1",
            type: "status",
            status: "in_progress",
            requestId: "req_1",
            itemIndex: 0,
            provenance: {
              blockName: "runtime",
              blockInstanceId: "runtime",
              phase: "main"
            },
            ts: 1,
            message: "tick"
          }
        }
      }),
      ": ping\n\n"
    ].join("");

    // The body ends with no terminal status, so the stream resumes after its
    // last event: answer that as a server would, with nothing older.
    const fetcher = vi.fn<ClientFetch>(async (url) =>
      new Response(String(url).includes("starting_after") ? "" : streamBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    );

    const handle = requestStream({
      url: "/api/flows/demo/requests/req_1/stream",
      fetcher,
      onItemAdded,
      onHeartbeat
    });

    await flushSSE();

    expect(onHeartbeat).toHaveBeenCalledTimes(2);
    expect(onItemAdded).toHaveBeenCalledTimes(1);

    handle.close();
  });
});

describe("request.stream — a stream that ends before the request does", () => {
  // The server ends a request's stream with no terminal event when its reader
  // falls too far behind, and expects the reader to resume from its last
  // event. A request stream does that itself.
  function frame(seq: number, type: string, extra: Record<string, unknown> = {}): string {
    return requestEventFrame({
      id: `req_1:${seq}`,
      event: type,
      data: { stream: "request", type, requestId: "req_1", sequence_number: seq, ts: seq, ...extra }
    });
  }
  function item(id: string, seq: number) {
    return {
      id,
      type: "message",
      role: "assistant",
      status: "completed",
      requestId: "req_1",
      itemIndex: seq,
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: seq,
      content: [{ type: "output_text", text: id }]
    };
  }
  function sse(body: string, status = 200): Response {
    return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
  }

  it("resumes after the last event it delivered, and stops at the terminal status with every event once", async () => {
    const bodies = [
      frame(1, "request.created", { status: "in_progress" }) + frame(2, "item.done", { item: item("m1", 2) }),
      frame(3, "item.done", { item: item("m2", 3) }) + frame(4, "request.completed", { status: "completed" })
    ];
    const fetcher = vi.fn<ClientFetch>(async () => sse(bodies.shift() ?? ""));
    const onItemDone = vi.fn();
    const onRequestStatus = vi.fn();
    const onError = vi.fn();

    const handle = requestStream({ url: "/api/flows/demo/requests/req_1/stream", fetcher, onItemDone, onRequestStatus, onError });
    await vi.waitFor(() => expect(onRequestStatus).toHaveBeenCalled());
    await flushSSE();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/flows/demo/requests/req_1/stream?starting_after=2");
    expect(onItemDone.mock.calls.map(([e]) => (e as { item: { id: string } }).item.id)).toEqual(["m1", "m2"]);
    expect(onRequestStatus).toHaveBeenCalledWith(expect.objectContaining({ type: "request.completed" }));
    expect(onError).not.toHaveBeenCalled();
    expect(handle.lastEventId).toBe("req_1:4");
    handle.close();
  });

  it("stops on an answer that means the request is not there to follow", async () => {
    const fetcher = vi
      .fn<ClientFetch>()
      .mockResolvedValueOnce(sse(frame(1, "request.created", { status: "in_progress" })))
      .mockResolvedValue(new Response("gone", { status: 404 }));
    const onError = vi.fn();

    const handle = requestStream({ url: "/api/flows/demo/requests/req_1/stream", fetcher, onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    await flushSSE();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((onError.mock.calls[0]![0] as { status?: number }).status).toBe(404);
    handle.close();
  });

  it("gives up with an error after five connections in a row that deliver nothing, backing off between them", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<ClientFetch>(async () => sse(""));
      const onError = vi.fn();
      const handle = requestStream({ url: "/api/flows/demo/requests/req_1/stream", startingAfter: 7, fetcher, onError });

      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      // The client's backoff: 1 s, then doubling.
      await vi.advanceTimersByTimeAsync(999);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1]?.[0]).toBe("/api/flows/demo/requests/req_1/stream?starting_after=7");
      await vi.advanceTimersByTimeAsync(60_000);

      expect(fetcher).toHaveBeenCalledTimes(5);
      expect(onError).toHaveBeenCalledOnce();
      handle.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps following a quiet live request whose connections carry only heartbeats", async () => {
    // A long tool step emits no events; the server pings, and a host that caps
    // response length ends each connection. That is a live request, not an
    // empty answer, so it must not use up the give-up budget.
    const bodies = [
      ...Array.from({ length: 7 }, () => ": ping\n\n"),
      frame(8, "request.completed", { status: "completed" })
    ];
    const fetcher = vi.fn<ClientFetch>(async () => sse(bodies.shift() ?? ""));
    const onRequestStatus = vi.fn();
    const onError = vi.fn();

    const handle = requestStream({ url: "/api/flows/demo/requests/req_1/stream", startingAfter: 7, fetcher, onRequestStatus, onError });
    await vi.waitFor(() => expect(onRequestStatus).toHaveBeenCalled());
    await flushSSE();

    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(onRequestStatus).toHaveBeenCalledWith(expect.objectContaining({ type: "request.completed" }));
    expect(onError).not.toHaveBeenCalled();
    handle.close();
  });

  it("does not reconnect once closed locally", async () => {
    const fetcher = vi.fn<ClientFetch>(async () => sse(frame(1, "request.created", { status: "in_progress" })));
    const handle = requestStream({ url: "/api/flows/demo/requests/req_1/stream", fetcher });
    handle.close();
    await flushSSE();
    await flushSSE();
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
