/**
 * `GET /sessions/:sessionId/stream` as a route: where it sits in the table, and
 * that it shows exactly what the session snapshot shows. The store-dependent
 * behaviour (what is read, when, and when it stops) is the conformance suite's,
 * run per adapter.
 */
import v8 from "node:v8";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildBlockInstanceId, DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
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

  // Every run under the session is read once, when the stream opens, to find
  // the unfinished ones. An old run still working has an old update time, so
  // no later read finds it. A run deleted while that read goes on shifts the
  // runs after it, and one read at an offset would then skip the run that
  // moved onto a page already read.
  it("names an older unfinished run when another run is deleted during the first read of runs", async () => {
    const built = buildRouter();
    router = built.router;
    const { stores } = built;
    const longAgo = Date.now() - 3_600_000;
    await seedSession(stores, Date.now() - 600_000);
    // The oldest run is still working. A hundred finished runs are newer.
    await keepRun(stores, "run_old", longAgo, "suspended");
    for (let i = 0; i < 100; i += 1) {
      await keepRun(stores, `run_${String(i).padStart(3, "0")}`, longAgo + 1 + i, "completed");
    }

    const list = stores.session.list.bind(stores.session);
    let opening = 0;
    vi.spyOn(stores.session, "list").mockImplementation(async (options) => {
      const rows = await list(options);
      if (options?.orderBy === "createdAt" && ++opening === 1) {
        // Deleted once the first rows of the read are back.
        await stores.session.delete("run_050");
      }
      return rows;
    });

    const notices = (await streamedEvents(router)).filter((event) => event.type === "session.runs");
    expect(opening).toBeGreaterThanOrEqual(1);
    expect(notices[0]?.type === "session.runs" && notices[0].runs.map((run) => run.id)).toEqual(["run_old"]);
  });
});

/** Keep run `id` under `s1`, created and last updated at `at`, with one request of `status`. */
async function keepRun(
  stores: StoreRegistry,
  id: string,
  at: number,
  status: RequestRecord["status"]
): Promise<void> {
  await stores.session.set(
    id,
    {
      orgId: DEFAULT_ORG_ID,
      id,
      flowKind: "chat",
      userId: "alice",
      parentSessionId: "s1",
      state: {},
      version: 0,
      createdAt: at,
      updatedAt: at,
      journal: []
    },
    "any"
  );
  await stores.request.set(
    `req_${id}`,
    {
      id: `req_${id}`,
      sessionId: id,
      flowKind: "chat",
      actionName: "say",
      userId: "alice",
      orgId: DEFAULT_ORG_ID,
      source: "http",
      status,
      startedAtMs: at,
      state: {},
      version: 0,
      createdAt: at,
      updatedAt: at
    } as RequestRecord,
    "any"
  );
}

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

  // A host can say the caller left only by aborting the signal it built the
  // request with. On Node, a request's own signal hears that abort only while
  // the request itself is alive, so the route has to hold the request for as
  // long as the stream is open, not just its signal.
  it("stops reading when its caller aborts, though nothing else holds the request", async () => {
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores);
    const reads = vi.spyOn(built.stores.request, "list");
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const controller = new AbortController();
    // Built in a scope of its own, so once the route returns only it can hold the request.
    const res = await (() =>
      built.router.GET(new Request("http://localhost/api/flows/sessions/s1/stream", { signal: controller.signal }), {
        params: { path: ["sessions", "s1", "stream"] }
      }))();
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let ended = false;
    const drained = (async () => {
      try {
        while (!(await reader.read()).done);
      } catch {
        // Cancelled below.
      }
      ended = true;
    })();

    try {
      await until(() => reads.mock.calls.length > 0, "the stream to read");
      await pause(0);
      gc();
      await pause(0);
      gc();

      controller.abort();
      await Promise.race([drained, pause(SESSION_STREAM_TIMINGS.intervalMs * 40)]);
      expect(ended).toBe(true);
      const readsAtEnd = reads.mock.calls.length;
      await pause(SESSION_STREAM_TIMINGS.intervalMs * 6);
      expect(reads.mock.calls.length).toBe(readsAtEnd);
    } finally {
      await reader.cancel().catch(() => {});
    }
  });
});

