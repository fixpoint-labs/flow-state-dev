/**
 * `GET /sessions/:sessionId/stream` as a route: where it sits in the table, and
 * that it shows exactly what the session snapshot shows. The store-dependent
 * behaviour (what is read, when, and when it stops) is the conformance suite's,
 * run per adapter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBlockInstanceId, DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { OutputItem, SessionStreamEvent } from "@flow-state-dev/core/items";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
  parseFlowRoute
} from "../src";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src";
import { SESSION_STREAM_TIMINGS } from "../src/routes/session-stream-routes";

type Router = ReturnType<typeof createFlowApiRouter>;

describe("route registration", () => {
  it("resolves GET /sessions/:sessionId/stream", () => {
    expect(parseFlowRoute("GET", ["sessions", "sess_abc", "stream"])).toEqual({
      kind: "session_stream",
      sessionId: "sess_abc"
    });
  });

  it("does not shadow the sibling session reads", () => {
    expect(parseFlowRoute("GET", ["sessions", "sess_abc", "state"]).kind).toBe(
      "get_session_state"
    );
    expect(parseFlowRoute("GET", ["sessions", "sess_abc", "children"]).kind).toBe(
      "list_session_children"
    );
    expect(parseFlowRoute("GET", ["sessions", "sess_abc", "requests"]).kind).toBe(
      "list_session_requests"
    );
  });
});

// ---------------------------------------------------------------------------
// V2: the stream and the snapshot show one set
// ---------------------------------------------------------------------------

const REQ_A = "req_a";
const REQ_B = "req_b";
const GATE = buildBlockInstanceId(REQ_A, "root/step[0]", 0);
const OTHER = buildBlockInstanceId(REQ_A, "root/step[1]", 0);
const IN_B = buildBlockInstanceId(REQ_B, "root", 0);

/** One item of `type`, finished, owned by `instanceId`. */
function item(
  requestId: string,
  id: string,
  type: string,
  itemIndex: number,
  instanceId: string,
  extra: Record<string, unknown> = {}
): OutputItem {
  return {
    id,
    type,
    status: "completed",
    requestId,
    itemIndex,
    ts: itemIndex,
    provenance: { blockName: "b", blockInstanceId: instanceId, phase: "main" },
    ...extra
  } as unknown as OutputItem;
}

const text = (value: string) => ({ role: "assistant", content: [{ type: "output_text", text: value }] });

/**
 * Every item kind the item registry names, in two requests, with the three
 * ways a snapshot hides one: a kind that is never shown (traces, router
 * decisions, state snapshots), a stamp that hides it from the client, and a
 * copy a crash-recovery re-run superseded.
 */
const REQUEST_A_ITEMS: OutputItem[] = [
  item(REQ_A, "t1", "block_trace", 0, GATE, { status: "in_progress" }),
  item(REQ_A, "m_superseded", "message", 1, GATE, text("run one")),
  item(REQ_A, "t2", "block_trace", 2, GATE),
  item(REQ_A, "m_rerun", "message", 3, GATE, text("run two")),
  item(REQ_A, "m_hidden", "message", 4, OTHER, {
    ...text("not for the client"),
    itemVisibility: { client: false, history: true }
  }),
  item(REQ_A, "reasoning", "reasoning", 5, OTHER, { summary: [] }),
  item(REQ_A, "tool", "tool_output", 6, OTHER, { callId: "c1", toolName: "t", output: {} }),
  item(REQ_A, "component", "component", 7, OTHER, { name: "widget", props: {} }),
  item(REQ_A, "container", "container", 8, OTHER, { children: [] }),
  item(REQ_A, "status", "status", 9, OTHER, { message: "working" }),
  item(REQ_A, "state_change", "state_change", 10, OTHER, { scope: "session", changes: [] }),
  item(REQ_A, "resource_change", "resource_change", 11, OTHER, { resourcePath: "r" }),
  item(REQ_A, "error", "error", 12, OTHER, { message: "boom", code: "x" }),
  item(REQ_A, "source", "source", 13, OTHER, { url: "https://example.test" }),
  item(REQ_A, "router_decision", "router_decision", 14, OTHER, { route: "a" }),
  item(REQ_A, "state_snapshot", "state_snapshot", 15, OTHER, { state: {} }),
  item(REQ_A, "generator_step", "generator_step", 16, OTHER, { stepNumber: 0 })
];

