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
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
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

/** What `spawn` takes: the key its child is derived from, and what to say there. */
const spawnInput = z.object({ key: z.string(), text: z.string(), hold: z.string().optional() });
type SpawnInput = z.infer<typeof spawnInput>;

function sayFlow(kind: string, secure = false) {
  const say = handler({
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
  });
  return defineFlow({
    kind,
    actions: {
      say: { block: say },
      // A run under the session: a child derived from a key, as a channel's
      // seats are.
      spawn: {
        block: dispatcher({
          name: `${kind}-spawn`,
          action: "work",
          inputSchema: spawnInput,
          session: { key: (input: SpawnInput) => input.key },
          payload: (input: SpawnInput) => ({ text: input.text, hold: input.hold })
        })
      },
      // A run delivered into a session that already exists, by its id.
      deliver: {
        block: dispatcher({
          name: `${kind}-deliver`,
          action: "work",
          inputSchema: z.object({ to: z.string(), text: z.string(), hold: z.string().optional() }),
          session: { id: (input) => input.to },
          payload: (input) => ({ text: input.text, hold: input.hold })
        })
      }
    },
    internal: { actions: { work: { block: say } } },
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
  return act(router, sessionId, "say", input, opts);
}

async function act(
  router: FlowApiRouter,
  sessionId: string,
  action: string,
  input: Record<string, unknown>,
  opts: { kind?: string; headers?: Record<string, string> } = {}
): Promise<string> {
  const kind = opts.kind ?? "chat";
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${kind}/${sessionId}/actions/${action}`, {
      method: "POST",
      headers: opts.headers ?? {},
      body: JSON.stringify({ userId: "alice", input })
    }),
    { params: { path: [kind, sessionId, "actions", action] } }
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

    // One read can be long: the first read of runs checks every run under the
    // session, two store reads each. A connection that ends midway through it
    // makes no further store read for nobody.
    it("stops reading the store when the connection ends midway through a read (BR-14)", async () => {
      const stores = await createStores();
      const runs = 20;
      const readMs = 20;
      let reads = 0;
      const slowed: StoreRegistry = {
        ...stores,
        request: new Proxy(stores.request, {
          get(target, key) {
            const value = Reflect.get(target, key, target) as unknown;
            if (key === "list") {
              return async (...args: Parameters<typeof target.list>) => {
                reads += 1;
                await delay(readMs);
                return target.list(...args);
              };
            }
            return typeof value === "function" ? value.bind(target) : value;
          }
        })
      };
      const r = router(slowed);
      await seedSession(stores, "s1");
      for (let i = 0; i < runs; i += 1) {
        await seedSession(stores, `run_${i}`, { parentSessionId: "s1" });
        await seedRequest(stores, { id: `req_${i}`, sessionId: `run_${i}`, status: "completed" });
      }

      const live = await stream(r, "s1");
      // Midway through the first read of runs: a few checked, most not.
      const deadline = Date.now() + 5_000;
      while (reads < 4 && Date.now() < deadline) await delay(5);
      expect(live.events).toEqual([]);
      const atClose = reads;
      await live.close();
      // Long enough for every remaining run to have been checked.
      await delay(runs * 2 * readMs);
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

    // A session's id can be deleted and used again, by anyone. The connection
    // was opened for one session, so what its reads find after that session
    // is gone is not sent: the connection ends, and a reopen is answered as
    // any open is.
    it.each([
      ["deleted", undefined, 404],
      ["deleted and created again by its owner", "alice", 200],
      ["deleted and created again by someone else", "mallory", 403]
    ] as const)(
      "ends when its session is %s, sending nothing kept after",
      async (_what, recreatedBy, reopened) => {
        const stores = await createStores();
        const r = router(stores);
        const alice = { "x-verified-user": "alice" };
        await seedSession(stores, "owned", {
          flowKind: "secure",
          orgId: "org_test",
          createdAt: Date.now() - 60_000
        });
        const live = await stream(r, "owned", { headers: alice });
        await live.waitFor((e) => e.type === "session.runs");

        await stores.session.delete("owned");
        const owner = recreatedBy ?? "alice";
        if (recreatedBy !== undefined) {
          await seedSession(stores, "owned", { flowKind: "secure", orgId: "org_test", userId: owner });
        }
        await seedRequest(stores, {
          id: "req_after",
          sessionId: "owned",
          flowKind: "secure",
          status: "completed",
          userId: owner,
          orgId: "org_test",
          items: [message("m_after", "kept after")]
        });

        const deadline = Date.now() + 2_000;
        while (!live.ended && Date.now() < deadline) await delay(20);
        expect(live.ended).toBe(true);
        expect(live.events.some(isItemWithText("kept after"))).toBe(false);
        const again = await stream(r, "owned", { headers: alice });
        expect(again.response.status).toBe(reopened);
      }
    );

    // Every request that runs in a session is made under its owner and
    // organization; the engine refuses any other. A request record under the
    // id with another owner or organization is one that was refused, or one
    // left by an earlier session under the same id, and neither view shows it.
    it("shows no request made under the session id by another owner or organization, live or on a reload", async () => {
      const stores = await createStores();
      const r = router(stores);
      const now = Date.now();
      await seedSession(stores, "s1", { createdAt: now - 60_000 });
      await seedRequest(stores, {
        id: "req_mine",
        sessionId: "s1",
        status: "completed",
        items: [message("m_mine", "mine")]
      });
      await seedRequest(stores, {
        id: "req_user",
        sessionId: "s1",
        status: "completed",
        userId: "mallory",
        items: [message("m_user", "another user's")]
      });
      await seedRequest(stores, {
        id: "req_org",
        sessionId: "s1",
        status: "completed",
        orgId: "org_other",
        items: [message("m_org", "another organization's")]
      });
      // Unfinished and old: found by the read of unfinished requests alone.
      await seedRequest(stores, {
        id: "req_waiting",
        sessionId: "s1",
        status: "suspended",
        userId: "mallory",
        startedAtMs: now - 3_600_000,
        createdAt: now - 3_600_000,
        updatedAt: now - 3_600_000,
        items: [message("m_waiting", "another user's, waiting")]
      });

      const live = await stream(r, "s1");
      await live.waitFor(isItemWithText("mine"));
      await delay(FAST_TIMINGS.intervalMs * 4);
      const streamed = live.events.flatMap((event) =>
        event.type === "session.item" ? [textOf(event.item)] : []
      );
      expect(streamed).toEqual(["mine"]);

      const snapshot = await r.GET(
        new Request("http://localhost/api/flows/sessions/s1/state?include_items=true"),
        { params: { path: ["sessions", "s1", "state"] } }
      );
      expect(snapshot.status).toBe(200);
      const { items } = (await snapshot.json()) as { items: OutputItem[] };
      expect(items.map(textOf)).toEqual(["mine"]);
    });

    // An adapter that keeps items apart from the record lists requests
    // without them, and the stream reads each one it found again by its id. A
    // request id is the caller's to choose: retention can delete the request
    // between the two reads, and another user's request, in another session,
    // can take its id. Nothing that one holds is sent.
    it("sends nothing from a request that took the id of one it found, between the two reads", async () => {
      const stores = await createStores();
      await seedSession(stores, "s1", { createdAt: Date.now() - 60_000 });
      await seedSession(stores, "s2", { userId: "mallory", createdAt: Date.now() - 60_000 });
      await seedRequest(stores, {
        id: "req_reused",
        sessionId: "s1",
        status: "completed",
        items: [message("m_mine", "mine")]
      });

      let replaced = false;
      const request = new Proxy(stores.request, {
        get(target, key) {
          const value = Reflect.get(target, key, target) as unknown;
          if (key !== "get") return typeof value === "function" ? value.bind(target) : value;
          return async (id: string) => {
            if (id === "req_reused" && !replaced) {
              replaced = true;
              await target.delete(id);
              await seedRequest(stores, {
                id,
                sessionId: "s2",
                userId: "mallory",
                status: "completed",
                items: [message("m_theirs", "someone else's")]
              });
            }
            return target.get(id);
          };
        }
      });
      const r = router({ ...stores, request });

      const live = await stream(r, "s1");
      await live.waitFor((e) => e.type === "session.runs");
      await delay(FAST_TIMINGS.intervalMs * 6);
      const streamed = live.events.flatMap((event) =>
        event.type === "session.item" ? [textOf(event.item)] : []
      );
      // An adapter whose list read carries the items reads nothing by id.
      expect(streamed).toEqual(replaced ? [] : ["mine"]);
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

    /**
     * A run under the session that finished, then starts again later: a seat
     * answering a second post in the same conversation. `how` is the way the
     * second run reaches the child.
     */
    async function runStartsAgain(how: "spawn" | "deliver"): Promise<void> {
      // Reads that reach back only a moment, so the second run is found
      // because it started, not because the child was written recently.
      SESSION_STREAM_TIMINGS.marginMs = 50;
      const stores = await createStores();
      const r = router(stores);
      await seedSession(stores, "s1");
      const live = await stream(r, "s1");
      await live.waitFor((e) => e.type === "session.runs");

      const releaseFirst = hold("first");
      await finished(stores, await act(r, "s1", "spawn", { key: "seat", text: "first", hold: "first" }));
      const started = await live.waitFor((e) => runsOf(e).length === 1);
      const [child] = runsOf(started);
      releaseFirst();
      await live.waitFor((e) => e.type === "session.runs" && e.runs.length === 0 && e.at > started.at);

      // Well past the floor: nothing about the child has moved since.
      await delay(400);
      const quiet = live.events.length;
      const releaseSecond = hold("second");
      const second =
        how === "spawn"
          ? { key: "seat", text: "second", hold: "second" }
          : { to: child!, text: "second", hold: "second" };
      const sent = await act(r, "s1", how, second);
      await finished(stores, sent);
      // The dispatch was accepted: the second run is really under way.
      expect((await stores.request.get(sent))?.status).toBe("completed");
      await live.waitFor((e) => live.events.indexOf(e) >= quiet && runsOf(e).includes(child!));

      // Let the second run finish inside the case, so its last writes land in
      // this case's store rather than in whatever the next case sets up.
      const nudged = live.events.length;
      releaseSecond();
      await live.waitFor(
        (e) => live.events.indexOf(e) >= nudged && e.type === "session.runs" && !runsOf(e).includes(child!)
      );
    }

    it("nudges when a run starts again in a child whose last run finished (BR-7)", async () => {
      await runStartsAgain("spawn");
    });

    it("nudges when a run is delivered into an existing child by its id (BR-7)", async () => {
      await runStartsAgain("deliver");
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
