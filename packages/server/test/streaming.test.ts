import type { MessageItem, RequestCreatedEvent, RequestStreamEvent, RequestStatusEvent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import {
  createResponseEmitter,
  createStreamEventId,
  encodeStreamEvent,
  parseStartingAfter,
  parseStreamEventId,
  replayRequestEvents,
  resolveRequestReplayCursor,
  serializeSSEFrame,
  serializeSSEFrames
} from "../src";

function makeMessageItem(options: {
  requestId: string;
  itemIndex: number;
  ts: number;
}): MessageItem {
  return {
    id: `item_${options.itemIndex}`,
    type: "message",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: "hello"
      }
    ],
    status: "completed",
    visibility: "ui",
    requestId: options.requestId,
    itemIndex: options.itemIndex,
    provenance: {
      blockName: "test",
      blockInstanceId: "test_1",
      phase: "main"
    },
    ts: options.ts
  };
}

function makeRequestStatusEvent(
  requestId: string,
  sequenceNumber: number
): RequestStreamEvent {
  return {
    stream: "request",
    type: "request.in_progress",
    requestId,
    sequence_number: sequenceNumber,
    status: "in_progress",
    ts: sequenceNumber
  } satisfies RequestStatusEvent;
}

function makeRequestPingEvent(
  requestId: string,
  sequenceNumber: number
): RequestStreamEvent {
  return {
    stream: "request",
    type: "ping",
    requestId,
    sequence_number: sequenceNumber,
    ts: sequenceNumber
  };
}

describe("streaming runtime", () => {
  it("emits request events with monotonic sequence numbers and deterministic ids", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_stream",
      now: () => 10
    });

    await emitter.emitRequestCreated();
    await emitter.emitRequestStatus("in_progress");
    await emitter.emitItemAdded(
      makeMessageItem({
        requestId: "req_stream",
        itemIndex: 0,
        ts: 10
      })
    );

    const events = emitter.getEvents();
    expect(events.map((event) => event.sequence_number)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.id)).toEqual([
      "req_stream:1",
      "req_stream:2",
      "req_stream:3"
    ]);
    expect(emitter.getLastEventId()).toBe("req_stream:3");
    expect(emitter.getSequenceNumber()).toBe(3);
  });

  it("emits resource update items for all scopes and request-scope resource.changed event", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_resource",
      now: () => 100
    });

    const requestMutation = await emitter.emitResourceUpdate({
      scope: "request",
      resourcePath: "request/state",
      changeType: "updated",
      itemId: "resource_request",
      itemIndex: 0
    });

    const sessionMutation = await emitter.emitResourceUpdate({
      scope: "session",
      resourcePath: "session/profile",
      changeType: "created",
      itemId: "resource_session",
      itemIndex: 1
    });

    expect(requestMutation.item.type).toBe("fsd:resource_update");
    expect(requestMutation.item.scope).toBe("request");
    expect(requestMutation.changedEvent?.type).toBe("resource.changed");

    expect(sessionMutation.item.type).toBe("fsd:resource_update");
    expect(sessionMutation.item.scope).toBe("session");
    expect(sessionMutation.changedEvent).toBeUndefined();

    const events = emitter.getEvents();
    expect(events.map((event) => event.type)).toEqual([
      "item.added",
      "item.done",
      "resource.changed",
      "item.added",
      "item.done"
    ]);

    expect(emitter.getItems().map((item) => item.id)).toEqual([
      "resource_request",
      "resource_session"
    ]);
  });

  it("serializes SSE frames and stream events with canonical id/event/data fields", () => {
    const frame = serializeSSEFrame({
      comment: "heartbeat",
      id: "req_1:4",
      event: "debug",
      retry: 2500.9,
      data: "line-a\nline-b"
    });

    expect(frame).toBe(
      ": heartbeat\nid: req_1:4\nevent: debug\nretry: 2500\ndata: line-a\ndata: line-b\n\n"
    );

    expect(
      serializeSSEFrames([
        { event: "ping", data: { ok: true } },
        { event: "ping", data: { ok: false } }
      ])
    ).toBe(
      "event: ping\ndata: {\"ok\":true}\n\nevent: ping\ndata: {\"ok\":false}\n\n"
    );

    const created: RequestCreatedEvent = {
      stream: "request",
      type: "request.created",
      requestId: "req_1",
      sequence_number: 4,
      status: "in_progress",
      ts: 1
    };

    expect(createStreamEventId(created)).toBe("req_1:4");

    const encoded = encodeStreamEvent(created);
    const lines = encoded.trimEnd().split("\n");
    expect(lines[0]).toBe("id: req_1:4");
    expect(lines[1]).toBe("event: request.created");
    expect(lines[2]?.startsWith("data: ")).toBe(true);
    expect(JSON.parse(lines[2]!.slice("data: ".length))).toEqual(created);
  });

  it("parses replay cursors with starting_after precedence and filters replay events", () => {
    expect(parseStartingAfter("42")).toBe(42);
    expect(parseStartingAfter(-1)).toBeUndefined();
    expect(parseStreamEventId("req_1:7")).toEqual({
      streamId: "req_1",
      sequenceNumber: 7
    });
    expect(parseStreamEventId("invalid")).toBeUndefined();

    expect(
      resolveRequestReplayCursor({
        requestId: "req_1",
        lastEventId: "req_1:5",
        startingAfter: "2"
      })
    ).toEqual({
      source: "starting_after",
      sequenceNumber: 2
    });

    expect(
      resolveRequestReplayCursor({
        requestId: "req_1",
        lastEventId: "req_1:5"
      })
    ).toEqual({
      source: "last_event_id",
      sequenceNumber: 5
    });

    expect(
      resolveRequestReplayCursor({
        requestId: "req_1",
        lastEventId: "req_2:5"
      })
    ).toEqual({
      source: "none"
    });

    const events: RequestStreamEvent[] = [
      makeRequestStatusEvent("req_1", 3),
      makeRequestPingEvent("req_2", 10),
      makeRequestStatusEvent("req_1", 1),
      makeRequestStatusEvent("req_1", 2),
      makeRequestPingEvent("req_1", 11)
    ];

    expect(
      replayRequestEvents({
        events,
        requestId: "req_1",
        lastEventId: "req_1:1"
      }).map((event) => event.sequence_number)
    ).toEqual([2, 3]);

    expect(
      replayRequestEvents({
        events,
        requestId: "req_1",
        lastEventId: "req_1:3",
        startingAfter: 0
      }).map((event) => event.sequence_number)
    ).toEqual([1, 2, 3]);
  });
});
