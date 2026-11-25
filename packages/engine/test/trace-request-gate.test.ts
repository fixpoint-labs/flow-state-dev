/**
 * `?include=trace` asks a route for the items the client view hides. A caller
 * chooses its query string, so the query alone must not open them: the request
 * stream and `/continue` honour it only while trace observability is on (off
 * in production unless `FSDEV_TRACE_OBSERVABILITY=true`). With it off, the request
 * is ignored and the caller gets the client view, once-per-process logged.
 *
 * Two more routes must keep to the client view while observability is off: a
 * request stream resumed with a cursor (it must still know which items it is
 * hiding when their `item.added` came before the cursor), and the session
 * request list's `include_items` item logs.
 */
import { DEFAULT_ORG_ID, __resetDeprecationWarningsForTests, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { oneOffSessionId } from "@flow-state-dev/core/helpers";
import type { MessageItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { ParsedFlowRoute } from "../src/routes/parseFlowRoute";
import { handleContinueRequest } from "../src/routes/recovery-routes";
import { handleListSessionRequests } from "../src/routes/session-routes";
import { handleRequestStream } from "../src/routes/stream-routes";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";
import type { InboundTransportHost } from "../src/transports/types";

const FLOW_KIND = "trace-gate-flow";
const REQUEST_ID = "req_trace_gate";

/** Production with the flag unset: observability off. */
function observabilityOff(): void {
  process.env.NODE_ENV = "production";
  delete process.env.FSDEV_TRACE_OBSERVABILITY;
}

/** Production with the flag set: observability on. */
function observabilityOn(): void {
  process.env.NODE_ENV = "production";
  process.env.FSDEV_TRACE_OBSERVABILITY = "true";
}

const savedEnv = { ...process.env };
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetDeprecationWarningsForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...savedEnv };
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// GET …/requests/:id/stream?include=trace
// ---------------------------------------------------------------------------

function message(id: string, text: string, client: boolean, itemIndex: number): MessageItem {
  return {
    id,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status: "completed",
    requestId: REQUEST_ID,
    itemIndex,
    provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
    ts: 101,
    ...(client ? {} : { itemVisibility: { client: false, history: true } })
  };
}

const EVENTS: RequestStreamEvent[] = [
  { stream: "request", type: "request.created", requestId: REQUEST_ID, sequence_number: 1, status: "in_progress", ts: 100 },
  { stream: "request", type: "item.done", requestId: REQUEST_ID, sequence_number: 2, ts: 101, item: message("m_hidden", "hidden-text", false, 0) },
  { stream: "request", type: "item.done", requestId: REQUEST_ID, sequence_number: 3, ts: 101, item: message("m_visible", "visible-text", true, 1) },
  { stream: "request", type: "request.completed", requestId: REQUEST_ID, sequence_number: 4, status: "completed", ts: 102 }
];

function record(status: RequestRecord["status"]): RequestRecord {
  return {
    id: REQUEST_ID,
    flowKind: FLOW_KIND,
    actionName: "run",
    source: "http",
    userId: "alice",
    sessionId: "sess_alice",
    status,
    startedAtMs: 100,
    createdAt: 100,
    updatedAt: 200,
    incarnation: "inc_1",
    version: 1,
    state: {},
    items: []
  };
}

function stubRegistry(): FlowRegistry {
  return {
    get: (kind: string) => (kind === FLOW_KIND ? { kind: FLOW_KIND } : undefined)
  } as unknown as FlowRegistry;
}

const streamRoute = { kind: "request_stream", flowKind: FLOW_KIND, requestId: REQUEST_ID } as Extract<
  ParsedFlowRoute,
  { kind: "request_stream" }
>;

/** Stores holding the request the way each of the route's three branches reads it. */
async function storesFor(branch: "terminal replay" | "live tail" | "record-less replay"): Promise<StoreRegistry> {
  const stores: StoreRegistry = createInMemoryStores();
  if (branch === "live tail") {
    await stores.request.set(REQUEST_ID, record("in_progress"), "any");
    stores.request.subscribeToEvents = () =>
      (async function* () {
        for (const event of EVENTS) yield event;
      })();
    return stores;
  }
  if (branch === "terminal replay") {
    await stores.request.set(REQUEST_ID, { ...record("completed"), completedAtMs: 200 }, "any");
  }
  stores.request.persistEvents(REQUEST_ID, EVENTS);
  await stores.request.flushEvents(REQUEST_ID);
  return stores;
}

async function streamBody(stores: StoreRegistry, query: string): Promise<string> {
  const response = await handleRequestStream(
    new Request(`https://x/api/flows/${FLOW_KIND}/requests/${REQUEST_ID}/stream${query}`),
    streamRoute,
    { registry: stubRegistry(), stores }
  );
  expect(response.status).toBe(200);
  return response.text();
}

describe.each(["terminal replay", "live tail", "record-less replay"] as const)(
  "GET …/requests/:id/stream?include=trace (%s)",
  (branch) => {
    it("ignores the trace request with observability off: no hidden items, the client view still arrives", async () => {
      observabilityOff();
      const body = await streamBody(await storesFor(branch), "?include=trace");
      expect(body).toContain("visible-text");
      expect(body).not.toContain("hidden-text");
    });

    it("serves the hidden items with observability on, as before", async () => {
      observabilityOn();
      const body = await streamBody(await storesFor(branch), "?include=trace");
      expect(body).toContain("visible-text");
      expect(body).toContain("hidden-text");
    });
  }
);

describe("an ignored trace request is logged once per process", () => {
  it("warns once across several ignored requests, and not at all when none is made", async () => {
    observabilityOff();
    await streamBody(await storesFor("terminal replay"), "");
    expect(warn).not.toHaveBeenCalled();

    await streamBody(await storesFor("terminal replay"), "?include=trace");
    await streamBody(await storesFor("live tail"), "?include=trace");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/trace observability is off/);
  });
});

