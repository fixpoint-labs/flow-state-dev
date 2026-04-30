/**
 * Tests for stream resume functionality (FIX-20).
 *
 * Covers:
 * - Active-request reconnect with cursor (buffer replay + live continuation)
 * - Completed-request replay from persisted canonical event history
 * - Cursor precedence (starting_after > Last-Event-ID)
 * - Event persistence via ResponseEmitter hooks
 * - Memory store event persistence
 */
import type { MessageItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { describe, expect, it, vi } from "vitest";
import { createResponseEmitter } from "../src/streaming/response-emitter";
import { replayRequestEvents, resolveRequestReplayCursor } from "../src/streaming/resume";
import { InMemoryRequestStore } from "../src/stores/memory/request-store";
import type { RequestRecord } from "../src/stores/types";
import { buildReplayEvents } from "../src/routes/route-utils";

function makeMessageItem(options: {
  requestId: string;
  itemIndex: number;
  ts: number;
}): MessageItem {
  return {
    id: `item_${options.itemIndex}`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: `hello ${options.itemIndex}` }],
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

describe("stream resume — event persistence", () => {
  it("fires event hooks on replayable events (excludes ping/debug)", async () => {
    const requestId = "req_hooks";
    const hookCalls: RequestStreamEvent[][] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100
    });

    emitter.setEventHooks({
      onEvent: (events) => {
        hookCalls.push([...events]);
      }
    });

    await emitter.emitRequestCreated();        // seq 1 — replayable
    await emitter.emitPing();                   // seq 2 — NOT replayable
    await emitter.emitRequestStatus("in_progress"); // seq 3 — replayable
    await emitter.emitDebug("test", {});        // seq 4 — NOT replayable
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 0, ts: 100 })); // seq 5

    // Hook should have been called 3 times (request.created, request.in_progress, item.added)
    expect(hookCalls).toHaveLength(3);

    // Each call receives only the newly emitted event (incremental, not full history).
    expect(hookCalls[0]!).toHaveLength(1);
    expect(hookCalls[0]![0]!.type).toBe("request.created");
    expect(hookCalls[1]!).toHaveLength(1);
    expect(hookCalls[1]![0]!.type).toBe("request.in_progress");
    expect(hookCalls[2]!).toHaveLength(1);
    expect(hookCalls[2]![0]!.type).toBe("item.added");
  });

  it("getReplayableEvents excludes ping and debug", async () => {
    const requestId = "req_replayable";
    const emitter = createResponseEmitter({ requestId, now: () => 100 });

    await emitter.emitRequestCreated();
    await emitter.emitPing();
    await emitter.emitDebug("test", {});
    await emitter.emitRequestStatus("in_progress");
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 0, ts: 100 }));

    const replayable = emitter.getReplayableEvents();
    expect(replayable).toHaveLength(3);
    expect(replayable.every((e) => e.type !== "ping" && e.type !== "debug")).toBe(true);
  });
});

describe("stream resume — memory store event persistence", () => {
  it("persists and retrieves events", async () => {
    const store = new InMemoryRequestStore();
    const requestId = "req_mem";

    const events: RequestStreamEvent[] = [
      {
        stream: "request",
        type: "request.created",
        requestId,
        sequence_number: 1,
        status: "in_progress",
        ts: 100
      },
      {
        stream: "request",
        type: "item.added",
        requestId,
        sequence_number: 2,
        ts: 101,
        item: makeMessageItem({ requestId, itemIndex: 0, ts: 101 })
      }
    ];

    store.persistEvents(requestId, events);
    const retrieved = await store.getEvents(requestId);

    expect(retrieved).toHaveLength(2);
    expect(retrieved[0]!.sequence_number).toBe(1);
    expect(retrieved[1]!.sequence_number).toBe(2);
  });

  it("returns empty array for unknown request", async () => {
    const store = new InMemoryRequestStore();
    const events = await store.getEvents("nonexistent");
    expect(events).toEqual([]);
  });

  it("appends new events incrementally on re-persist", async () => {
    const store = new InMemoryRequestStore();
    const requestId = "req_append";

    store.persistEvents(requestId, [
      {
        stream: "request",
        type: "request.created",
        requestId,
        sequence_number: 1,
        status: "in_progress",
        ts: 100
      }
    ]);

    store.persistEvents(requestId, [
      {
        stream: "request",
        type: "request.completed",
        requestId,
        sequence_number: 2,
        status: "completed",
        ts: 200
      }
    ]);

    const events = await store.getEvents(requestId);
    expect(events).toHaveLength(2);
    expect(events[0]!.sequence_number).toBe(1);
    expect(events[1]!.sequence_number).toBe(2);
  });
});