const REQUEST_B_ITEMS: OutputItem[] = [
  item(REQ_B, "t_b", "block_trace", 0, IN_B),
  item(REQ_B, "suspension", "suspension", 1, IN_B, { blockInstanceId: IN_B }),
  item(REQ_B, "suspension_resume", "suspension_resume", 2, IN_B),
  item(REQ_B, "continuation", "continuation", 3, IN_B),
  item(REQ_B, "m_b", "message", 4, IN_B, text("from b"))
];

/** Seed `s1` with both requests, finished and last updated at `now`. */
async function seedSession(stores: StoreRegistry, now = Date.now()): Promise<void> {
  const record: SessionRecord = {
    orgId: DEFAULT_ORG_ID,
    id: "s1",
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: []
  };
  await stores.session.set(record.id, record, "any");
  for (const [id, items] of [
    [REQ_A, REQUEST_A_ITEMS],
    [REQ_B, REQUEST_B_ITEMS]
  ] as const) {
    const request = {
      id,
      sessionId: "s1",
      flowKind: "chat",
      actionName: "say",
      userId: "alice",
      orgId: DEFAULT_ORG_ID,
      source: "http",
      status: "completed",
      startedAtMs: now,
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      items: [...items]
    } as RequestRecord;
    await stores.request.set(id, request, "any");
  }
}

function buildRouter(): { router: Router; stores: StoreRegistry } {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "chat",
      actions: { say: { block: handler({ name: "say", execute: () => ({}) }) } }
    })
  );
  const stores = createInMemoryStores();
  return { router: createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 }), stores };
}

/** The (request, item) pairs a snapshot of `s1` shows. */
async function snapshotPairs(router: Router, query = ""): Promise<string[]> {
  const res = await router.GET(
    new Request(`http://localhost/api/flows/sessions/s1/state?include_items=true${query}`),
    { params: { path: ["sessions", "s1", "state"] } }
  );
  expect(res.status).toBe(200);
  const { items } = (await res.json()) as { items: OutputItem[] };
  return items.map((i) => `${i.requestId}/${i.id}`).sort();
}

/** Every event the stream sends for `s1` over a few reads. */
async function streamedEvents(router: Router, query = ""): Promise<SessionStreamEvent[]> {
  const controller = new AbortController();
  const res = await router.GET(
    new Request(`http://localhost/api/flows/sessions/s1/stream${query === "" ? "" : `?${query.slice(1)}`}`, {
      signal: controller.signal
    }),
    { params: { path: ["sessions", "s1", "stream"] } }
  );
  expect(res.status).toBe(200);
  setTimeout(() => controller.abort(), SESSION_STREAM_TIMINGS.intervalMs * 4);
  const body = await res.text();
  return body
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice(6)) as SessionStreamEvent);
}

/** The (request, item) pair a `session.item` event names; `undefined` for any other event. */
function pairOf(event: SessionStreamEvent): string | undefined {
  return event.type === "session.item" ? `${event.requestId}/${event.item.id}` : undefined;
}

/** The (request, item) pairs the stream sends for `s1` over a few reads. */
async function streamedPairs(router: Router, query = ""): Promise<string[]> {
  return (await streamedEvents(router, query))
    .map(pairOf)
    .filter((pair): pair is string => pair !== undefined)
    .sort();
}

describe("the stream shows what the snapshot shows (V2)", () => {
  const shipped = { ...SESSION_STREAM_TIMINGS };
  let router: Router | undefined;

  beforeEach(() => {
    SESSION_STREAM_TIMINGS.intervalMs = 25;
  });

  afterEach(async () => {
    Object.assign(SESSION_STREAM_TIMINGS, shipped);
    if (router !== undefined) await disposeFlowApiRouter(router);
    router = undefined;
  });

  it("streams the same items as a reload, across every item kind", async () => {
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores);

    const snapshot = await snapshotPairs(router);
    // The fixture hides something, or this compares two unfiltered logs.
    expect(snapshot).not.toContain(`${REQ_A}/m_superseded`);
    expect(snapshot).not.toContain(`${REQ_A}/m_hidden`);
    expect(snapshot).not.toContain(`${REQ_A}/t2`);
    expect(snapshot).toContain(`${REQ_A}/m_rerun`);

    expect(await streamedPairs(router)).toEqual(snapshot);
  });

  it("applies the snapshot's own type filter", async () => {
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores);

    const snapshot = await snapshotPairs(router, "&item_types=message,status");
    // The type filter stands in for the visibility rule, as it always has on
    // the snapshot: a named type is shown even when its stamp would hide it.
    expect(snapshot).toEqual(
      [`${REQ_A}/m_hidden`, `${REQ_A}/m_rerun`, `${REQ_A}/status`, `${REQ_B}/m_b`].sort()
    );
    expect(await streamedPairs(router, "&item_types=message,status")).toEqual(snapshot);
  });
});

