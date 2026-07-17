import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import {
  collectSuppressedClientItemIdsFromEvents,
  createClientEventFilter,
  filterClientEvents
} from "../../src/streaming/client-filter";

const requestId = "req_client_filter";

function nonClientTraceAdded(sequence: number): RequestStreamEvent {
  return {
    stream: "request",
    type: "item.added",
    requestId,
    sequence_number: sequence,
    ts: 100 + sequence,
    item: {
      id: "trace_0",
      type: "block_trace",
      status: "in_progress",
      requestId,
      itemIndex: 0,
      provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
      itemVisibility: { client: false, history: false },
      ts: 100,
      blockName: "test",
      blockKind: "handler",
      blockInstanceId: "test_1"
    }
  } as RequestStreamEvent;
}

describe("createClientEventFilter", () => {
  it("suppresses follow-up events for non-client items after item.added", () => {
    const filter = createClientEventFilter();
    expect(filter(nonClientTraceAdded(1))).toBe(false);

    const followUps: RequestStreamEvent[] = [
      {
        stream: "request",
        type: "item.updated",
        requestId,
        sequence_number: 2,
        ts: 102,
        itemId: "trace_0",
        patch: { status: "completed", output: { secret: true } }
      },
      {
        stream: "request",
        type: "content.added",
        requestId,
        sequence_number: 3,
        ts: 103,
        itemId: "trace_0",
        contentIndex: 0,
        content: { type: "output_text", text: "x" }
      },
      {
        stream: "request",
        type: "content.delta",
        requestId,
        sequence_number: 4,
        ts: 104,
        itemId: "trace_0",
        contentIndex: 0,
        delta: "y"
      },
      {
        stream: "request",
        type: "content.audio.delta",
        requestId,
        sequence_number: 5,
        ts: 105,
        itemId: "trace_0",
        contentIndex: 0,
        audio: "AQI="
      },
      {
        stream: "request",
        type: "content.done",
        requestId,
        sequence_number: 6,
        ts: 106,
        itemId: "trace_0",
        contentIndex: 0
      }
    ];

    for (const event of followUps) {
      expect(filter(event)).toBe(false);
    }
  });

  it("seeds suppressed ids so resumed streams drop updates after the cursor", () => {
    const seed = [nonClientTraceAdded(1)];
    const filter = createClientEventFilter({
      suppressedItemIds: collectSuppressedClientItemIdsFromEvents(seed)
    });

    const resumedUpdate: RequestStreamEvent = {
      stream: "request",
      type: "item.updated",
      requestId,
      sequence_number: 5,
      ts: 105,
      itemId: "trace_0",
      patch: { status: "completed", output: { leaked: true } }
    };

    expect(filter(resumedUpdate)).toBe(false);
  });
});

describe("filterClientEvents", () => {
  it("applies seed events when filtering a post-cursor batch", () => {
    const seed = [nonClientTraceAdded(1)];
    const batch: RequestStreamEvent[] = [
      {
        stream: "request",
        type: "item.updated",
        requestId,
        sequence_number: 4,
        ts: 104,
        itemId: "trace_0",
        patch: { status: "completed" }
      }
    ];

    expect(filterClientEvents(batch, { seedEvents: seed })).toEqual([]);
  });
});