describe("stream resume — active request replay from buffer", () => {
  it("replays buffered events after cursor and includes subsequent live events", async () => {
    const requestId = "req_active_resume";
    const emitter = createResponseEmitter({ requestId, now: () => 100 });

    // Emit events that happened before reconnect
    await emitter.emitRequestCreated();                                                    // seq 1
    await emitter.emitRequestStatus("in_progress");                                        // seq 2
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 0, ts: 100 }));    // seq 3
    await emitter.emitContentAdded("item_0", 0, { type: "output_text", text: "" });        // seq 4
    await emitter.emitContentDelta("item_0", 0, "hello ");                                 // seq 5
    await emitter.emitContentDelta("item_0", 0, "world");                                  // seq 6
    await emitter.emitContentDone("item_0", 0, { type: "output_text", text: "hello world" }); // seq 7

    // Client disconnected at seq 3 and reconnects with cursor
    const allBuffered = emitter.getEvents();
    const cursor = resolveRequestReplayCursor({
      requestId,
      startingAfter: "3"
    });
    expect(cursor.source).toBe("starting_after");
    expect(cursor.sequenceNumber).toBe(3);

    // Filter buffered events after cursor (simulating what handleRequestStream does)
    const replayed = allBuffered.filter(
      (e) => e.sequence_number > 3 && e.type !== "ping" && e.type !== "debug"
    );

    expect(replayed).toHaveLength(4);
    expect(replayed.map((e) => e.type)).toEqual([
      "content.added",
      "content.delta",
      "content.delta",
      "content.done"
    ]);
    expect(replayed.map((e) => e.sequence_number)).toEqual([4, 5, 6, 7]);

    // Subsequent live events continue after replay
    await emitter.emitItemDone(makeMessageItem({ requestId, itemIndex: 0, ts: 100 })); // seq 8
    await emitter.emitRequestStatus("completed"); // seq 9

    const liveEvents = emitter.getEvents().filter(
      (e) => e.sequence_number > 7 && e.type !== "ping" && e.type !== "debug"
    );
    expect(liveEvents).toHaveLength(2);
    expect(liveEvents[0]!.type).toBe("item.done");
    expect(liveEvents[1]!.type).toBe("request.completed");
  });

  it("excludes content.delta from replay; in-flight text reaches snapshots instead (FIX-479)", async () => {
    const requestId = "req_content_replay";
    const emitter = createResponseEmitter({ requestId, now: () => 100 });

    await emitter.emitRequestCreated();                                                    // seq 1
    await emitter.emitRequestStatus("in_progress");                                        // seq 2
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 0, ts: 100 }));    // seq 3
    await emitter.emitContentAdded("item_0", 0, { type: "output_text", text: "" });        // seq 4
    await emitter.emitContentDelta("item_0", 0, "streaming ");                             // seq 5
    await emitter.emitContentDelta("item_0", 0, "text");                                   // seq 6
    await emitter.emitContentDone("item_0", 0, { type: "output_text", text: "streaming text" }); // seq 7
    await emitter.emitItemDone(makeMessageItem({ requestId, itemIndex: 0, ts: 100 }));     // seq 8
    await emitter.emitRequestStatus("completed");                                           // seq 9

    // FIX-479: content.delta is reclassified as non-replayable. Live SSE
    // consumers still see deltas via the in-memory buffer / wire callback;
    // the replayable view (used for resume-on-reconnect) excludes them.
    const replayable = emitter.getReplayableEvents();
    const types = replayable.map((e) => e.type);

    expect(types).toContain("content.added");
    expect(types).toContain("content.done");
    expect(types).not.toContain("content.delta");

    // The in-memory event buffer still holds deltas for live observers and
    // the wire callback path.
    const allTypes = emitter.getEvents().map((e) => e.type);
    expect(allTypes.filter((t) => t === "content.delta")).toHaveLength(2);
  });
});