describe("a keyed item emitted again", () => {
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

  // A keyed item keeps one id through every emission; each emission replaces
  // it, finished, with a later time and index. A view that heard the first
  // copy has to hear the later one too, or it shows the first until a reload.
  it("sends the later copy of a keyed item already sent on this connection", async () => {
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores, Date.now() - 600_000);
    const owner = buildBlockInstanceId("req_k", "root", 0);
    const plan = (step: number, ts: number, itemIndex: number) =>
      item("req_k", "item_component_keyed:plan", "component", itemIndex, owner, {
        ts,
        component: "plan-view",
        data: { step },
        key: "plan"
      });
    const first = Date.now();
    await keepRequest(built.stores, "req_k", [plan(1, first, 1)], first);

    const controller = new AbortController();
    const res = await router.GET(
      new Request("http://localhost/api/flows/sessions/s1/stream", { signal: controller.signal }),
      { params: { path: ["sessions", "s1", "stream"] } }
    );
    const events = collectEvents(res);
    const steps = (): number[] =>
      events.flatMap((event) =>
        event.type === "session.item" && event.item.id === "item_component_keyed:plan"
          ? [(event.item as unknown as { data: { step: number } }).data.step]
          : []
      );
    try {
      await until(() => steps().length > 0, "the first copy");
      await keepRequest(built.stores, "req_k", [plan(2, first + 1, 3)], Date.now());
      // Well past the few reads it takes to see a request that moved, and
      // enough more that a copy sent twice would show.
      await new Promise((resolve) => setTimeout(resolve, SESSION_STREAM_TIMINGS.intervalMs * 8));
      expect(steps()).toEqual([1, 2]);
    } finally {
      controller.abort();
    }
  });
});