/** Keep one finished request `id` in `s1`, holding `items`, last updated at `updatedAt`. */
async function keepRequest(
  stores: StoreRegistry,
  id: string,
  items: OutputItem[],
  updatedAt: number
): Promise<void> {
  await stores.request.set(
    id,
    {
      id,
      sessionId: "s1",
      flowKind: "chat",
      actionName: "say",
      userId: "alice",
      orgId: DEFAULT_ORG_ID,
      source: "http",
      status: "completed",
      startedAtMs: updatedAt,
      state: {},
      version: 0,
      createdAt: updatedAt,
      updatedAt,
      items
    } as RequestRecord,
    "any"
  );
}

/** Request `requestId`'s one message, at time 0 and index 0, as every request's first item is. */
function reply(requestId: string): OutputItem {
  return item(requestId, `${requestId}_m`, "message", 0, buildBlockInstanceId(requestId, "root", 0), text(requestId));
}

/** The snapshot of `s1`: its read time and its (request, item) pairs in order. */
async function snapshotOf(router: Router): Promise<{ at: unknown; pairs: string[] }> {
  const res = await router.GET(
    new Request("http://localhost/api/flows/sessions/s1/state?include_items=true"),
    { params: { path: ["sessions", "s1", "state"] } }
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { at?: unknown; items: OutputItem[] };
  return { at: body.at, pairs: body.items.map((i) => `${i.requestId}/${i.id}`) };
}

describe("the snapshot hands over to the stream", () => {
  const shipped = { ...SESSION_STREAM_TIMINGS };
  let router: Router | undefined;

  beforeEach(() => {
    SESSION_STREAM_TIMINGS.intervalMs = 25;
  });

  afterEach(async () => {
    Object.assign(SESSION_STREAM_TIMINGS, shipped);
    if (router !== undefined) await disposeFlowApiRouter(router);
    router = undefined;
  });

  // The store lists a session's requests newest-updated first, so before a
  // tie-breaker two items that share a time and an index swapped whenever the
  // older request was touched. A client sorts with the same comparator.
  it("orders two requests' items that tie on time and index by request id, whichever was updated last", async () => {
    for (const [first, second] of [
      [REQ_A, REQ_B],
      [REQ_B, REQ_A]
    ] as const) {
      const built = buildRouter();
      router = built.router;
      // The session, then both requests replaced by one message each.
      await seedSession(built.stores);
      await keepRequest(built.stores, first, [reply(first)], 100);
      await keepRequest(built.stores, second, [reply(second)], 200);

      const { pairs } = await snapshotOf(router);
      expect(pairs, `${second} updated last`).toEqual([`${REQ_A}/${REQ_A}_m`, `${REQ_B}/${REQ_B}_m`]);
      await disposeFlowApiRouter(router);
      router = undefined;
    }
  });

  // Without `since` the first read reaches back a fixed window (a minute in
  // production). A snapshot that takes longer than that to reach the client
  // would leave an item kept just after it in neither.
  it("sends an item kept just after the snapshot, however long the snapshot took, from the snapshot's `at`", async () => {
    // Both windows shortened, so a 150 ms wait stands in for a snapshot slower
    // than the first read's minute (and than every later read's margin).
    SESSION_STREAM_TIMINGS.firstReadWindowMs = 50;
    SESSION_STREAM_TIMINGS.marginMs = 20;
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores, Date.now() - 60_000);

    const { at, pairs } = await snapshotOf(router);
    expect(typeof at).toBe("number");
    await keepRequest(built.stores, "req_after", [item("req_after", "m_after", "message", 0, buildBlockInstanceId("req_after", "root", 0), text("after"))], Date.now());
    expect(pairs).not.toContain("req_after/m_after");
    // The snapshot took longer to arrive than the first read's window.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(await streamedPairs(router)).not.toContain("req_after/m_after");
    expect(await streamedPairs(router, `&since=${String(at)}`)).toContain("req_after/m_after");
  });
});

