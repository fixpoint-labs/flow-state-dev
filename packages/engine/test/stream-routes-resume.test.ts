/**
 * Route-level tests for SSE resume cursor threading (FIX-685 Slice A).
 *
 * The terminal and GC'd-record replay branches of `handleRequestStream`
 * must push the resolved resume cursor into `getEvents(requestId,
 * fromSequence)` so pre-cursor events are never read from the store, and
 * the item-reconstruction fallback must only fire when the *unfiltered*
 * event log is empty (not when a cursor filtered everything out).
 */
import type { MessageItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { describe, expect, it, vi } from "vitest";
import { handleRequestStream } from "../src/routes/stream-routes";
import { createInMemoryStores } from "../src";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { ParsedFlowRoute } from "../src/routes/parseFlowRoute";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

const FLOW_KIND = "resume-flow";

function stubRegistry(): FlowRegistry {
  return { get: (kind: string) => (kind === FLOW_KIND ? { kind: FLOW_KIND } : undefined) } as unknown as FlowRegistry;
}

function makeMessageItem(requestId: string, itemIndex: number): MessageItem {
  return {
    id: `item_${itemIndex}`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: `hello ${itemIndex}` }],
    status: "completed",
    requestId,
    itemIndex,
    provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
    ts: 100 + itemIndex
  };
}

function completedRecord(requestId: string, items: MessageItem[]): RequestRecord {
  return {
    id: requestId,
    flowKind: FLOW_KIND,
    actionName: "run",
    userId: "user_1",
    sessionId: "sess_1",
    status: "completed",
    startedAtMs: 100,
    completedAtMs: 200,
    version: 1,
    createdAt: 100,
    updatedAt: 200,
    state: {},
    items
  };
}

function streamEvents(requestId: string): RequestStreamEvent[] {
  return [
    { stream: "request", type: "request.created", requestId, sequence_number: 1, status: "in_progress", ts: 100 },
    { stream: "request", type: "item.added", requestId, sequence_number: 2, ts: 101, item: makeMessageItem(requestId, 0) },
    { stream: "request", type: "item.done", requestId, sequence_number: 3, ts: 102, item: makeMessageItem(requestId, 0) },
    { stream: "request", type: "request.completed", requestId, sequence_number: 4, status: "completed", ts: 103 }
  ];
}

function streamRoute(requestId: string): Extract<ParsedFlowRoute, { kind: "request_stream" }> {
  return { kind: "request_stream", flowKind: FLOW_KIND, requestId } as Extract<
    ParsedFlowRoute,
    { kind: "request_stream" }
  >;
}

async function readBody(response: Response): Promise<string> {
  return await response.text();
}

describe("stream resume — route cursor threading (Slice A)", () => {
  it("terminal replay reads the store from the resume cursor", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    const requestId = "req_terminal_cursor";

    await stores.request.set(requestId, completedRecord(requestId, [makeMessageItem(requestId, 0)]), "any");
    stores.request.persistEvents(requestId, streamEvents(requestId));
    await stores.request.flushEvents(requestId);

    const getEventsSpy = vi.spyOn(stores.request, "getEvents");

    const request = new Request("https://x/y/stream", {
      headers: { "last-event-id": `${requestId}:2` }
    });

    const response = await handleRequestStream(request, streamRoute(requestId), {
      registry: stubRegistry(),
      stores
    });

    // The store read is pushed past the cursor — not a full-log read.
    expect(getEventsSpy).toHaveBeenCalledWith(requestId, 2);

    const body = await readBody(response);
    // Only events after seq 2 reach the wire (item.done @3, request.completed @4).
    expect(body).not.toContain("\"sequence_number\":1");
    expect(body).not.toContain("\"sequence_number\":2");
    expect(body).toContain("request.completed");
  });

  it("terminal replay with no cursor still reconstructs from items when the log is empty", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    const requestId = "req_terminal_empty";

    // No persisted events — only a completed record with items.
    await stores.request.set(requestId, completedRecord(requestId, [makeMessageItem(requestId, 0)]), "any");

    const request = new Request("https://x/y/stream");
    const response = await handleRequestStream(request, streamRoute(requestId), {
      registry: stubRegistry(),
      stores
    });

    const body = await readBody(response);
    // Item-based reconstruction produces item.added/item.done for the message.
    expect(body).toContain("item.added");
  });

  it("terminal replay does NOT reconstruct when a cursor filters every event", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    const requestId = "req_terminal_filtered";

    await stores.request.set(requestId, completedRecord(requestId, [makeMessageItem(requestId, 0)]), "any");
    stores.request.persistEvents(requestId, streamEvents(requestId));
    await stores.request.flushEvents(requestId);

    // Cursor past the end of the log: nothing new, must NOT fall back to
    // item reconstruction (which would re-deliver the whole turn).
    const request = new Request("https://x/y/stream", {
      headers: { "last-event-id": `${requestId}:99` }
    });
    const response = await handleRequestStream(request, streamRoute(requestId), {
      registry: stubRegistry(),
      stores
    });

    const body = await readBody(response);
    expect(body).toBe("");
  });

  it("GC'd-record replay reads the store from the resume cursor", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    const requestId = "req_gcd_cursor";

    // No request record (GC'd) — only persisted events survive.
    stores.request.persistEvents(requestId, streamEvents(requestId));
    await stores.request.flushEvents(requestId);

    const getEventsSpy = vi.spyOn(stores.request, "getEvents");

    const request = new Request("https://x/y/stream", {
      headers: { "last-event-id": `${requestId}:2` }
    });
    const response = await handleRequestStream(request, streamRoute(requestId), {
      registry: stubRegistry(),
      stores
    });

    expect(getEventsSpy).toHaveBeenCalledWith(requestId, 2);
    const body = await readBody(response);
    expect(body).toContain("request.completed");
    expect(body).not.toContain("\"sequence_number\":1");
  });

  it("GC'd-record replay 404s only when the unfiltered log is empty", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    const requestId = "req_gcd_unknown";

    const request = new Request("https://x/y/stream");
    const response = await handleRequestStream(request, streamRoute(requestId), {
      registry: stubRegistry(),
      stores
    });

    expect(response.status).toBe(404);
  });
});