describe("a run waiting to start", () => {
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

  // A run for a child whose last run finished can wait behind another request
  // before it starts. Its request is recorded as working from the moment it is
  // accepted, so a view of the parent that is already open names the child
  // from then, not only once the run starts. The same for a child named by its
  // id and one derived again from its key.
  it.each([
    ["delivered into it by its id", "deliver"],
    ["dispatched to it by the key it was derived from", "spawn"]
  ] as const)("names a child while a run %s waits behind another request", async (_how, action) => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const queued = { policy: "queue", key: "user" } as const;
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "chat",
        actions: {
          hold: {
            concurrency: queued,
            block: handler({
              name: "hold",
              execute: async () => {
                holding = true;
                await held;
                return {};
              }
            })
          },
          deliver: {
            block: dispatcher({
              name: "deliver",
              action: "work",
              inputSchema: z.object({ to: z.string() }),
              session: { id: (input: { to: string }) => input.to },
              payload: () => ({})
            })
          },
          spawn: {
            block: dispatcher({
              name: "spawn",
              action: "work",
              session: { key: () => "seat" },
              payload: () => ({})
            })
          }
        },
        internal: {
          actions: { work: { concurrency: queued, block: handler({ name: "work", execute: () => ({}) }) } }
        }
      })
    );
    const stores = createInMemoryStores();
    router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await seedSession(stores, Date.now() - 600_000);
    const anHourAgo = Date.now() - 3_600_000;
    let child = "seat";
    if (action === "deliver") {
      await keepRun(stores, child, anHourAgo, "completed");
    } else {
      // Derive the child with one run, and let it finish an hour ago.
      expect((await post(router, "spawn", {})).status).toBe(202);
      await until(async () => (await stores.session.list({ parentage: { parentOf: "s1" } })).length === 1, "the child");
      await until(
        async () => (await stores.request.list({})).every((r) => r.status !== "in_progress"),
        "the first run finished"
      );
      const [derived] = await stores.session.list({ parentage: { parentOf: "s1" } });
      child = derived!.id;
      await stores.session.set(child, { ...derived!, updatedAt: anHourAgo }, "any");
    }

    const controller = new AbortController();
    const res = await router.GET(
      new Request("http://localhost/api/flows/sessions/s1/stream", { signal: controller.signal }),
      { params: { path: ["sessions", "s1", "stream"] } }
    );
    expect(res.status).toBe(200);
    const events = collectEvents(res);
    const runNotices = (): string[][] =>
      events.flatMap((event) => (event.type === "session.runs" ? [event.runs.map((run) => run.id)] : []));
    try {
      await until(() => runNotices().length > 0, "the opening notice");
      expect(runNotices()[0]).toEqual([]);

      // Another request of the same user holds the key the delivered run waits on.
      expect((await post(router, "hold", {})).status).toBe(202);
      await until(() => holding, "the other request holds the key");
      expect((await post(router, action, action === "deliver" ? { to: child } : {})).status).toBe(202);
      await until(
        async () => (await stores.request.list({ sessionId: child })).some((r) => r.status === "in_progress"),
        "the run was accepted"
      );

      // Well past the few reads it takes to see a child that moved.
      await new Promise((resolve) => setTimeout(resolve, SESSION_STREAM_TIMINGS.intervalMs * 8));
      expect(runNotices().at(-1)).toEqual([child]);
    } finally {
      release();
      await until(
        async () => (await stores.request.list({})).every((r) => r.status !== "in_progress"),
        "every request finished"
      );
      controller.abort();
    }
  });

  // Accepting a request writes the child it runs in, before any check of who
  // is asking has run. Someone else naming the child is refused later, and
  // must not have moved it first.
  it("leaves a child as it was when another user's request for it is accepted", async () => {
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "chat",
        actions: {
          ping: {
            concurrency: { policy: "queue", key: "session" },
            block: handler({ name: "ping", execute: () => ({}) })
          }
        }
      })
    );
    const stores = createInMemoryStores();
    router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await seedSession(stores, Date.now() - 600_000);
    await keepRun(stores, "seat", Date.now() - 3_600_000, "completed");
    const before = (await stores.session.get("seat"))!;

    await router.POST(
      new Request("http://localhost/api/flows/chat/seat/actions/ping", {
        method: "POST",
        body: JSON.stringify({ userId: "mallory", input: {} })
      }),
      { params: { path: ["chat", "seat", "actions", "ping"] } }
    );
    await until(
      async () => (await stores.request.list({ sessionId: "seat" })).every((r) => r.status !== "in_progress"),
      "the request was settled"
    );

    const after = (await stores.session.get("seat"))!;
    expect({ version: after.version, updatedAt: after.updatedAt }).toEqual({
      version: before.version,
      updatedAt: before.updatedAt
    });
  });

  // The same person acting for another organization is refused too, later,
  // and must not have moved a child outside that organization first.
  it("leaves a child as it was when its owner's request for it under another organization is accepted", async () => {
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "chat",
        actions: {
          ping: {
            concurrency: { policy: "queue", key: "session" },
            block: handler({ name: "ping", execute: () => ({}) })
          }
        },
        authentication: {
          resolvePrincipal: (context: { request?: Request }) => ({
            userId: "alice",
            orgId: context.request?.headers.get("x-org") ?? DEFAULT_ORG_ID
          })
        }
      })
    );
    const stores = createInMemoryStores();
    router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await seedSession(stores, Date.now() - 600_000);
    await keepRun(stores, "seat", Date.now() - 3_600_000, "completed");
    const before = (await stores.session.get("seat"))!;

    await router.POST(
      new Request("http://localhost/api/flows/chat/seat/actions/ping", {
        method: "POST",
        headers: { "x-org": "org_other" },
        body: JSON.stringify({ userId: "alice", input: {} })
      }),
      { params: { path: ["chat", "seat", "actions", "ping"] } }
    );
    await until(
      async () => (await stores.request.list({ sessionId: "seat" })).every((r) => r.status !== "in_progress"),
      "the request was settled"
    );

    const after = (await stores.session.get("seat"))!;
    expect({ version: after.version, updatedAt: after.updatedAt }).toEqual({
      version: before.version,
      updatedAt: before.updatedAt
    });
  });

  // The child is read when the request is admitted and again when it is
  // moved. Deleted and created again in between, the id holds another
  // session, which the request was never admitted to; created in between,
  // after admission found nothing under the id, the same. A run held behind
  // another request keeps the child as the move left it until the case looks.
  it.each([
    ["deleted and created again by its owner under another flow instance", true, { flowKind: "notes", flowId: "notes" }],
    ["deleted and created again by its owner, under the same flow", true, { lineageId: "lin_again", createdAt: Date.now() - 1_800_000 }],
    ["created by its owner under another flow instance, after admission found none", false, { flowKind: "notes", flowId: "notes" }]
  ] as const)("leaves a child as it was when it is %s, between the request's admission and the move", async (_how, present, again) => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const queued = { policy: "queue", key: "user" } as const;
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "chat",
        actions: {
          hold: {
            concurrency: queued,
            block: handler({
              name: "hold",
              execute: async () => {
                holding = true;
                await held;
                return {};
              }
            })
          },
          ping: { concurrency: queued, block: handler({ name: "ping", execute: () => ({}) }) }
        }
      })
    );
    registry.register(defineFlow({ kind: "notes", actions: { ping: { block: handler({ name: "ping", execute: () => ({}) }) } } }));
    const stores = createInMemoryStores();
    router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    await seedSession(stores, Date.now() - 600_000);
    if (present) await keepRun(stores, "seat", Date.now() - 3_600_000, "completed");

    // Once the request's record is written, which is after its admission read
    // the child and before the move reads it again.
    const set = stores.request.set.bind(stores.request);
    let replaced: SessionRecord | undefined;
    vi.spyOn(stores.request, "set").mockImplementation(async (id, record, mode) => {
      const written = await set(id, record, mode);
      if (replaced === undefined && mode === "absent" && record.sessionId === "seat") {
        if (!present) await keepRun(stores, "seat", Date.now() - 3_600_000, "completed");
        const child = (await stores.session.get("seat"))!;
        await stores.session.delete("seat");
        replaced = { ...child, ...again };
        await stores.session.set("seat", replaced, "any");
        replaced = (await stores.session.get("seat"))!;
      }
      return written;
    });

    try {
      expect((await post(router, "hold", {})).status).toBe(202);
      await until(() => holding, "the other request holds the key");
      const res = await router.POST(
        new Request("http://localhost/api/flows/chat/seat/actions/ping", {
          method: "POST",
          body: JSON.stringify({ userId: "alice", input: {} })
        }),
        { params: { path: ["chat", "seat", "actions", "ping"] } }
      );
      expect(res.status).toBe(202);
      await until(() => replaced !== undefined, "the child replaced");
      // Well past the move, and the run still waits behind the other request.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const after = (await stores.session.get("seat"))!;
      expect({ version: after.version, updatedAt: after.updatedAt }).toEqual({
        version: replaced!.version,
        updatedAt: replaced!.updatedAt
      });
    } finally {
      release();
      await until(
        async () => (await stores.request.list({})).every((r) => r.status !== "in_progress"),
        "every request finished"
      );
    }
  });
});

