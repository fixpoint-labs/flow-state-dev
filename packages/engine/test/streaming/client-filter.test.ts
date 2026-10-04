/**
 * Client-visibility filter: a hidden item's `item.updated` must not reach a
 * client stream.
 *
 * `block_trace` is never client-visible, but the engine writes a block's
 * result onto its trace row with `item.updated` patches. If the filter only
 * withheld the trace's `item.added`/`item.done`, every block's output — the
 * outputs of internal blocks included — would still reach any caller of the
 * live stream. These tests pin the update half of the contract on the real
 * path (a `ResponseEmitter` feeding a live stream) and on the filter itself,
 * for both id keys an update can carry: the canonical `itemId` and the
 * legacy `id` that some producers still emit.
 */
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { filterClientEvents } from "../../src/streaming/client-filter";
import { createLiveRequestStream } from "../../src/streaming/live-stream";

const requestId = "req_client_filter";

const provenance = {
  blockName: "internal",
  blockInstanceId: "internal_1",
  phase: "main" as const
};

function traceItem(id: string): OutputItem {
  return {
    id,
    type: "block_trace",
    status: "in_progress",
    requestId,
    itemIndex: 0,
    provenance,
    ts: 100,
    blockName: "internal",
    blockKind: "handler",
    blockInstanceId: "internal_1"
  } as unknown as OutputItem;
}

function containerItem(id: string): OutputItem {
  return {
    id,
    type: "container",
    status: "in_progress",
    requestId,
    itemIndex: 1,
    provenance,
    ts: 101,
    startedAt: 101
  } as unknown as OutputItem;
}

/** A tool_output the generator declared hidden via `itemVisibility`. */
function hiddenToolOutput(id: string): OutputItem {
  return {
    id,
    type: "tool_output",
    status: "in_progress",
    requestId,
    itemIndex: 2,
    provenance,
    ts: 102,
    itemVisibility: { client: false, history: true },
    toolName: "lookup",
    callId: "call_1",
    arguments: {}
  } as unknown as OutputItem;
}

/** Drive a real emitter into a live stream and parse what reached the wire. */
async function wireEvents(
  includeTrace: boolean,
  drive: (emit: ReturnType<typeof createLiveRequestStream>["emitter"]) => Promise<void>
): Promise<Array<Record<string, unknown>>> {
  const live = createLiveRequestStream({ requestId, includeTrace });
  await drive(live.emitter);
  live.close();
  const text = await new Response(live.readable).text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

const updatesFor = (events: Array<Record<string, unknown>>, id: string) =>
  events.filter(
    (event) => event.type === "item.updated" && (event.itemId ?? event.id) === id
  );

describe("client filter — item.updated for hidden items", () => {
  it("drops a block_trace's output patch (canonical itemId) from a client stream", async () => {
    const events = await wireEvents(false, async (emitter) => {
      await emitter.emitItemAdded(traceItem("trace_1"));
      await emitter.emitItemUpdated("trace_1", {
        status: "completed",
        output: { kind: "inline", value: { secret: "internal-result" } }
      });
      await emitter.emitItemDone(traceItem("trace_1"));
    });

    expect(updatesFor(events, "trace_1")).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("internal-result");
  });

  it("drops a hidden item's patch that carries the legacy `id` key", async () => {
    const events = await wireEvents(false, async (emitter) => {
      await emitter.emitItemAdded(hiddenToolOutput("tool_1"));
      // Legacy producers write `id` instead of `itemId`; the emitter appends
      // those raw, so the filter is the only thing between them and the wire.
      await emitter.emit({
        type: "item.updated",
        id: "tool_1",
        patch: { status: "completed", output: "hidden-tool-result" }
      });
    });

    expect(updatesFor(events, "tool_1")).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("hidden-tool-result");
  });

  it("still forwards a client item's patch", async () => {
    const events = await wireEvents(false, async (emitter) => {
      await emitter.emitItemAdded(containerItem("container_1"));
      await emitter.emitItemUpdated("container_1", { status: "completed" });
    });

    expect(updatesFor(events, "container_1")).toHaveLength(1);
  });

  it("keys a legacy `id`-shaped update by its item when the id survives", () => {
    // On the live wire the emitter stamps every event's `id` with the event
    // id, so a legacy update's item id is gone and it fails closed (above).
    // Where the item id does survive, the filter honours it in both
    // directions: a client item's patch passes, a hidden item's is dropped.
    const base = { stream: "request", requestId, ts: 100 } as const;
    const events = [
      { ...base, type: "item.added", sequence_number: 1, item: containerItem("container_1") },
      { ...base, type: "item.added", sequence_number: 2, item: traceItem("trace_1") },
      { ...base, type: "item.updated", sequence_number: 3, id: "container_1", patch: { duration: 5 } },
      { ...base, type: "item.updated", sequence_number: 4, id: "trace_1", patch: { output: "leak" } }
    ] as unknown as RequestStreamEvent[];

    const forwarded = filterClientEvents(events).map((event) => event.sequence_number);
    expect(forwarded).toEqual([1, 3]);
  });

  it("forwards every patch to a trace-opted stream", async () => {
    const events = await wireEvents(true, async (emitter) => {
      await emitter.emitItemAdded(traceItem("trace_1"));
      await emitter.emitItemUpdated("trace_1", { status: "completed" });
      await emitter.emitItemAdded(containerItem("container_1"));
      await emitter.emitItemUpdated("container_1", { status: "completed" });
    });

    expect(updatesFor(events, "trace_1")).toHaveLength(1);
    expect(updatesFor(events, "container_1")).toHaveLength(1);
  });

  it("fails closed on a patch whose item this stream never saw", () => {
    // A resumed stream starts past the item's `item.added`, so the filter
    // cannot learn its type, and a patch carries no type (it is an
    // identity-invariant key). Forwarding would leak a hidden item's output;
    // dropping costs a client nothing, since a client applies a patch only to
    // an item it already holds.
    const resumed: RequestStreamEvent[] = [
      {
        stream: "request",
        type: "item.updated",
        requestId,
        sequence_number: 7,
        ts: 107,
        itemId: "trace_before_cursor",
        patch: { output: { kind: "inline", value: "pre-cursor-result" } }
      } as RequestStreamEvent
    ];

    expect(filterClientEvents(resumed)).toEqual([]);
  });
});