describe("stream resume — completed request replay from persisted events", () => {
  it("prefers persisted canonical events over item-based reconstruction", async () => {
    const store = new InMemoryRequestStore();
    const requestId = "req_canonical";

    // Persist a rich canonical event history (includes content events)
    const canonicalEvents: RequestStreamEvent[] = [
      {
        stream: "request",
        type: "request.created",
        requestId,
        sequence_number: 1,
        status: "in_progress",
        ts: 100
      },
      {
        stream: "request",
        type: "request.in_progress",
        requestId,
        sequence_number: 2,
        status: "in_progress",
        ts: 100
      },
      {
        stream: "request",
        type: "item.added",
        requestId,
        sequence_number: 3,
        ts: 101,
        item: makeMessageItem({ requestId, itemIndex: 0, ts: 101 })
      },
      {
        stream: "request",
        type: "content.added",
        requestId,
        sequence_number: 4,
        ts: 102,
        itemId: "item_0",
        contentIndex: 0,
        content: { type: "output_text", text: "" }
      },
      {
        stream: "request",
        type: "content.delta",
        requestId,
        sequence_number: 5,
        ts: 103,
        itemId: "item_0",
        contentIndex: 0,
        delta: "hello"
      },
      {
        stream: "request",
        type: "content.done",
        requestId,
        sequence_number: 6,
        ts: 104,
        itemId: "item_0",
        contentIndex: 0,
        content: { type: "output_text", text: "hello" }
      },
      {
        stream: "request",
        type: "item.done",
        requestId,
        sequence_number: 7,
        ts: 105,
        item: makeMessageItem({ requestId, itemIndex: 0, ts: 101 })
      },
      {
        stream: "request",
        type: "request.completed",
        requestId,
        sequence_number: 8,
        status: "completed",
        ts: 106
      }
    ];

    store.persistEvents(requestId, canonicalEvents);
    const retrieved = await store.getEvents(requestId);

    // Canonical events include content events that buildReplayEvents would miss
    expect(retrieved).toHaveLength(8);
    const types = retrieved.map((e) => e.type);
    expect(types).toContain("content.added");
    expect(types).toContain("content.delta");
    expect(types).toContain("content.done");

    // buildReplayEvents would only produce item.added/item.done pairs
    const record: RequestRecord = {
      id: requestId,
      flowKind: "test",
      actionName: "test",
      userId: "user1",
      status: "completed",
      startedAtMs: 100,
      completedAtMs: 106,
      version: 1,
      createdAt: 100,
      updatedAt: 106,
      state: {},
      items: [makeMessageItem({ requestId, itemIndex: 0, ts: 101 })]
    };

    const reconstructed = buildReplayEvents(record);
    const reconstructedTypes = reconstructed.map((e) => e.type);
    expect(reconstructedTypes).not.toContain("content.added");
    expect(reconstructedTypes).not.toContain("content.delta");
    expect(reconstructedTypes).not.toContain("content.done");
  });

  it("applies cursor filtering to persisted canonical events", async () => {
    const store = new InMemoryRequestStore();
    const requestId = "req_cursor_canonical";

    const events: RequestStreamEvent[] = [
      {
        stream: "request",
        type: "request.created",
        requestId,
        sequence_number: 1,
        status: "in_progress",
        ts: 100
      },
      {
        stream: "request",
        type: "item.added",
        requestId,
        sequence_number: 2,
        ts: 101,
        item: makeMessageItem({ requestId, itemIndex: 0, ts: 101 })
      },
      {
        stream: "request",
        type: "item.done",
        requestId,
        sequence_number: 3,
        ts: 102,
        item: makeMessageItem({ requestId, itemIndex: 0, ts: 101 })
      },
      {
        stream: "request",
        type: "request.completed",
        requestId,
        sequence_number: 4,
        status: "completed",
        ts: 103
      }
    ];

    store.persistEvents(requestId, events);
    const persisted = await store.getEvents(requestId);

    // Replay with starting_after=2 should return events 3 and 4
    const replayed = replayRequestEvents({
      requestId,
      events: persisted,
      startingAfter: 2
    });

    expect(replayed).toHaveLength(2);
    expect(replayed[0]!.sequence_number).toBe(3);
    expect(replayed[1]!.sequence_number).toBe(4);
  });
});

