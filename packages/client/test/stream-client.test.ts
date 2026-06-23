import { describe, expect, it, vi } from "vitest";
import {
  createSSEClient,
  createSSEClientFromResponse,
  createUserSSEClient,
  type ClientFetch
} from "../src";

function requestEventFrame(options: {
  id: string;
  event: string;
  data: Record<string, unknown>;
}): string {
  return `id: ${options.id}\nevent: ${options.event}\ndata: ${JSON.stringify(options.data)}\n\n`;
}

function userEventFrame(options: {
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

describe("createSSEClient", () => {
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

    const handle = createSSEClient({
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

    const handle = createSSEClient({
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

    const fetcher = vi.fn<ClientFetch>(async () =>
      new Response(streamBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    );

    const handle = createSSEClient({
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

    const handle = createSSEClient({
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

    const handle = createSSEClient({
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

describe("createSSEClientFromResponse", () => {
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
});

describe("createUserSSEClient", () => {
  it("parses optional user-stream events and dispatches callbacks", async () => {
    const onResourceChanged = vi.fn();
    const onScopeStateChanged = vi.fn();

    const streamBody = [
      userEventFrame({
        id: "devuser:1",
        event: "resource.changed",
        data: {
          stream: "user",
          type: "resource.changed",
          userId: "devuser",
          sequence_number: 1,
          ts: 1,
          scope: "session",
          resourcePath: "docs/1",
          changeType: "updated"
        }
      }),
      userEventFrame({
        id: "devuser:2",
        event: "scope.state.changed",
        data: {
          stream: "user",
          type: "scope.state.changed",
          userId: "devuser",
          sequence_number: 2,
          ts: 2,
          scope: "session",
          scopeId: "sess_1",
          changeType: "updated"
        }
      })
    ].join("");

    const fetcher = vi.fn<ClientFetch>(async () =>
      new Response(streamBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    );

    const handle = createUserSSEClient({
      url: "/api/flows/users/devuser/stream",
      fetcher,
      onResourceChanged,
      onScopeStateChanged
    });

    await flushSSE();

    expect(onResourceChanged).toHaveBeenCalledTimes(1);
    expect(onScopeStateChanged).toHaveBeenCalledTimes(1);
    expect(handle.lastEventId).toBe("devuser:2");

    handle.close();
  });
});

describe("createSSEClient — heartbeat parsing", () => {
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

    const fetcher = vi.fn<ClientFetch>(async () =>
      new Response(streamBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    );

    const handle = createSSEClient({
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
