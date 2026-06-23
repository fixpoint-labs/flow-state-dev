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

  it("onRequestCreated sets status and signals status", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onRequestCreated!(requestCreated());
    expect(store.status).toBe("in_progress");
    expect(onChange).toHaveBeenCalledWith("status");
  });

  it("onRequestStatus sets status, logs the event, and signals status", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onRequestStatus!(requestStatus("completed"));
    expect(store.status).toBe("completed");
    expect(store.statusEvents.map((e) => e.status)).toEqual(["completed"]);
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

  it("onContentAdded for a missing item signals nothing", () => {
    const store = createRequestStreamStore();
    const onChange = vi.fn();
    const cb = bindStoreToCallbacks(store, { onChange });
    cb.onContentAdded!(contentAdded("missing", 0, { type: "output_text", text: "hi" }));
    expect(onChange).not.toHaveBeenCalled();
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
