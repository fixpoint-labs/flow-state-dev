import { describe, expect, it, vi } from "vitest";
import {
  createSSEClient,
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
            type: "fsd:status",
            status: "in_progress",
            visibility: "internal",
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
            type: "fsd:status",
            status: "in_progress",
            visibility: "internal",
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
