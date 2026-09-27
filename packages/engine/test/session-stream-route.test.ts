/**
 * `GET /sessions/:sessionId/stream` as a route: where it sits in the table, and
 * that it shows exactly what the session snapshot shows. The store-dependent
 * behaviour (what is read, when, and when it stops) is the conformance suite's,
 * run per adapter.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

async function seedSession(stores: StoreRegistry): Promise<void> {
  const now = Date.now();
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

/** The (request, item) pairs the stream sends for `s1` over a few reads. */
async function streamedPairs(router: Router, query = ""): Promise<string[]> {
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
    .map((line) => JSON.parse(line.slice(6)) as SessionStreamEvent)
    .filter((event) => event.type === "session.item")
    .map((event) => (event.type === "session.item" ? `${event.requestId}/${event.item.id}` : ""))
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