// ---------------------------------------------------------------------------
// GET …/requests/:id/stream resumed with a cursor
// ---------------------------------------------------------------------------

const BLOCK_TRACE = {
  id: "t_trace",
  type: "block_trace",
  status: "completed",
  requestId: REQUEST_ID,
  itemIndex: 1,
  provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
  ts: 101,
  output: "trace-output"
} as unknown as MessageItem;

/** The hidden message without its text: what `item.added` carries before the text streams. */
function streaming(item: MessageItem): MessageItem {
  return { ...item, status: "in_progress", content: [] };
}

const HIDDEN = message("m_hidden", "hidden-text", false, 0);
const VISIBLE = message("m_visible", "visible-text", true, 2);
const text = (value: string) => ({ type: "output_text", text: value }) as const;
const base = (sequence: number) => ({ stream: "request", requestId: REQUEST_ID, sequence_number: sequence, ts: 101 }) as const;

/** A run whose hidden message and visible message both stream their text as content events. */
const STREAMED: RequestStreamEvent[] = [
  { ...base(1), type: "request.created", status: "in_progress" },
  { ...base(2), type: "item.added", item: streaming(HIDDEN) },
  { ...base(3), type: "content.added", itemId: "m_hidden", contentIndex: 0, content: text("") },
  { ...base(4), type: "content.delta", itemId: "m_hidden", contentIndex: 0, delta: "hidden-text" },
  { ...base(5), type: "content.done", itemId: "m_hidden", contentIndex: 0, content: text("hidden-text") },
  { ...base(6), type: "item.done", item: HIDDEN },
  { ...base(7), type: "item.done", item: BLOCK_TRACE },
  { ...base(8), type: "item.added", item: streaming(VISIBLE) },
  { ...base(9), type: "content.done", itemId: "m_visible", contentIndex: 0, content: text("visible-text") },
  { ...base(10), type: "item.done", item: VISIBLE },
  { ...base(11), type: "request.completed", status: "completed" }
];

