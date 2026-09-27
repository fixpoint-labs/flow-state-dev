/**
 * Shared conformance suite for the session stream
 * (`GET /sessions/:sessionId/stream`).
 *
 * The stream finds new items and runs by reading the store, never by
 * listening to the process that wrote them. What it can see therefore depends
 * on each adapter: which list filters it honours, when it makes an item
 * readable, how it moves a record's update time. This suite drives the real
 * router and a real flow over one adapter's stores, and every adapter runs it
 * from its own package via `@flow-state-dev/engine/testing`, the way the scope
 * store suite runs.
 *
 * Most cases run on a shortened clock. The two that measure the "about a
 * second" budget run on the shipped one, because a budget checked on a clock
 * nobody ships proves nothing about it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { OutputItem, SessionStreamEvent } from "@flow-state-dev/core/items";
import { createFlowRegistry } from "../../registry/flow-registry";
import {
  createFlowApiRouter,
  disposeFlowApiRouter,
  type FlowApiRouter
} from "../../routes/createFlowApiRouter";
import { SESSION_STREAM_TIMINGS } from "../../routes/session-stream-routes";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../types";

export type CreateSessionStreamConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLite"`. */
  name: string;
  /** Build fresh stores. Called per test so each case starts empty. */
  createStores: () => StoreRegistry | Promise<StoreRegistry>;
  /**
   * Two registries over one backing store, as two servers sharing a database
   * would hold them. Omitted, the two-server case runs two routers over one
   * registry, which is the only arrangement the in-memory store has.
   */
  createSharedPair?: () => Promise<{
    a: StoreRegistry;
    b: StoreRegistry;
    cleanup?: () => Promise<void> | void;
  }>;
  /**
   * Whether an item a running request keeps can be read before the request
   * finishes. False for the in-memory store, which writes a request's items
   * when it ends; the stream then sends them when it ends.
   */
  itemsReadableWhileRunning: boolean;
  /** Called after each case, e.g. to close database handles. */
  cleanup?: () => Promise<void> | void;
};

const SHIPPED_TIMINGS = { ...SESSION_STREAM_TIMINGS };
const FAST_TIMINGS = {
  intervalMs: 40,
  maxAgeMs: 60_000,
  marginMs: 2_000,
  firstReadWindowMs: 60_000,
  pingMs: 15_000
};

/** Held answers, released by the case that holds them. */
const holds = new Map<string, () => void>();
const held = new Map<string, Promise<void>>();

function hold(key: string): () => void {
  let release!: () => void;
  held.set(key, new Promise<void>((resolve) => (release = resolve)));
  holds.set(key, release);
  return release;
}

function sayFlow(kind: string, secure = false) {
  return defineFlow({
    kind,
    actions: {
      say: {
        block: handler({
          name: `${kind}-say`,
          execute: async (input, ctx) => {
            const { text, before, hold: key } = input as {
              text: string;
              before?: string;
              hold?: string;
            };
            if (before !== undefined) await held.get(before);
            ctx.emit.message(text);
            if (key !== undefined) await held.get(key);
            return {};
          }
        })
      }
    },
    ...(secure
      ? {
          authentication: {
            resolvePrincipal: (context: { request?: Request }) => {
              const user = context.request?.headers.get("x-verified-user");
              return user == null ? null : { userId: user, orgId: "org_test" };
            }
          }
        }
      : {})
  });
}