describe("stream resume — cursor precedence", () => {
  it("starting_after takes precedence over Last-Event-ID in active stream path", () => {
    const requestId = "req_precedence";

    const cursor = resolveRequestReplayCursor({
      requestId,
      lastEventId: `${requestId}:10`,
      startingAfter: "5"
    });

    expect(cursor.source).toBe("starting_after");
    expect(cursor.sequenceNumber).toBe(5);
  });

  it("starting_after takes precedence over Last-Event-ID in completed replay path", () => {
    const requestId = "req_precedence_replay";

    const events: RequestStreamEvent[] = Array.from({ length: 10 }, (_, i) => ({
      stream: "request" as const,
      type: "request.in_progress" as const,
      requestId,
      sequence_number: i + 1,
      status: "in_progress" as const,
      ts: 100 + i
    }));

    // starting_after=3 should win over lastEventId=req:8
    const replayed = replayRequestEvents({
      requestId,
      events,
      startingAfter: 3,
      lastEventId: `${requestId}:8`
    });

    expect(replayed).toHaveLength(7); // seq 4..10
    expect(replayed[0]!.sequence_number).toBe(4);
  });

  it("falls back to Last-Event-ID when starting_after is absent", () => {
    const requestId = "req_fallback";

    const cursor = resolveRequestReplayCursor({
      requestId,
      lastEventId: `${requestId}:7`
    });

    expect(cursor.source).toBe("last_event_id");
    expect(cursor.sequenceNumber).toBe(7);
  });

  it("returns all events when neither cursor is provided", () => {
    const requestId = "req_no_cursor_test";

    const events: RequestStreamEvent[] = [
      {
        stream: "request",
        type: "request.created",
        requestId,
        sequence_number: 1,
        status: "in_progress",
        ts: 100
      },
      {
        stream: "request",
        type: "request.completed",
        requestId,
        sequence_number: 2,
        status: "completed",
        ts: 200
      }
    ];

    const replayed = replayRequestEvents({
      requestId,
      events
    });

    expect(replayed).toHaveLength(2);
  });
});

describe("stream resume — emitter event observer for live tailing", () => {
  it("event observer receives events in order for live tailing", async () => {
    const requestId = "req_observer";
    const emitter = createResponseEmitter({ requestId, now: () => 100 });
    const observed: RequestStreamEvent[] = [];

    emitter.addEventObserver((event) => {
      observed.push(event);
    });

    await emitter.emitRequestCreated();
    await emitter.emitRequestStatus("in_progress");
    await emitter.emitItemAdded(makeMessageItem({ requestId, itemIndex: 0, ts: 100 }));
    await emitter.emitRequestStatus("completed");

    expect(observed).toHaveLength(4);
    expect(observed.map((e) => e.sequence_number)).toEqual([1, 2, 3, 4]);
    expect(observed[3]!.type).toBe("request.completed");
  });
});