/** Stores holding the streamed run, its record carrying the items as a run persists them. */
async function streamedStoresFor(branch: "terminal replay" | "live tail" | "record-less replay"): Promise<StoreRegistry> {
  const stores: StoreRegistry = createInMemoryStores();
  const items = [HIDDEN, BLOCK_TRACE, VISIBLE];
  if (branch === "live tail") {
    await stores.request.set(REQUEST_ID, { ...record("in_progress"), items }, "any");
    stores.request.subscribeToEvents = (_id, options) =>
      (async function* () {
        for (const event of STREAMED) {
          if (event.sequence_number > (options?.fromSequence ?? 0)) yield event;
        }
      })();
    return stores;
  }
  if (branch === "terminal replay") {
    await stores.request.set(REQUEST_ID, { ...record("completed"), completedAtMs: 200, items }, "any");
  }
  stores.request.persistEvents(REQUEST_ID, STREAMED);
  await stores.request.flushEvents(REQUEST_ID);
  return stores;
}

/** The SSE body's events, parsed from its `data:` lines. */
function frames(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

describe.each(["terminal replay", "live tail", "record-less replay"] as const)(
  "GET …/requests/:id/stream resumed between a hidden item's item.added and its content (%s)",
  (branch) => {
    it("sends none of the hidden item's content with observability off", async () => {
      observabilityOff();
      const body = await streamBody(await streamedStoresFor(branch), "?starting_after=2");
      expect(body).toContain("visible-text");
      expect(body).not.toContain("hidden-text");
      expect(body).not.toContain("trace-output");
    });

    it("keeps the client view with observability on when no trace was asked for", async () => {
      observabilityOn();
      const body = await streamBody(await streamedStoresFor(branch), "?starting_after=2");
      expect(body).toContain("visible-text");
      expect(body).not.toContain("hidden-text");
    });

    it("serves the hidden content to a trace request with observability on, as before", async () => {
      observabilityOn();
      const body = await streamBody(await streamedStoresFor(branch), "?starting_after=2&include=trace");
      expect(body).toContain("hidden-text");
      expect(body).toContain("trace-output");
    });

    it("still brings a resumed client the visible item whose item.added came before the cursor", async () => {
      observabilityOff();
      const sent = frames(await streamBody(await streamedStoresFor(branch), "?starting_after=8"));
      // Its content, where the request record says it is visible; with no
      // record, the filter cannot tell, and its item.done carries the row.
      const content = sent.filter((frame) => frame.type === "content.done").map((frame) => frame.itemId);
      expect(content).toEqual(branch === "record-less replay" ? [] : ["m_visible"]);
      const done = sent.filter((frame) => frame.type === "item.done");
      expect(done.map((frame) => (frame.item as { id: string }).id)).toEqual(["m_visible"]);
    });
  }
);

it("sends none of a hidden item's content to a live tail resumed before the record held the item", async () => {
  // The record is read when the stream starts; an item its run has not yet
  // persisted is unknown to the filter, which then drops its content.
  observabilityOff();
  const stores = await streamedStoresFor("live tail");
  await stores.request.set(REQUEST_ID, record("in_progress"), "any");
  const body = await streamBody(stores, "?starting_after=2");
  expect(body).toContain("visible-text");
  expect(body).not.toContain("hidden-text");
});

// ---------------------------------------------------------------------------
// GET …/sessions/:id/requests?include_items=true
// ---------------------------------------------------------------------------

async function listedItemIds(): Promise<string[]> {
  const stores = createInMemoryStores();
  await stores.session.set(
    "sess_alice",
    {
      orgId: DEFAULT_ORG_ID,
      id: "sess_alice",
      flowKind: FLOW_KIND,
      userId: "alice",
      state: {},
      resources: {},
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      journal: []
    },
    "any"
  );
  await stores.request.set(
    REQUEST_ID,
    { ...record("completed"), orgId: DEFAULT_ORG_ID, completedAtMs: 200, items: [HIDDEN, BLOCK_TRACE, VISIBLE] },
    "absent"
  );
  const response = await handleListSessionRequests(
    new Request("https://x/api/flows/sessions/sess_alice/requests?include_items=true"),
    { kind: "list_session_requests", sessionId: "sess_alice" },
    { registry: { get: () => undefined, list: () => [] } as unknown as FlowRegistry, stores }
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { requests: Array<{ items?: Array<{ id: string }> }> };
  expect(body.requests).toHaveLength(1);
  return (body.requests[0]!.items ?? []).map((item) => item.id);
}

describe("GET …/sessions/:id/requests?include_items=true", () => {
  it("lists only client-visible items with observability off", async () => {
    observabilityOff();
    expect(await listedItemIds()).toEqual(["m_visible"]);
  });

  it("lists the whole item log with observability on, as before", async () => {
    observabilityOn();
    expect(await listedItemIds()).toEqual(["m_hidden", "t_trace", "m_visible"]);
  });
});

// ---------------------------------------------------------------------------
// POST …/continue?include=trace
// ---------------------------------------------------------------------------

/** A durable sequencer whose gate emits one hidden and one visible message, then suspends. */
function buildCrashFlow(kind: string): FlowInstance {
  const preStep = handler({
    name: "preStep",
    inputSchema: z.any(),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true })
  });
  const gate = handler({
    name: "gate",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_i, ctx) => {
      ctx.emit.message("hidden-text", { itemVisibility: { client: false, history: true } });
      ctx.emit.message("visible-text");
      return ctx.suspend!({ reason: "user_approval", message: "Approve?" });
    }
  });
  return defineFlow({
    kind,
    actions: {
      run: {
        block: sequencer({ name: "seq", durable: true }).step(preStep).step(gate),
        inputSchema: z.any()
      }
    }
  })({ id: kind });
}