type OpenStream = {
  response: Response;
  events: SessionStreamEvent[];
  /** True once the server ended the connection or the case closed it. */
  readonly ended: boolean;
  waitFor<T extends SessionStreamEvent>(
    predicate: (event: SessionStreamEvent) => event is T,
    timeoutMs?: number
  ): Promise<T>;
  waitFor(
    predicate: (event: SessionStreamEvent) => boolean,
    timeoutMs?: number
  ): Promise<SessionStreamEvent>;
  close(): Promise<void>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOf(item: OutputItem): string | undefined {
  if (item.type !== "message") return undefined;
  const part = (item.content as Array<{ type: string; text?: string }>)[0];
  return part?.text;
}

function isItemWithText(text: string) {
  return (event: SessionStreamEvent): boolean =>
    event.type === "session.item" && textOf(event.item) === text;
}

async function openStream(
  router: FlowApiRouter,
  sessionId: string,
  opts: { since?: number; headers?: Record<string, string> } = {}
): Promise<OpenStream> {
  const controller = new AbortController();
  const query = opts.since === undefined ? "" : `?since=${opts.since}`;
  const response = await router.GET(
    new Request(`http://localhost/api/flows/sessions/${sessionId}/stream${query}`, {
      headers: opts.headers ?? {},
      signal: controller.signal
    }),
    { params: { path: ["sessions", sessionId, "stream"] } }
  );
  const events: SessionStreamEvent[] = [];
  let ended = false;
  const reading = (async () => {
    if (response.status !== 200 || response.body === null) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (data !== "") events.push(JSON.parse(data) as SessionStreamEvent);
        }
      }
    } catch {
      // Aborted by the case.
    }
  })().finally(() => {
    ended = true;
  });

  return {
    response,
    events,
    get ended() {
      return ended;
    },
    async waitFor(predicate: (event: SessionStreamEvent) => boolean, timeoutMs = 3_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = events.find(predicate);
        if (hit !== undefined) return hit;
        if (ended) throw new Error("the stream ended before the event arrived");
        if (Date.now() > deadline) {
          throw new Error(
            `no matching event within ${timeoutMs} ms; got ${JSON.stringify(events.map((e) => e.type))}`
          );
        }
        await delay(10);
      }
    },
    async close() {
      controller.abort();
      await reading;
    }
  } as OpenStream;
}

