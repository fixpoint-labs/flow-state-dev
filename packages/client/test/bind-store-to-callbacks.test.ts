/**
 * Tests for the deduplicated reducer adapter: each SSE callback mutates the
 * store and signals `onChange(kind)` only on an actual mutation; the
 * `itemFilter` gate keeps filtered items out of the store; and content deltas
 * accumulate through the binder (the reducer-level guard for the former react
 * `useRequestStream` "no streaming text" bug).
 */
import { describe, expect, it, vi } from "vitest";
import type {
  ContentPartAddedEvent,
  ContentPartDeltaEvent,
  ContentPartDoneEvent,
  ItemAddedEvent,
  ItemDoneEvent,
  ItemUpdatedEvent,
  OutputItem,
  RequestCreatedEvent,
  RequestStatusEvent
} from "@flow-state-dev/core/items";
import { createRequestStreamStore } from "../src/stream-client/request-stream-store";
import { bindStoreToCallbacks } from "../src/stream-client/bind-store-to-callbacks";

let seq = 0;
function base() {
  return { stream: "request" as const, requestId: "req_1", sequence_number: ++seq, ts: Date.now() };
}

function makeItem(overrides: Partial<OutputItem> & { id: string }): OutputItem {
  return {
    type: "message",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" as const },
    ts: 1000,
    ...overrides
  } as OutputItem;
}

function itemAdded(item: OutputItem): ItemAddedEvent {
  return { ...base(), type: "item.added", item };
}
function itemDone(item: OutputItem): ItemDoneEvent {
  return { ...base(), type: "item.done", item };
}
function itemUpdated(itemId: string, patch: Record<string, unknown>): ItemUpdatedEvent {
  return { ...base(), type: "item.updated", itemId, patch };
}
function contentAdded(itemId: string, contentIndex: number, content: ContentPartAddedEvent["content"]): ContentPartAddedEvent {
  return { ...base(), type: "content.added", itemId, contentIndex, content };
}
function contentDelta(itemId: string, contentIndex: number, delta: string): ContentPartDeltaEvent {
  return { ...base(), type: "content.delta", itemId, contentIndex, delta };
}
function contentDone(itemId: string, contentIndex: number, content: ContentPartDoneEvent["content"]): ContentPartDoneEvent {
  return { ...base(), type: "content.done", itemId, contentIndex, content };
}
function requestCreated(): RequestCreatedEvent {
  return { ...base(), type: "request.created", status: "in_progress" };
}
function requestStatus(status: RequestStatusEvent["status"]): RequestStatusEvent {
  return { ...base(), type: `request.${status}`, status };
}

describe("bindStoreToCallbacks — status/sequence", () => {
  it("onEvent advances the sequence cursor without signaling onChange", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onEvent!({ ...base(), sequence_number: 42, type: "request.created", status: "in_progress" });
    expect(store.lastSequenceNumber).toBe(42);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("onRequestCreated sets status but does not signal a no-op on a fresh store", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onRequestCreated!(requestCreated());
    expect(store.status).toBe("in_progress");
    expect(onChange).not.toHaveBeenCalled(); // already in_progress — no change, no flush
  });

  it("records every status event but signals only on a value change", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onRequestStatus!(requestStatus("in_progress")); // no change (fresh = in_progress)
    cb.onRequestStatus!(requestStatus("completed")); // change → signal
    cb.onRequestStatus!(requestStatus("completed")); // duplicate → no signal
    expect(store.status).toBe("completed");
    expect(store.statusEvents.map((e) => e.status)).toEqual(["in_progress", "completed", "completed"]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("status");
  });
});

