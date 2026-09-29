/**
 * The terminal replay of `GET …/requests/:id/stream` checks who owns the
 * record, then reads the events. A request id is the caller's to choose, and
 * retention can delete a finished request between those two reads, after
 * which anyone may take the id. The events read then are the new request's,
 * so the replay must not hand them to the caller the old record admitted.
 */
import type { MessageItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src";
import type { FlowRegistry } from "../src/registry/flow-registry";
import { handleRequestStream } from "../src/routes/stream-routes";
import type { ParsedFlowRoute } from "../src/routes/parseFlowRoute";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

const FLOW_KIND = "reused-id-flow";
const REQUEST_ID = "req_reused";

function stubRegistry(): FlowRegistry {
  return {
    get: (kind: string) => (kind === FLOW_KIND ? { kind: FLOW_KIND } : undefined)
  } as unknown as FlowRegistry;
}

function completedRecord(userId: string, incarnation: string): RequestRecord {
  return {
    id: REQUEST_ID,
    flowKind: FLOW_KIND,
    actionName: "run",
    userId,
    sessionId: `sess_${userId}`,
    status: "completed",
    startedAtMs: 100,
    completedAtMs: 200,
    // Same millisecond for both requests: only the incarnation differs.
    createdAt: 100,
    updatedAt: 200,
    incarnation,
    version: 1,
    state: {},
    items: []
  };
}

function message(text: string): MessageItem {
  return {
    id: "item_0",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status: "completed",
    requestId: REQUEST_ID,
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
    ts: 101
  };
}

function events(marker: string): RequestStreamEvent[] {
  return [
    { stream: "request", type: "request.created", requestId: REQUEST_ID, sequence_number: 1, status: "in_progress", ts: 100 },
    { stream: "request", type: "item.done", requestId: REQUEST_ID, sequence_number: 2, ts: 101, item: message(marker) },
    { stream: "request", type: "request.completed", requestId: REQUEST_ID, sequence_number: 3, status: "completed", ts: 102 }
  ];
}

const route = { kind: "request_stream", flowKind: FLOW_KIND, requestId: REQUEST_ID } as Extract<
  ParsedFlowRoute,
  { kind: "request_stream" }
>;

describe("terminal replay of a request id taken again mid-read", () => {
  it("does not replay the new request's events to the caller the old record admitted", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    await stores.request.set(REQUEST_ID, completedRecord("alice", "inc_alice"), "any");
    stores.request.persistEvents(REQUEST_ID, events("alice's"));
    await stores.request.flushEvents(REQUEST_ID);

    // Between the ownership check and the event read: retention deletes
    // alice's request, and bob's request takes the id.
    const getEvents = stores.request.getEvents.bind(stores.request);
    stores.request.getEvents = async (id, fromSequence) => {
      await stores.request.delete(REQUEST_ID);
      await stores.request.set(REQUEST_ID, completedRecord("bob", "inc_bob"), "any");
      stores.request.persistEvents(REQUEST_ID, events("bob's secret"));
      await stores.request.flushEvents(REQUEST_ID);
      return getEvents(id, fromSequence);
    };

    const response = await handleRequestStream(
      new Request("https://x/y/stream"),
      route,
      { registry: stubRegistry(), stores }
    );

    const body = await response.text();
    expect(body).not.toContain("bob's secret");
    expect(response.status).toBe(404);
  });

  it("still replays when the record under the id is the one that was checked", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    await stores.request.set(REQUEST_ID, completedRecord("alice", "inc_alice"), "any");
    stores.request.persistEvents(REQUEST_ID, events("alice's"));
    await stores.request.flushEvents(REQUEST_ID);

    const response = await handleRequestStream(
      new Request("https://x/y/stream"),
      route,
      { registry: stubRegistry(), stores }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("alice's");
  });
});
