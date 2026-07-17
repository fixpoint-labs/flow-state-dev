/**
 * Tests for the streaming TTS contract (FIX-523).
 *
 * `content.audio.delta` is the live-only wire event that carries chunked
 * synthesized audio. It must:
 *   - reach SSE wire consumers (the `onEvent` constructor callback)
 *   - be retained in the in-memory event buffer (so live observers can tail)
 *   - be excluded from `getReplayableEvents()` (no chunk replay on reconnect)
 *   - be excluded from the events-log persistence hook (no disk bloat)
 *   - be excluded from `replayRequestEvents()` (belt-and-braces against
 *     pre-shipped persisted logs that may still contain audio deltas)
 *   - base64-round-trip the original bytes exactly
 *   - preserve the optional `isLast` flag only on the final chunk
 */
import type { ContentAudioDeltaEvent, RequestStreamEvent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { createClientEventFilter } from "../../src/streaming/client-filter";
import { createResponseEmitter } from "../../src/streaming/response-emitter";
import { replayRequestEvents } from "../../src/streaming/resume";

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(value, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

describe("FIX-523 — content.audio.delta wire delivery", () => {
  it("delivers audio deltas to the wire callback in emission order", async () => {
    const requestId = "req_audio_wire";
    const wireEvents: RequestStreamEvent[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireEvents.push(event);
      }
    });

    const chunk1 = new Uint8Array([0x10, 0x20, 0x30]);
    const chunk2 = new Uint8Array([0x40, 0x50, 0x60]);
    const chunk3 = new Uint8Array([0x70, 0x80, 0x90]);

    await emitter.emitContentAudioDelta("msg_0", 0, { bytes: chunk1 });
    await emitter.emitContentAudioDelta("msg_0", 0, { bytes: chunk2 });
    await emitter.emitContentAudioDelta("msg_0", 0, {
      bytes: chunk3,
      isLast: true
    });

    expect(wireEvents).toHaveLength(3);
    expect(wireEvents.map((e) => e.type)).toEqual([
      "content.audio.delta",
      "content.audio.delta",
      "content.audio.delta"
    ]);
  });

  it("preserves bytes via base64 round-trip", async () => {
    const requestId = "req_audio_roundtrip";
    const wireEvents: ContentAudioDeltaEvent[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        if (event.type === "content.audio.delta") {
          wireEvents.push(event);
        }
      }
    });

    // A non-trivial byte pattern that exercises the full 0–255 range
    // (catches sign-extension bugs in non-Buffer fallback paths).
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;

    await emitter.emitContentAudioDelta("msg_0", 0, { bytes: original });

    expect(wireEvents).toHaveLength(1);
    const decoded = base64ToBytes(wireEvents[0]!.audio);
    expect(decoded).toEqual(original);
  });

  it("only the final chunk carries isLast=true", async () => {
    const requestId = "req_audio_islast";
    const wireEvents: ContentAudioDeltaEvent[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        if (event.type === "content.audio.delta") {
          wireEvents.push(event);
        }
      }
    });

    await emitter.emitContentAudioDelta("msg_0", 0, { bytes: new Uint8Array([1]) });
    await emitter.emitContentAudioDelta("msg_0", 0, { bytes: new Uint8Array([2]) });
    await emitter.emitContentAudioDelta("msg_0", 0, {
      bytes: new Uint8Array([3]),
      isLast: true
    });

    expect(wireEvents.map((e) => e.isLast)).toEqual([undefined, undefined, true]);
  });
});