describe("bindStoreToCallbacks — items", () => {
  it("onItemAdded upserts and signals item", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onItemAdded!(itemAdded(makeItem({ id: "a", ts: 100 })));
    expect(store.getById("a")).toBeDefined();
    expect(onChange).toHaveBeenCalledWith("item");
  });

  it("onItemDone upserts the final item", () => {
    const store = createRequestStreamStore();
    const cb = bindStoreToCallbacks(store);
    cb.onItemDone!(itemDone(makeItem({ id: "a", ts: 100, status: "completed" as OutputItem["status"] })));
    expect(store.getById("a")!.status).toBe("completed");
  });

  it("itemFilter gates upserts — rejected items never reach the store and signal nothing", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, {
      onChange,
      itemFilter: (item) => item.type === "message"
    });
    cb.onItemAdded!(itemAdded(makeItem({ id: "keep", ts: 100, type: "message" })));
    cb.onItemAdded!(itemAdded(makeItem({ id: "drop", ts: 200, type: "status" })));
    expect(store.getById("keep")).toBeDefined();
    expect(store.getById("drop")).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("onItemUpdated patches a known item and signals item", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onItemAdded!(itemAdded(makeItem({ id: "a", ts: 100, status: "in_progress" as OutputItem["status"] })));
    onChange.mockClear();
    cb.onItemUpdated!(itemUpdated("a", { status: "completed" }));
    expect(store.getById("a")!.status).toBe("completed");
    expect(onChange).toHaveBeenCalledWith("item");
  });

  it("onItemUpdated for an unknown id signals nothing", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onItemUpdated!(itemUpdated("missing", { status: "completed" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("bindStoreToCallbacks — content", () => {
  it("accumulates streaming text across the full production frame sequence (regression guard for the react streaming-text bug)", () => {
    // Replays the real ordering: item.added → content.added@0 → deltas → content.done@0.
    // The former react reducer wired no content callbacks (so no text streamed) and
    // always appended on content.added (so a stray empty part lingered). This asserts
    // text accumulates AND the content array stays a single part.
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });

    cb.onItemAdded!(itemAdded(makeItem({ id: "m", ts: 100, type: "message", content: [{ type: "output_text", text: "" }] } as Partial<OutputItem> & { id: string })));
    cb.onContentAdded!(contentAdded("m", 0, { type: "output_text", text: "" }));
    cb.onContentDelta!(contentDelta("m", 0, "Hel"));
    cb.onContentDelta!(contentDelta("m", 0, "lo"));

    // The binder buffers deltas; the consumer flushes before reading.
    expect(store.flushDeltas()).toBe(true);
    let item = store.getById("m") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content).toHaveLength(1);
    expect(item.content![0]!.text).toBe("Hello");

    cb.onContentDone!(contentDone("m", 0, { type: "output_text", text: "Hello" }));
    item = store.getById("m") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content).toHaveLength(1);
    expect(item.content![0]!.text).toBe("Hello");
    expect(onChange).toHaveBeenCalledWith("content");
  });

  it("onContentAdded places a part and signals content", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onItemAdded!(itemAdded(makeItem({ id: "m", ts: 100, type: "message", content: [] } as Partial<OutputItem> & { id: string })));
    onChange.mockClear();
    cb.onContentAdded!(contentAdded("m", 0, { type: "output_text", text: "hi" }));
    const item = store.getById("m") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content![0]!.text).toBe("hi");
    expect(onChange).toHaveBeenCalledWith("content");
  });

  it("buffers a delta for an unknown item without signaling, then applies it when the item arrives", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });

    // Delta arrives before item.added: buffered, but no phantom flush.
    cb.onContentDelta!(contentDelta("m", 0, "Hi"));
    expect(onChange).not.toHaveBeenCalled();

    // item.added signals; the consumer's flush then applies the buffered delta.
    cb.onItemAdded!(itemAdded(makeItem({ id: "m", ts: 100, type: "message", content: [{ type: "output_text", text: "" }] } as Partial<OutputItem> & { id: string })));
    expect(onChange).toHaveBeenCalledWith("item");
    expect(store.flushDeltas()).toBe(true);
    const item = store.getById("m") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content![0]!.text).toBe("Hi");
  });

  it("does not signal a flush for a filtered-out item's deltas", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, {
      onChange,
      itemFilter: (item) => item.type === "message"
    });

    // The status item is filtered out (never upserted); its deltas must not flush.
    cb.onItemAdded!(itemAdded(makeItem({ id: "s", ts: 100, type: "status" })));
    onChange.mockClear();
    cb.onContentDelta!(contentDelta("s", 0, "x"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards a filtered item's buffered deltas at the filter seam (no unbounded queue)", () => {
    const store = createRequestStreamStore();
    const cb = bindStoreToCallbacks(store, {
      itemFilter: (item) => item.type === "message"
    });

    // A delta for the to-be-filtered status item arrives before its item.added.
    cb.onContentDelta!(contentDelta("s", 0, "x"));
    // item.added is rejected by the filter → its buffered delta is discarded,
    // not left to accumulate. (An absent-item delta is otherwise kept buffered
    // forever, since flushDeltas can't tell a filtered item from a late one.)
    cb.onItemAdded!(itemAdded(makeItem({ id: "s", ts: 100, type: "status" })));

    // Prove it's gone: if an item with that id later enters the store directly,
    // the discarded delta does not resurface.
    store.upsert(makeItem({ id: "s", ts: 100, type: "message", content: [{ type: "output_text", text: "Z" }] } as Partial<OutputItem> & { id: string }));
    expect(store.flushDeltas()).toBe(false);
    const item = store.getById("s") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content![0]!.text).toBe("Z");
  });

  it("drops deltas that arrive after an item is rejected, even with no item.done (no unbounded buffer)", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, {
      onChange,
      itemFilter: (item) => item.type === "message"
    });

    // Rejected item.added, then deltas keep streaming in afterward — and the
    // stream aborts before any item.done that would otherwise clean them up.
    cb.onItemAdded!(itemAdded(makeItem({ id: "s", ts: 100, type: "status" })));
    onChange.mockClear();
    cb.onContentDelta!(contentDelta("s", 0, "x"));
    cb.onContentDelta!(contentDelta("s", 0, "y"));

    // Nothing was buffered (and nothing signalled): a flush is a no-op, and an
    // item with that id later entering the store picks up no stale text.
    expect(onChange).not.toHaveBeenCalled();
    expect(store.flushDeltas()).toBe(false);
    store.upsert(makeItem({ id: "s", ts: 100, type: "message", content: [{ type: "output_text", text: "Z" }] } as Partial<OutputItem> & { id: string }));
    expect(store.flushDeltas()).toBe(false);
    const item = store.getById("s") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content![0]!.text).toBe("Z");
  });

  it("onContentAdded for a missing item signals nothing", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onContentAdded!(contentAdded("missing", 0, { type: "output_text", text: "hi" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not duplicate text when deltas and content.done are batched into one flush (RAF case)", () => {
    // The consumer flushes once per frame; deltas and the done can land in the
    // same frame. The single deferred flushDeltas must not re-apply the deltas
    // the content.done already superseded.
    const store = createRequestStreamStore();
    const cb = bindStoreToCallbacks(store);

    cb.onItemAdded!(itemAdded(makeItem({ id: "m", ts: 100, type: "message", content: [{ type: "output_text", text: "" }] } as Partial<OutputItem> & { id: string })));
    cb.onContentAdded!(contentAdded("m", 0, { type: "output_text", text: "" }));
    cb.onContentDelta!(contentDelta("m", 0, "Hel"));
    cb.onContentDelta!(contentDelta("m", 0, "lo"));
    cb.onContentDone!(contentDone("m", 0, { type: "output_text", text: "Hello" }));

    // Deferred single flush at the frame boundary — must be a no-op now.
    expect(store.flushDeltas()).toBe(false);
    const item = store.getById("m") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content).toHaveLength(1);
    expect(item.content![0]!.text).toBe("Hello");
  });

  it("onContentDone replaces the part with the final content", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onItemAdded!(itemAdded(makeItem({ id: "m", ts: 100, type: "message", content: [{ type: "output_text", text: "partial" }] } as Partial<OutputItem> & { id: string })));
    onChange.mockClear();
    cb.onContentDone!(contentDone("m", 0, { type: "output_text", text: "final" }));
    const item = store.getById("m") as OutputItem & { content?: Array<{ text: string }> };
    expect(item.content![0]!.text).toBe("final");
    expect(onChange).toHaveBeenCalledWith("content");
  });
});