describe("the session a stream or a snapshot opens on", () => {
  let router: Router | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (router !== undefined) await disposeFlowApiRouter(router);
    router = undefined;
  });

  /** A request of mallory's under `s1`, finished, with one reply. */
  function mallorysRequest(): RequestRecord {
    return {
      id: "req_mallory",
      sessionId: "s1",
      flowKind: "chat",
      actionName: "say",
      userId: "mallory",
      orgId: "org_test",
      source: "http",
      status: "completed",
      startedAtMs: Date.now(),
      state: {},
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: [reply("req_mallory")]
    } as RequestRecord;
  }

  /**
   * Open `s1`'s stream or snapshot as `caller`, in an app that authenticates,
   * running `between` once the owner check has read the session and before
   * the route reads it. Returns the response status.
   */
  async function openAcrossTheCheck(
    route: "stream" | "state",
    caller: string,
    seeded: boolean,
    between: (stores: StoreRegistry, checked: SessionRecord | undefined) => Promise<void>
  ): Promise<{ status: number; ran: boolean }> {
    const registry = createFlowRegistry();
    // Two flows under one authentication, so a session of either is one the
    // caller can be admitted to.
    for (const kind of ["chat", "notes"]) {
      registry.register(
        defineFlow({
          kind,
          actions: { say: { block: handler({ name: "say", execute: () => ({}) }) } },
          authentication: {
            resolvePrincipal: (context: { request?: Request }) => {
              const user = context.request?.headers.get("x-user");
              return user == null ? null : { userId: user, orgId: "org_test" };
            }
          }
        })
      );
    }
    const stores = createInMemoryStores();
    router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    if (seeded) {
      await seedSession(stores, Date.now() - 600_000);
      await stores.session.set("s1", { ...(await stores.session.get("s1"))!, orgId: "org_test" }, "any");
    }

    const get = stores.session.get.bind(stores.session);
    let ran = false;
    vi.spyOn(stores.session, "get").mockImplementation(async (id) => {
      const found = await get(id);
      if (!ran && id === "s1") {
        ran = true;
        await between(stores, found);
      }
      return found;
    });

    const controller = new AbortController();
    const res = await router.GET(
      new Request(`http://localhost/api/flows/sessions/s1/${route}`, {
        headers: { "x-user": caller },
        signal: controller.signal
      }),
      { params: { path: ["sessions", "s1", route] } }
    );
    controller.abort();
    return { status: res.status, ran };
  }

  // The owner check and the stream each read the session. If the id changes
  // hands between the two reads, the stream would follow a session nobody
  // checked, for as long as the connection lasts.
  it.each(["stream", "state"] as const)(
    "opens the %s only on the session its caller was checked against, though the id changes hands between the two reads",
    async (route) => {
      const opened = await openAcrossTheCheck(route, "alice", true, async (stores, checked) => {
        // Alice's session goes, and mallory's takes its id, with a request of her own.
        await stores.session.delete("s1");
        await stores.session.set("s1", { ...checked!, userId: "mallory", createdAt: Date.now() }, "any");
        await stores.request.set("req_mallory", mallorysRequest(), "any");
      });
      expect(opened).toEqual({ status: 404, ran: true });
    }
  );

  // The same owner's session under another flow instance is another session
  // too, checked against that flow's rules, not the one the check applied.
  it.each(["stream", "state"] as const)(
    "opens the %s only on the session its caller was checked against, though its owner's session of another flow takes the id",
    async (route) => {
      const opened = await openAcrossTheCheck(route, "alice", true, async (stores, checked) => {
        await stores.session.delete("s1");
        await stores.session.set("s1", { ...checked!, flowKind: "notes", flowId: "notes" }, "any");
      });
      expect(opened).toEqual({ status: 404, ran: true });
    }
  );

  it.each(["stream", "state"] as const)("opens the %s on no session that arrived after the check found none", async (route) => {
    // Mallory asks for an id nobody holds, and the check lets the route answer
    // its own 404. Before it does, someone else's session takes the id.
    const opened = await openAcrossTheCheck(route, "mallory", false, async (stores, checked) => {
      expect(checked).toBeUndefined();
      await seedSession(stores);
      await stores.session.set("s1", { ...(await stores.session.get("s1"))!, orgId: "org_test" }, "any");
    });
    expect(opened).toEqual({ status: 404, ran: true });
  });
});