describe("FIX-523 — content.audio.delta is non-replayable", () => {
  it("audio deltas are excluded from getReplayableEvents", async () => {
    const requestId = "req_audio_replayable";
    const emitter = createResponseEmitter({ requestId, now: () => 100 });

    await emitter.emitRequestCreated();
    await emitter.emitContentAdded("msg_0", 0, {
      type: "output_audio",
      audio: "",
      mediaType: "audio/mpeg"
    });
    await emitter.emitContentAudioDelta("msg_0", 0, { bytes: new Uint8Array([1, 2]) });
    await emitter.emitContentAudioDelta("msg_0", 0, {
      bytes: new Uint8Array([3, 4]),
      isLast: true
    });
    await emitter.emitContentDone("msg_0", 0, {
      type: "output_audio",
      audio: "AQIDBA==",
      mediaType: "audio/mpeg"
    });

    const replayTypes = emitter.getReplayableEvents().map((e) => e.type);
    expect(replayTypes).toContain("content.added");
    expect(replayTypes).toContain("content.done");
    expect(replayTypes).not.toContain("content.audio.delta");

    // The in-memory event buffer still retains them for live observers.
    const allTypes = emitter.getEvents().map((e) => e.type);
    expect(allTypes.filter((t) => t === "content.audio.delta")).toHaveLength(2);
  });

  it("audio deltas do not reach the events-log persistence hook", async () => {
    const requestId = "req_audio_no_persist";
    const persisted: RequestStreamEvent[] = [];

    const emitter = createResponseEmitter({ requestId, now: () => 100 });
    emitter.setEventHooks({
      onEvent: (events) => {
        persisted.push(...events);
      },
      flushEvents: async () => {}
    });

    await emitter.emitContentAdded("msg_0", 0, {
      type: "output_audio",
      audio: "",
      mediaType: "audio/mpeg"
    });
    await emitter.emitContentAudioDelta("msg_0", 0, { bytes: new Uint8Array([1]) });
    await emitter.emitContentAudioDelta("msg_0", 0, {
      bytes: new Uint8Array([2]),
      isLast: true
    });

    const persistedTypes = persisted.map((e) => e.type);
    expect(persistedTypes).toContain("content.added");
    expect(persistedTypes).not.toContain("content.audio.delta");
  });

  it("client-filter suppresses audio deltas for non-client items", () => {
    // If a non-client item ever streamed TTS audio (e.g. an internal
    // reasoning item synthesized for an internal subscriber, or a future
    // item type whose visibility defaults to client: false), its chunks
    // must be filtered along with the rest of its content events.
    const filter = createClientEventFilter();
    const requestId = "req_audio_client_filter";

    // A trace-stamped item resolves to client: false.
    const nonClientItem = {
      stream: "request" as const,
      type: "item.added" as const,
      requestId,
      sequence_number: 1,
      ts: 100,
      item: {
        id: "trace_0",
        type: "block_trace",
        status: "in_progress" as const,
        requestId,
        itemIndex: 0,
        provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" as const },
        itemVisibility: { client: false, history: false },
        ts: 100,
        blockName: "test",
        blockKind: "handler" as const,
        blockInstanceId: "test_1"
      }
    };

    const audioDelta = {
      stream: "request" as const,
      type: "content.audio.delta" as const,
      requestId,
      sequence_number: 2,
      ts: 101,
      itemId: "trace_0",
      contentIndex: 0,
      audio: "AQI="
    };

    expect(filter(nonClientItem as never)).toBe(false);
    expect(filter(audioDelta as never)).toBe(false);
  });

  it("client-filter suppresses item.updated for non-client items", () => {
    const filter = createClientEventFilter();
    const requestId = "req_trace_item_updated_filter";

    const nonClientItem = {
      stream: "request" as const,
      type: "item.added" as const,
      requestId,
      sequence_number: 1,
      ts: 100,
      item: {
        id: "trace_1",
        type: "block_trace",
        status: "in_progress" as const,
        requestId,
        itemIndex: 0,
        provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" as const },
        itemVisibility: { client: false, history: false },
        ts: 100,
        blockName: "test",
        blockKind: "handler" as const,
        blockInstanceId: "test_1"
      }
    };

    const itemUpdated = {
      stream: "request" as const,
      type: "item.updated" as const,
      requestId,
      sequence_number: 2,
      ts: 101,
      itemId: "trace_1",
      patch: { status: "completed" as const, output: { ok: true } }
    };

    expect(filter(nonClientItem as never)).toBe(false);
    expect(filter(itemUpdated as never)).toBe(false);
  });

  it("replayRequestEvents drops any persisted content.audio.delta entries (belt-and-braces)", () => {
    // Defends against a pre-FIX-523 process whose write-path gate missed
    // the new event type — any audio deltas that escaped to disk must still
    // be filtered out of replay.
    const requestId = "req_audio_replay_filter";

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
        type: "content.audio.delta",
        requestId,
        sequence_number: 2,
        ts: 101,
        itemId: "msg_0",
        contentIndex: 0,
        audio: "AQI="
      },
      {
        stream: "request",
        type: "request.completed",
        requestId,
        sequence_number: 3,
        status: "completed",
        ts: 102
      }
    ];

    const replayed = replayRequestEvents({ requestId, events });
    expect(replayed.map((e) => e.type)).toEqual([
      "request.created",
      "request.completed"
    ]);
  });
});