describe("a scan that rows move during", () => {
  const shipped = { ...SESSION_STREAM_TIMINGS };
  let router: Router | undefined;

  beforeEach(() => {
    SESSION_STREAM_TIMINGS.intervalMs = 25;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.assign(SESSION_STREAM_TIMINGS, shipped);
    if (router !== undefined) await disposeFlowApiRouter(router);
    router = undefined;
  });

  // More requests changed since the floor than one read of them returns, so
  // the scan reads twice. Between the two reads, a server whose clock runs a
  // few milliseconds behind rewrites the newest request, which moves it down
  // the order. A second page at an offset would then start one row late, and
  // the request it skips is older than every later read's floor, so its line
  // would never be sent.
  it("sends every line when a write moves a row between two reads of one scan", async () => {
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores, Date.now() - 600_000);
    const base = Date.now() - 30_000;
    const ids = Array.from({ length: 25 }, (_, i) => `r${String(i + 1).padStart(2, "0")}`);
    for (const [i, id] of ids.entries()) {
      await keepRequest(built.stores, id, [reply(id)], base + i + 1);
    }

    const list = built.stores.request.list.bind(built.stores.request);
    let ordered = 0;
    vi.spyOn(built.stores.request, "list").mockImplementation(async (options) => {
      if (options?.orderBy === "updatedAt" && ++ordered === 2) {
        const newest = await built.stores.request.get("r25");
        // Now just older than r04: it drops from first to 22nd.
        await built.stores.request.set("r25", { ...newest!, updatedAt: base + 3.5 }, "any");
      }
      return list(options);
    });

    const pairs = await streamedPairs(router);
    expect(ordered).toBeGreaterThanOrEqual(2);
    expect(ids.filter((id) => !pairs.includes(`${id}/${id}_m`))).toEqual([]);
  });
});

describe("a connection that ends", () => {
  const shipped = { ...SESSION_STREAM_TIMINGS };
  let router: Router | undefined;

  beforeEach(() => {
    SESSION_STREAM_TIMINGS.intervalMs = 25;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.assign(SESSION_STREAM_TIMINGS, shipped);
    if (router !== undefined) await disposeFlowApiRouter(router);
    router = undefined;
  });

  // A client hands back the last `at` it heard as `since`. Whatever event the
  // connection dropped after (the opening notice, or an item midway through a
  // read), the reconnect has to send every item the client had not heard yet.
  it("sends every item not yet heard, whichever event it dropped after", async () => {
    const built = buildRouter();
    router = built.router;
    // Kept half a minute before the view opens: inside the first read's
    // window, and well before the time that read starts.
    await seedSession(built.stores, Date.now() - 30_000);

    const events = await streamedEvents(router);
    const pairs = events.map(pairOf);
    const all = pairs.filter((pair): pair is string => pair !== undefined);
    // The opening notice comes first, then more than one item, so some drop
    // points fall before the first read and some midway through it.
    expect(events[0]?.type).toBe("session.runs");
    expect(all.length).toBeGreaterThan(1);

    for (const [index, event] of events.entries()) {
      const heard = new Set(pairs.slice(0, index + 1));
      const resumed = new Set(await streamedPairs(router, `&since=${event.at}`));
      const missed = all.filter((pair) => !heard.has(pair) && !resumed.has(pair));
      expect(missed, `dropped after event ${index} (${event.type})`).toEqual([]);
    }
  });

  // A failed read ends the connection and the client reconnects, so a store
  // outage fails every read of every open view. It is worth one line, not one
  // per read.
  it("ends the connection on a failed read, and logs each kind of failure once", async () => {
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores);
    class StoreDown extends Error {
      override name = "StoreDownForTest";
    }
    vi.spyOn(built.stores.request, "list").mockRejectedValue(new StoreDown("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let attempt = 0; attempt < 3; attempt++) {
      const events = await streamedEvents(router);
      // The opening notice, then the failed read ends the connection.
      expect(events.map((event) => event.type)).toEqual(["session.runs"]);
    }
    const logged = warn.mock.calls.filter((call) => call[1] instanceof StoreDown);
    expect(logged).toHaveLength(1);
  });
});