describe("a request the list found, read again by its id", () => {
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

  const said = (requestId: string, value: string): OutputItem =>
    item(requestId, `m_${value}`, "message", 0, buildBlockInstanceId(requestId, "root", 0), text(value));

  // Adapters that keep items apart from the record list requests without
  // them, and the stream reads each one it found again by its id. A request
  // id is the caller's to choose: retention can delete the request between
  // the two reads, and another request can take its id. What that one holds
  // is not this session's to send.
  it.each([
    ["nothing: the request is still there", undefined, ["mine"]],
    ["another user's request", { userId: "mallory" }, []],
    ["a request under another organization", { orgId: "org_other" }, []],
    ["a request in another session", { sessionId: "s2" }, []],
    ["a request under another tenant", { tenantId: "t2" }, []]
  ] as const)("sends a request's items only while its id still holds it; the id taken by %s", async (_by, replacement, expected) => {
    const built = buildRouter();
    router = built.router;
    const { stores } = built;
    await seedSession(stores, Date.now() - 600_000);
    await keepRequest(stores, "req_reused", [said("req_reused", "mine")], Date.now());

    const list = stores.request.list.bind(stores.request);
    vi.spyOn(stores.request, "list").mockImplementation(async (options) => {
      const rows = await list(options);
      // As the SQL adapters answer a list read without `withItems`.
      return options?.withItems === true ? rows : rows.map((row) => ({ ...row, items: undefined }));
    });
    const get = stores.request.get.bind(stores.request);
    let reads = 0;
    vi.spyOn(stores.request, "get").mockImplementation(async (id) => {
      if (id === "req_reused" && ++reads === 1 && replacement !== undefined) {
        const listed = (await get(id))!;
        await stores.request.delete(id);
        await stores.request.set(
          id,
          { ...listed, ...replacement, createdAt: Date.now(), updatedAt: Date.now(), items: [said(id, "someone else's")] },
          "any"
        );
      }
      return get(id);
    });

    const events = await streamedEvents(router);
    expect(reads).toBeGreaterThan(0);
    const texts = events.flatMap((event) =>
      event.type === "session.item" ? [(event.item as unknown as { content: Array<{ text: string }> }).content[0]!.text] : []
    );
    expect(texts).toEqual(expected);
  });
});

