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
import { encodeStreamEventInternal } from "../src/streaming/encode-event";
import { NOOP_INTERNAL_STREAMING_SEAMS } from "../src/streaming/internal/seams";
import { createInternalResponseEmitter } from "../src/streaming/response-emitter";
import { createStreamEnvelope } from "../src/streaming/types";

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

    const requestMutation = await emitter.emitResourceChange({
      scope: "request",
      resourcePath: "request/state",
      changeType: "updated",
      itemId: "resource_request",
      itemIndex: 0
    });

    const sessionMutation = await emitter.emitResourceChange({
      scope: "session",
      resourcePath: "session/profile",
      changeType: "created",
      itemId: "resource_session",
      itemIndex: 1
    });

    expect(requestMutation.item.type).toBe("resource_change");
    expect(requestMutation.item.scope).toBe("request");
    expect(requestMutation.changedEvent?.type).toBe("resource.changed");

    expect(sessionMutation.item.type).toBe("resource_change");
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

  it("provides stable correlation and provenance metadata in stream envelopes", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_meta",
      now: () => 250
    });

    await emitter.emitItemAdded(
      makeMessageItem({
        requestId: "req_meta",
        itemIndex: 0,
        ts: 250
      })
    );

    const itemAdded = emitter.getEvents()[0];
    if (itemAdded === undefined) {
      throw new Error("Expected item.added event");
    }

    const envelope = createStreamEnvelope(itemAdded, itemAdded.id);
    expect(envelope.correlation).toEqual({
      stream: "request",
      streamId: "req_meta",
      sequenceNumber: 1,
      eventType: "item.added",
      ts: 250,
      requestId: "req_meta"
    });
    expect(envelope.provenance).toEqual({
      blockName: "test",
      blockInstanceId: "test_1",
      phase: "main"
    });
  });

  it("keeps output parity when internal seam plumbing is enabled with no handlers", async () => {
    const baseEmitter = createResponseEmitter({
      requestId: "req_noop",
      now: () => 500
    });

    const seamEmitter = createInternalResponseEmitter({
      requestId: "req_noop",
      now: () => 500,
      internalSeams: NOOP_INTERNAL_STREAMING_SEAMS
    });

    const item = makeMessageItem({
      requestId: "req_noop",
      itemIndex: 0,
      ts: 500
    });

    await baseEmitter.emitRequestCreated();
    await baseEmitter.emitRequestStatus("in_progress");
    await baseEmitter.emitItemAdded(item);

    await seamEmitter.emitRequestCreated();
    await seamEmitter.emitRequestStatus("in_progress");
    await seamEmitter.emitItemAdded(item);

    expect(seamEmitter.getEvents()).toEqual(baseEmitter.getEvents());
    expect(seamEmitter.getItems()).toEqual(baseEmitter.getItems());
  });

  it("keeps encoded SSE parity when encode seams are configured as no-op", () => {
    const event = makeRequestStatusEvent("req_encode", 8);
    const encodedDefault = encodeStreamEvent(event);
    const encodedInternal = encodeStreamEventInternal(event, {
      internalSeams: NOOP_INTERNAL_STREAMING_SEAMS
    });

    expect(encodedInternal).toBe(encodedDefault);
  });

  it("caps buffered events when maxBufferSize is reached", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_cap",
      now: () => 10,
      maxBufferSize: 2
    });

    await emitter.emitRequestCreated();
    await emitter.emitRequestStatus("in_progress");
    await emitter.emitRequestStatus("completed");

    expect(emitter.getEvents().map((event) => event.type)).toEqual([
      "request.in_progress",
      "request.completed"
    ]);
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

  it("replays only events after Last-Event-ID cursor across full emitter lifecycle", async () => {
    const requestId = "req_resume_test";
    const emitter = createResponseEmitter({ requestId, now: () => 100 });

    await emitter.emitRequestCreated();                   // seq 1
    await emitter.emitRequestStatus("in_progress");       // seq 2
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 0, ts: 100 })); // seq 3
    await emitter.emitItemDone(makeMessageItem({ requestId, itemIndex: 0, ts: 100 }));  // seq 4
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 1, ts: 100 })); // seq 5
    await emitter.emitRequestStatus("completed");         // seq 6

    const allEvents = emitter.getEvents();
    expect(allEvents).toHaveLength(6);

    // Client disconnected at sequence 3. Resume with Last-Event-ID = "req_resume_test:3"
    const resumed = replayRequestEvents({
      requestId,
      lastEventId: `${requestId}:3`,
      events: allEvents
    });

    // Should only include events with sequence_number > 3 (i.e., 4, 5, 6)
    expect(resumed).toHaveLength(3);
    expect(resumed[0]!.sequence_number).toBe(4);
    expect(resumed[1]!.sequence_number).toBe(5);
    expect(resumed[2]!.sequence_number).toBe(6);
  });

  it("replays only events after starting_after cursor, ignoring Last-Event-ID", async () => {
    const requestId = "req_starting_after";
    const emitter = createResponseEmitter({ requestId, now: () => 200 });

    await emitter.emitRequestCreated();                 // seq 1
    await emitter.emitRequestStatus("in_progress");     // seq 2
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 0, ts: 200 })); // seq 3
    await emitter.emitRequestStatus("completed");       // seq 4

    const allEvents = emitter.getEvents();

    // starting_after takes priority over lastEventId
    const resumed = replayRequestEvents({
      requestId,
      startingAfter: 2,
      lastEventId: `${requestId}:1`,
      events: allEvents
    });

    expect(resumed).toHaveLength(2);
    expect(resumed[0]!.sequence_number).toBe(3);
    expect(resumed[1]!.sequence_number).toBe(4);
  });

  it("returns all non-ping events when no cursor is provided", async () => {
    const requestId = "req_no_cursor";
    const emitter = createResponseEmitter({ requestId, now: () => 300 });

    await emitter.emitRequestCreated();
    await emitter.emitPing();
    await emitter.emitRequestStatus("completed");

    const allEvents = emitter.getEvents();
    expect(allEvents).toHaveLength(3);

    const resumed = replayRequestEvents({
      requestId,
      events: allEvents
    });

    // Ping events are filtered out by replay
    expect(resumed).toHaveLength(2);
    expect(resumed.every(e => e.type !== "ping")).toBe(true);
  });

  it("emitItemUpdated merges patch into the server mirror and emits item.updated", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_update",
      now: () => 1
    });

    const item = makeMessageItem({
      requestId: "req_update",
      itemIndex: 0,
      ts: 1
    });
    await emitter.emitItemAdded(item);
    await emitter.emitItemUpdated(item.id, { status: "in_progress" });
    await emitter.emitItemDone({ ...item, status: "completed" });

    const events = emitter.getEvents();
    const update = events.find((event) => event.type === "item.updated");
    expect(update).toMatchObject({
      type: "item.updated",
      itemId: item.id,
      patch: { status: "in_progress" }
    });

    // The server-side mirror reflects the latest snapshot — the final
    // item.done overrides the in-flight status.
    const finalItem = emitter.getItems().find((i) => i.id === item.id);
    expect(finalItem?.status).toBe("completed");
  });

  it("emitItemUpdated strips identity-invariant keys from patch", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_strip",
      now: () => 1
    });

    const item = makeMessageItem({
      requestId: "req_strip",
      itemIndex: 0,
      ts: 1
    });
    await emitter.emitItemAdded(item);
    await emitter.emitItemUpdated(item.id, {
      id: "evil_other",
      type: "status",
      provenance: { blockName: "spoof", blockInstanceId: "x", phase: "main" },
      transient: true,
      status: "completed"
    } as Record<string, unknown>);

    const events = emitter.getEvents();
    const update = events.find((event) => event.type === "item.updated");
    expect(update?.type).toBe("item.updated");
    if (update?.type !== "item.updated") throw new Error("unreachable");
    expect(update.patch).toEqual({ status: "completed" });

    const merged = emitter.getItems().find((i) => i.id === item.id);
    expect(merged?.id).toBe(item.id);
    expect(merged?.type).toBe("message");
    expect(merged?.provenance).toEqual(item.provenance);
  });

  it("ignores emitItemUpdated for unknown itemId without throwing", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_unknown",
      now: () => 1
    });

    const result = await emitter.emitItemUpdated("ghost", { status: "failed" });
    expect(result).toBeUndefined();

    const events = emitter.getEvents();
    expect(events.filter((event) => event.type === "item.updated")).toHaveLength(0);
  });

  it("routes draft item.updated through emit() to the tracking helper", async () => {
    const emitter = createResponseEmitter({
      requestId: "req_route",
      now: () => 1
    });

    const item = makeMessageItem({
      requestId: "req_route",
      itemIndex: 0,
      ts: 1
    });
    await emitter.emitItemAdded(item);
    await emitter.emit({
      type: "item.updated",
      itemId: item.id,
      patch: { status: "in_progress" }
    });

    const events = emitter.getEvents();
    const update = events.find((event) => event.type === "item.updated");
    expect(update?.type).toBe("item.updated");
    if (update?.type !== "item.updated") throw new Error("unreachable");
    expect(update.patch).toEqual({ status: "in_progress" });
  });
});