/** Runs the flow to its suspension, then marks it interrupted as the stale sweep would after a crash. */
async function interruptedRequest(kind: string) {
  const flow = buildCrashFlow(kind);
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const sessionId = oneOffSessionId();
  const initial = await runAction({
    sessionId,
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    stores,
    runtimeConfig: { durabilityProvider: provider }
  });
  const requestId = initial.requestId!;
  const suspended = await stores.request.get(requestId);
  await stores.request.set(requestId, { ...suspended!, status: "interrupted", interruptedAt: Date.now() }, "any");
  return { kind, stores, provider, registry, sessionId, requestId };
}

async function continueBody(kind: string, query: string): Promise<string> {
  const c = await interruptedRequest(kind);
  const runtimeConfig = { durabilityProvider: c.provider };
  let finished: Promise<unknown> | undefined;
  const host = {
    continueRequest: async (opts: { requestId: string; includeTrace?: boolean; leaseId?: string }) => {
      const handle = await continueRequest({
        requestId: opts.requestId,
        includeTrace: opts.includeTrace,
        leaseId: opts.leaseId,
        stores: c.stores,
        flowRegistry: c.registry,
        runtimeConfig
      } as never);
      finished = handle.finished;
      return handle;
    }
  } as unknown as InboundTransportHost;
  const response = await handleContinueRequest(
    new Request(`http://localhost/continue${query}`, {
      method: "POST",
      headers: { accept: "text/event-stream" }
    }),
    { kind: "continue_request", flowKind: c.kind, sessionId: c.sessionId, requestId: c.requestId },
    { registry: c.registry, stores: c.stores, runtimeConfig, host } as never
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  await finished;
  return body;
}

describe("POST …/continue?include=trace", () => {
  it("ignores the trace request with observability off: no hidden items, the client view still arrives", async () => {
    observabilityOff();
    const body = await continueBody("trace-gate-continue-off", "?include=trace");
    expect(body).toContain("visible-text");
    expect(body).not.toContain("hidden-text");
  });

  it("serves the hidden items with observability on, as before", async () => {
    observabilityOn();
    const body = await continueBody("trace-gate-continue-on", "?include=trace");
    expect(body).toContain("visible-text");
    expect(body).toContain("hidden-text");
  });
});