describe("a run the stream already named", () => {
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

  // A run found once and not since is checked again each read, by its
  // requests. Its requests can outlive its child: a crash leaves one reading
  // as working, and the child goes, or another session takes its id. The run
  // it named then is not under the session any more.
  it.each([
    ["deleted", undefined],
    ["deleted and created again by another user", "mallory"]
  ] as const)("drops a run whose child is %s while its request still reads as working", async (_what, recreatedBy) => {
    const built = buildRouter();
    router = built.router;
    const { stores } = built;
    await seedSession(stores, Date.now() - 600_000);
    // Found by the first read of runs only: nothing about it has moved in an hour.
    await keepRun(stores, "seat", Date.now() - 3_600_000, "in_progress");

    const controller = new AbortController();
    const res = await router.GET(
      new Request("http://localhost/api/flows/sessions/s1/stream", { signal: controller.signal }),
      { params: { path: ["sessions", "s1", "stream"] } }
    );
    const events = collectEvents(res);
    const runNotices = (): string[][] =>
      events.flatMap((event) => (event.type === "session.runs" ? [event.runs.map((run) => run.id)] : []));
    try {
      await until(() => runNotices().length > 0, "the opening notice");
      expect(runNotices()[0]).toEqual(["seat"]);

      const child = (await stores.session.get("seat"))!;
      await stores.session.delete("seat");
      if (recreatedBy !== undefined) {
        const anHourAgo = Date.now() - 3_600_000;
        await stores.session.set(
          "seat",
          { ...child, userId: recreatedBy, lineageId: "lin_again", createdAt: anHourAgo + 1, updatedAt: anHourAgo + 1 },
          "any"
        );
      }

      await until(() => runNotices().at(-1)?.length === 0, "the run to go");
      expect((await stores.request.get("req_seat"))?.status).toBe("in_progress");
    } finally {
      controller.abort();
    }
  });
});

describe("the session a snapshot read", () => {
  let router: Router | undefined;

  afterEach(async () => {
    if (router !== undefined) await disposeFlowApiRouter(router);
    router = undefined;
  });

  /** Open `s1`'s stream with `query`; the response status. */
  async function open(query: string): Promise<number> {
    const controller = new AbortController();
    const res = await router!.GET(
      new Request(`http://localhost/api/flows/sessions/s1/stream${query}`, { signal: controller.signal }),
      { params: { path: ["sessions", "s1", "stream"] } }
    );
    controller.abort();
    return res.status;
  }

  // A view reads the snapshot, then follows the session from it, and
  // reconnects whenever the connection drops. A session id can be deleted and
  // used again, here by its own owner: the stream carries on from the
  // snapshot, so it follows that session and no later one.
  it("is the one the stream follows: once the id holds a session created later, it answers 404", async () => {
    const built = buildRouter();
    router = built.router;
    await seedSession(built.stores, Date.now() - 600_000);
    const res = await router.GET(new Request("http://localhost/api/flows/sessions/s1/state"), {
      params: { path: ["sessions", "s1", "state"] }
    });
    const { sessionCreatedAt } = (await res.json()) as { sessionCreatedAt?: number };
    const read = (await built.stores.session.get("s1"))!;
    expect(sessionCreatedAt).toBe(read.createdAt);
    expect(await open(`?session_created_at=${sessionCreatedAt}`)).toBe(200);

    await built.stores.session.delete("s1");
    await seedSession(built.stores);
    expect(await open(`?session_created_at=${sessionCreatedAt}`)).toBe(404);
    // Named by no snapshot, the stream opens on whichever session holds the id.
    expect(await open("")).toBe(200);
  });
});

/** Post `action` to `s1` as alice. */
function post(router: Router, action: string, input: unknown): Promise<Response> {
  return router.POST(
    new Request(`http://localhost/api/flows/chat/s1/actions/${action}`, {
      method: "POST",
      body: JSON.stringify({ userId: "alice", input })
    }),
    { params: { path: ["chat", "s1", "actions", action] } }
  );
}

/** Every event the stream sends, as it arrives, until the stream ends or is aborted. */
function collectEvents(res: Response): SessionStreamEvent[] {
  const events: SessionStreamEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffered += decoder.decode(value, { stream: true });
        for (let cut = buffered.indexOf("\n\n"); cut >= 0; cut = buffered.indexOf("\n\n")) {
          const data = buffered
            .slice(0, cut)
            .split("\n")
            .find((line) => line.startsWith("data: "));
          buffered = buffered.slice(cut + 2);
          if (data !== undefined) events.push(JSON.parse(data.slice(6)) as SessionStreamEvent);
        }
      }
    } catch {
      // Aborted.
    }
  })();
  return events;
}

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`never: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