async function say(
  router: FlowApiRouter,
  sessionId: string,
  input: { text: string; before?: string; hold?: string },
  opts: { kind?: string; headers?: Record<string, string> } = {}
): Promise<string> {
  const kind = opts.kind ?? "chat";
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${kind}/${sessionId}/actions/say`, {
      method: "POST",
      headers: opts.headers ?? {},
      body: JSON.stringify({ userId: "alice", input })
    }),
    { params: { path: [kind, sessionId, "actions", "say"] } }
  );
  expect(res.status).toBe(202);
  return ((await res.json()) as { request: { id: string } }).request.id;
}

async function finished(stores: StoreRegistry, requestId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return;
    if (Date.now() > deadline) throw new Error(`request ${requestId} never finished`);
    await delay(10);
  }
}

async function seedSession(
  stores: StoreRegistry,
  id: string,
  overrides: Partial<SessionRecord> = {}
): Promise<void> {
  const now = Date.now();
  const record: SessionRecord = {
    orgId: DEFAULT_ORG_ID,
    id,
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: [],
    ...overrides
  };
  await stores.session.set(record.id, record, "any");
}

async function seedRequest(
  stores: StoreRegistry,
  init: { id: string; sessionId: string; status: RequestRecord["status"] } & Partial<RequestRecord>
): Promise<void> {
  const now = Date.now();
  const record = {
    flowKind: "chat",
    actionName: "say",
    userId: "alice",
    orgId: DEFAULT_ORG_ID,
    source: "http",
    startedAtMs: now,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...init
  } as RequestRecord;
  await stores.request.set(record.id, record, "any");
  if (record.items === undefined) return;
  // Adapters that keep items apart from the record take them only this way,
  // as the runtime writes them. The filesystem store moves a request's update
  // time when it writes items, so the record is written again last to keep
  // the time the seed names.
  stores.request.persistItems(record.id, record.items);
  await stores.request.flushItems(record.id);
  await stores.request.set(record.id, record, "any");
}

function message(id: string, text: string, itemIndex = 0): OutputItem {
  return {
    id,
    type: "message",
    status: "completed",
    itemIndex,
    role: "assistant",
    content: [{ type: "output_text", text }]
  } as unknown as OutputItem;
}

function runsOf(event: SessionStreamEvent): string[] {
  return event.type === "session.runs" ? event.runs.map((run) => run.id) : [];
}

function latestRuns(stream: OpenStream): string[] | undefined {
  const last = [...stream.events].reverse().find((event) => event.type === "session.runs");
  return last === undefined ? undefined : runsOf(last);
}

/**
 * Register the session-stream conformance cases for one adapter.
 *
 * @param options The adapter's stores, and what it can make readable when.
 */
export function createSessionStreamConformanceTests(
  options: CreateSessionStreamConformanceTestsOptions
): void {
  const { name, createStores, createSharedPair, itemsReadableWhileRunning, cleanup } = options;

  describe(`${name} (session stream conformance)`, () => {
    const routers: FlowApiRouter[] = [];
    const streams: OpenStream[] = [];

    function router(stores: StoreRegistry): FlowApiRouter {
      const registry = createFlowRegistry();
      registry.register(sayFlow("chat")());
      registry.register(sayFlow("secure", true)());
      const built = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
      routers.push(built);
      return built;
    }

    async function stream(
      on: FlowApiRouter,
      sessionId: string,
      opts?: { since?: number; headers?: Record<string, string> }
    ): Promise<OpenStream> {
      const opened = await openStream(on, sessionId, opts);
      streams.push(opened);
      return opened;
    }

    beforeEach(() => {
      Object.assign(SESSION_STREAM_TIMINGS, FAST_TIMINGS);
    });

    afterEach(async () => {
      for (const release of holds.values()) release();
      holds.clear();
      held.clear();
      await Promise.all(streams.splice(0).map((s) => s.close()));
      await Promise.all(routers.splice(0).map((r) => disposeFlowApiRouter(r)));
      Object.assign(SESSION_STREAM_TIMINGS, SHIPPED_TIMINGS);
      await cleanup?.();
      // A stream left open by a failing case closes on its next tick; allow it,
      // so one failure does not surface as a hook timeout in the next case.
    }, 30_000);

    it("sends a line another request keeps, within two seconds of it finishing (BR-1)", async () => {
      Object.assign(SESSION_STREAM_TIMINGS, SHIPPED_TIMINGS);
      const stores = await createStores();
      const r = router(stores);
      await finished(stores, await say(r, "s1", { text: "opening" }));
      const live = await stream(r, "s1");
      await live.waitFor((e) => e.type === "session.runs");

      const sentAt = Date.now();
      await finished(stores, await say(r, "s1", { text: "from another tab" }));
      await live.waitFor(isItemWithText("from another tab"), 2_000);
      expect(Date.now() - sentAt).toBeLessThan(2_000);
    });

    it.runIf(itemsReadableWhileRunning)(
      "sends a line a still-running request kept, within two seconds (BR-1)",
      async () => {
        Object.assign(SESSION_STREAM_TIMINGS, SHIPPED_TIMINGS);
        const stores = await createStores();
        const r = router(stores);
        await finished(stores, await say(r, "s1", { text: "opening" }));
        const live = await stream(r, "s1");
        await live.waitFor((e) => e.type === "session.runs");

        const release = hold("working");
        const requestId = await say(r, "s1", { text: "said before the hold", hold: "working" });
        await live.waitFor(isItemWithText("said before the hold"), 2_000);
        // Still running: the line arrived from the item write, not the finish.
        expect((await stores.request.get(requestId))?.status).toBe("in_progress");
        release();
        await finished(stores, requestId);
      }
    );

    it.runIf(itemsReadableWhileRunning)(
      "sends a line kept late in a long run, after the run's own start has aged out of the read (BR-1)",
      async () => {
        SESSION_STREAM_TIMINGS.marginMs = 200;
        const stores = await createStores();
        const r = router(stores);
        await finished(stores, await say(r, "s1", { text: "opening" }));
        const live = await stream(r, "s1");
        await live.waitFor((e) => e.type === "session.runs");

        const start = hold("late start");
        const end = hold("late end");
        const requestId = await say(r, "s1", {
          text: "said late",
          before: "late start",
          hold: "late end"
        });
        // Long enough for every read's floor to pass the run's start.
        await delay(800);
        start();
        await live.waitFor(isItemWithText("said late"));
        expect((await stores.request.get(requestId))?.status).toBe("in_progress");
        end();
        await finished(stores, requestId);
      }
    );

    it("covers the gap before it opened: a line kept seconds before is sent (BR-12)", async () => {
      // Older than the margin every later read reaches back, so only the
      // first read's window can find it: the gap between a view's snapshot
      // and its stream opening.
      const stores = await createStores();
      const r = router(stores);
      const before = Date.now() - 10_000;
      await seedSession(stores, "s1");
      await seedRequest(stores, {
        id: "req_before",
        sessionId: "s1",
        status: "completed",
        startedAtMs: before,
        createdAt: before,
        updatedAt: before,
        items: [message("m_before", "kept before the stream")]
      });
      const live = await stream(r, "s1");
      await live.waitFor(isItemWithText("kept before the stream"));
    });

    it("reads what is recent, never the session's whole history (D2)", async () => {
      const stores = await createStores();
      const r = router(stores);
      const old = Date.now() - 10 * 60_000;
      await seedSession(stores, "s1");
      await seedRequest(stores, {
        id: "req_old",
        sessionId: "s1",
        status: "completed",
        startedAtMs: old,
        createdAt: old,
        updatedAt: old,
        items: [message("m_old", "ten minutes ago")]
      });
      await seedRequest(stores, {
        id: "req_new",
        sessionId: "s1",
        status: "completed",
        items: [message("m_new", "just now")]
      });
      const live = await stream(r, "s1");
      await live.waitFor(isItemWithText("just now"));
      await delay(FAST_TIMINGS.intervalMs * 4);
      expect(live.events.some(isItemWithText("ten minutes ago"))).toBe(false);
    });

    it("sends each line once per connection, however many reads see it (BR-13)", async () => {
      const stores = await createStores();
      const r = router(stores);
      await finished(stores, await say(r, "s1", { text: "once" }));
      const live = await stream(r, "s1");
      await live.waitFor(isItemWithText("once"));
      // Several reads, each reaching back past the line.
      await delay(FAST_TIMINGS.intervalMs * 5);
      expect(live.events.filter(isItemWithText("once"))).toHaveLength(1);
    });

    it("tells apart two requests' items that share an id (BR-22)", async () => {
      const stores = await createStores();
      const r = router(stores);
      await seedSession(stores, "s1");
      await seedRequest(stores, {
        id: "req_a",
        sessionId: "s1",
        status: "completed",
        items: [message("keyed", "from a")]
      });
      await seedRequest(stores, {
        id: "req_b",
        sessionId: "s1",
        status: "completed",
        items: [message("keyed", "from b")]
      });
      const live = await stream(r, "s1");
      const a = await live.waitFor(isItemWithText("from a"));
      const b = await live.waitFor(isItemWithText("from b"));
      expect(a.type === "session.item" && a.requestId).toBe("req_a");
      expect(b.type === "session.item" && b.requestId).toBe("req_b");
    });

    it("sends every line to every open view of the session (BR-4)", async () => {
      const stores = await createStores();
      const r = router(stores);
      await finished(stores, await say(r, "s1", { text: "opening" }));
      const tabA = await stream(r, "s1");
      const tabB = await stream(r, "s1");
      await tabA.waitFor((e) => e.type === "session.runs");
      await tabB.waitFor((e) => e.type === "session.runs");

      await finished(stores, await say(r, "s1", { text: "seen by both" }));
      await tabA.waitFor(isItemWithText("seen by both"));
      await tabB.waitFor(isItemWithText("seen by both"));
    });

    it("hears a line written by another server on the same store (BR-17)", async () => {
      let a: StoreRegistry;
      let b: StoreRegistry;
      let pairCleanup: (() => Promise<void> | void) | undefined;
      if (createSharedPair !== undefined) {
        ({ a, b, cleanup: pairCleanup } = await createSharedPair());
      } else {
        a = b = await createStores();
      }
      try {
        const holding = router(a);
        const writing = router(b);
        await finished(b, await say(writing, "s1", { text: "opening" }));
        const live = await stream(holding, "s1");
        await live.waitFor((e) => e.type === "session.runs");

        await finished(b, await say(writing, "s1", { text: "from the other server" }));
        await live.waitFor(isItemWithText("from the other server"));
      } finally {
        await Promise.all(streams.splice(0).map((s) => s.close()));
        await Promise.all(routers.splice(0).map((r) => disposeFlowApiRouter(r)));
        await pairCleanup?.();
      }
    });

    it("stops reading the store when the connection ends (BR-14)", async () => {
      const stores = await createStores();
      let reads = 0;
      const counted: StoreRegistry = {
        ...stores,
        request: new Proxy(stores.request, {
          get(target, key) {
            const value = Reflect.get(target, key, target) as unknown;
            if (key === "list") {
              return (...args: Parameters<typeof target.list>) => {
                reads += 1;
                return target.list(...args);
              };
            }
            return typeof value === "function" ? value.bind(target) : value;
          }
        })
      };
      const r = router(counted);
      await seedSession(stores, "s1");
      const live = await stream(r, "s1");
      await live.waitFor((e) => e.type === "session.runs");
      await delay(FAST_TIMINGS.intervalMs * 3);
      expect(reads).toBeGreaterThan(0);

      await live.close();
      await delay(FAST_TIMINGS.intervalMs * 2);
      const atClose = reads;
      await delay(FAST_TIMINGS.intervalMs * 5);
      expect(reads).toBe(atClose);
    });

    it("closes the connection itself once it reaches its age limit (BR-24)", async () => {
      SESSION_STREAM_TIMINGS.maxAgeMs = 300;
      const stores = await createStores();
      const r = router(stores);
      await seedSession(stores, "s1");
      const live = await stream(r, "s1");
      await live.waitFor((e) => e.type === "session.runs");
      const deadline = Date.now() + 2_000;
      while (!live.ended && Date.now() < deadline) await delay(20);
      expect(live.ended).toBe(true);
    });

    it("picks up from `since` after a reconnect (BR-13)", async () => {
      // A first read and a margin that each reach back only a moment, so a
      // line kept while disconnected is found through `since` or not at all.
      SESSION_STREAM_TIMINGS.firstReadWindowMs = 100;
      SESSION_STREAM_TIMINGS.marginMs = 50;
      const stores = await createStores();
      const r = router(stores);
      await seedSession(stores, "s1");
      const first = await stream(r, "s1");
      const opened = await first.waitFor((e) => e.type === "session.runs");
      await first.close();

      await finished(stores, await say(r, "s1", { text: "while disconnected" }));
      await delay(300);
      const again = await stream(r, "s1", { since: opened.at });
      await again.waitFor(isItemWithText("while disconnected"));
    });

    it("refuses exactly as the session snapshot refuses, streaming nothing (BR-15)", async () => {
      const stores = await createStores();
      const r = router(stores);
      await seedSession(stores, "owned", { flowKind: "secure", orgId: "org_test" });
      await finished(
        stores,
        await say(r, "tenanted", { text: "hi" }, { headers: { "x-tenant-id": "t1" } })
      );

      const cases: Array<{ sessionId: string; headers?: Record<string, string> }> = [
        { sessionId: "missing" },
        { sessionId: "tenanted" },
        { sessionId: "tenanted", headers: { "x-tenant-id": "t2" } },
        { sessionId: "owned" },
        { sessionId: "owned", headers: { "x-verified-user": "mallory" } }
      ];
      const refusals: number[] = [];
      for (const { sessionId, headers } of cases) {
        const snapshot = await r.GET(
          new Request(`http://localhost/api/flows/sessions/${sessionId}/state`, { headers }),
          { params: { path: ["sessions", sessionId, "state"] } }
        );
        const live = await stream(r, sessionId, { headers });
        expect(live.response.status, sessionId).toBe(snapshot.status);
        expect(live.response.headers.get("content-type") ?? "").not.toContain("text/event-stream");
        refusals.push(live.response.status);
      }
      // The cases are refusals, not a match on two 200s.
      expect(refusals).toEqual([404, 404, 404, 401, 403]);

      const owner = await stream(r, "owned", { headers: { "x-verified-user": "alice" } });
      expect(owner.response.status).toBe(200);
    });

    it("writes nothing: the session and its latest request stay as they were (BR-19)", async () => {
      const stores = await createStores();
      const r = router(stores);
      await finished(stores, await say(r, "s1", { text: "opening" }));
      const before = await stores.session.get("s1");
      const live = await stream(r, "s1");
      await live.waitFor(isItemWithText("opening"));
      await delay(FAST_TIMINGS.intervalMs * 4);
      expect(await stores.session.get("s1")).toEqual(before);
    });

    it("nudges when a run under the session starts and again when it ends (BR-7)", async () => {
      const stores = await createStores();
      const r = router(stores);
      await seedSession(stores, "s1");
      const live = await stream(r, "s1");
      const opening = await live.waitFor((e) => e.type === "session.runs");
      expect(runsOf(opening)).toEqual([]);

      await seedSession(stores, "run_1", {
        parentSessionId: "s1",
        flowId: "support.otto",
        topic: "post-1"
      });
      await seedRequest(stores, { id: "req_run_1", sessionId: "run_1", status: "in_progress" });
      const started = await live.waitFor((e) => runsOf(e).includes("run_1"));
      expect(started.type === "session.runs" && started.runs[0]).toMatchObject({
        id: "run_1",
        parentSessionId: "s1",
        flowId: "support.otto",
        topic: "post-1"
      });

      const record = await stores.request.get("req_run_1");
      await stores.request.set(
        "req_run_1",
        { ...record!, status: "completed", updatedAt: Date.now() },
        "any"
      );
      await live.waitFor((e) => e.type === "session.runs" && e.runs.length === 0);
    });

    it("keeps an unfinished run older than a page of runs listed (BR-23)", async () => {
      const stores = await createStores();
      const r = router(stores);
      const longAgo = Date.now() - 60 * 60_000;
      await seedSession(stores, "s1");
      await seedSession(stores, "run_old", {
        parentSessionId: "s1",
        createdAt: longAgo,
        updatedAt: longAgo
      });
      await seedRequest(stores, {
        id: "req_old",
        sessionId: "run_old",
        status: "suspended",
        startedAtMs: longAgo,
        createdAt: longAgo,
        updatedAt: longAgo
      });
      // More finished runs than one page of the open read, all newer.
      for (let i = 0; i < 105; i += 1) {
        await seedSession(stores, `run_${i}`, { parentSessionId: "s1" });
        await seedRequest(stores, { id: `req_${i}`, sessionId: `run_${i}`, status: "completed" });
      }

      const live = await stream(r, "s1");
      const opening = await live.waitFor((e) => e.type === "session.runs", 10_000);
      expect(runsOf(opening)).toEqual(["run_old"]);
      await delay(FAST_TIMINGS.intervalMs * 4);
      expect(latestRuns(live)).toEqual(["run_old"]);
    }, 30_000);
  });
}
