/**
 * The lab's views that used to read on a clock read on a change instead:
 * pins on a user-state notice, through a read that writes nothing;
 * a thread's running turn on a request notice; the sidebar's rows on each
 * listed session's notices; a task's work when the board names its run.
 * Wherever push can miss a change, `client.subscribe` reads on its timer at
 * the view's old pace, so no view keeps a timer of its own. A request view
 * never reads on `items`: a streaming reply sends one per stored chunk.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client, type ClientFetch, type SubscribeOptions, type WireNotice, type WireTopic } from "@flow-state-dev/client";

/** The sessions each mode's worker lists, by worker: the sidebar's listing, stood in for. */
const listed = new Map<string, Array<{ id: string; updatedAt: number }>>();
const listings = { count: 0, failing: 0 };
vi.mock("@flow-state-dev/workforce/browser", async (original) => {
  const real = await original<typeof import("@flow-state-dev/workforce/browser")>();
  return {
    ...real,
    createWorkforceClient: () => ({
      roster: async () => [...listed.keys()].map((id) => ({ id, flow: "f" })),
      listWorkerSessions: async (worker: string) => {
        listings.count += 1;
        if (listings.failing > 0) {
          listings.failing -= 1;
          throw new Error("the roster is down");
        }
        return (listed.get(worker) ?? []).map((session) => ({ session, isDefault: false }));
      },
      setWorkProject: async () => undefined,
    }),
  };
});

import { createWiredLab, type SessionRow, type ThreadView, type Unsubscribe } from "../src/adapter";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A host that counts what each view reads, with `client.subscribe` stood in for so a case says which notice arrives. */
function host() {
  const calls: string[] = [];
  let pinned: string[] = [];
  let running: unknown[] = [];
  let board: unknown[] = [];
  /** Held reads of the pins, released by the case. */
  let holdPins: Promise<void> | undefined;
  let pinsFailing = 0;
  /** Calls to fail next, by `METHOD path`, each with how many more times. */
  const failing = new Map<string, number>();
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    const left = failing.get(`${method} ${path}`) ?? 0;
    if (left > 0) {
      failing.set(`${method} ${path}`, left - 1);
      return json({ error: "down" }, 503);
    }
    if (path === "/api/flows/sessions") return json({ sessions: [{ id: "pins_s", flowKind: "pins", updatedAt: 1 }] });
    if (path.endsWith("/reads/listPins")) {
      await holdPins;
      if (pinsFailing > 0) {
        pinsFailing -= 1;
        return json({ error: "down" }, 503);
      }
      return json({ output: { pinned } });
    }
    if (path.endsWith("/reads/listTasks_tasks")) return json({ output: { ok: true, tasks: board } });
    if (path.endsWith("/requests")) return json({ requests: running });
    if (path.endsWith("/stream")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (path.endsWith("/state")) {
      const items = [{ id: "u1", type: "message", status: "completed", requestId: "req_u1", itemIndex: 0, ts: 1, role: "user", content: [{ type: "output_text", text: "fix the build" }] }];
      return json({ sessionId: "s1", flowKind: "f", at: 1, sessionCreatedAt: 1, clientData: {}, items, pagination: { offset: 0, limit: 200, total: 1, hasMore: false, nextOffset: 1 } });
    }
    if (path.startsWith("/api/flows/sessions/")) return json({ session: { id: path.split("/").pop(), flowKind: "f", updatedAt: 1, state: {} } });
    if (method === "POST" && path === "/api/flows/f/sessions") return json({ session: { id: "s_new", flowKind: "f", updatedAt: 9, state: {} } });
    return json({});
  }) as ClientFetch;
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  const client: Client = Object.assign(createClient({ userId: "u", baseUrl: "", fetcher }), {
    subscribe: (topics: readonly WireTopic[], options: SubscribeOptions) => {
      const entry = { topics, options, closed: false };
      subscriptions.push(entry);
      return { close: () => void (entry.closed = true) };
    },
  });
  return {
    client,
    calls,
    subscriptions,
    count: (match: string) => calls.filter((call) => call.includes(match)).length,
    hear: (notice: WireNotice | null) => {
      for (const s of subscriptions) if (!s.closed) s.options.onChange(notice);
    },
    pin: (ids: string[]) => void (pinned = ids),
    failPinReads: (n: number) => void (pinsFailing = n),
    /** Fail the next `n` calls of `METHOD path`. */
    fail: (call: string, n = 1) => void failing.set(call, n),
    run: (requests: unknown[]) => void (running = requests),
    list: (tasks: unknown[]) => void (board = tasks),
    holdPinReads: () => {
      let release!: () => void;
      holdPins = new Promise((r) => (release = r));
      return () => {
        holdPins = undefined;
        release();
      };
    },
  };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error("condition never held");
};
const settle = () => new Promise((r) => setTimeout(r, 30));

const stops: Unsubscribe[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe("watchThread's running turn", () => {
  it("reads the session's requests on a request notice, never on a streamed item, at the old pace where push can miss one", async () => {
    const h = host();
    const views: ThreadView[] = [];
    stops.push(createWiredLab(h.client).watchThread("s1", (view) => views.push(view)));
    await until(() => views.length > 0 && h.count("/requests") === 1);
    expect(views.at(-1)!.running).toBe(false);
    const turns = h.subscriptions.find((s) => s.topics.some((t) => t.scope === "session"))!;
    expect(turns.topics).toEqual([{ scope: "session", id: "s1" }]);
    expect(turns.options.pollIntervalMs).toBe(1_500);

    // A 200-chunk reply sends an items notice per stored chunk: none of them is a read.
    for (let i = 0; i < 200; i++) h.hear({ topic: { scope: "session", id: "s1" }, kind: "items" });
    await settle();
    expect(h.count("/requests")).toBe(1);

    h.run([{ id: "r1", actionName: "respond", status: "in_progress", startedAtMs: 5 }]);
    h.hear({ topic: { scope: "session", id: "s1" }, kind: "request" });
    await until(() => views.at(-1)!.running);
    expect(views.at(-1)!.requestId).toBe("r1");
    expect(h.count("/requests")).toBe(2);
  });
});

describe("watchSessions", () => {
  afterEach(() => {
    listed.clear();
    listings.count = 0;
    listings.failing = 0;
  });

  it("subscribes even when the first listing holds no session, so the fallback timer still reads where push can miss one", async () => {
    const h = host();
    const seen: SessionRow[][] = [];
    stops.push(createWiredLab(h.client).watchSessions((rows) => seen.push(rows)));
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual([]);
    const live = h.subscriptions.filter((s) => !s.closed);
    expect(live).toHaveLength(1);
    expect(live[0]!.topics).toEqual([]);
    expect(live[0]!.options.pollIntervalMs).toBe(3_000);

    // A tick lists again, and a session added since shows.
    listed.set("desk.main", [{ id: "s1", updatedAt: 1 }]);
    h.hear(null);
    await until(() => seen.at(-1)!.length === 1);
  });

  it("reads a row again on its own when its board couldn't be read, rather than showing nothing waiting as if read", async () => {
    listed.set("desk.main", [{ id: "s1", updatedAt: 1 }]);
    const h = host();
    // A task that failed waits on you to retry it.
    h.list([{ id: "t1", goal: "Fix it", status: "errored" }]);
    h.fail("POST /api/flows/f/s1/reads/listTasks_tasks");
    const seen: SessionRow[][] = [];
    stops.push(createWiredLab(h.client).watchSessions((rows) => seen.push(rows)));
    await until(() => h.count("/reads/listTasks_tasks") >= 1 && seen.length >= 1);
    // No notice comes: the row's own retry reads the board again.
    await until(() => seen.at(-1)!.find((row) => row.id === "s1")?.waiting === 1);
  });

  it("lists again on its own after a first listing that failed, with no notice to wake it", async () => {
    listed.set("desk.main", [{ id: "s1", updatedAt: 1 }]);
    listings.failing = 1;
    const h = host();
    const seen: SessionRow[][] = [];
    stops.push(createWiredLab(h.client).watchSessions((rows) => seen.push(rows)));
    await until(() => listings.count >= 1);
    expect(seen).toEqual([]);
    // The retry backs off from 1 s, as the client's own reconnects do.
    await until(() => seen.length === 1);
    expect(seen[0]!.map((row) => row.id)).toEqual(["s1"]);
  });

  it("lists once, then reads a row again on its own session's request or resource notice, never on a streamed item", async () => {
    listed.set("desk.main", [{ id: "s1", updatedAt: 1 }, { id: "s2", updatedAt: 2 }]);
    const h = host();
    const seen: SessionRow[][] = [];
    stops.push(createWiredLab(h.client).watchSessions((rows) => seen.push(rows)));
    await until(() => seen.length === 1);
    expect(seen[0]!.map((row) => row.id).sort()).toEqual(["s1", "s2"]);
    const rows = h.subscriptions.at(-1)!;
    expect(rows.topics).toEqual(expect.arrayContaining([{ scope: "session", id: "s1" }, { scope: "session", id: "s2" }]));
    expect(rows.options.pollIntervalMs).toBe(3_000);
    const requestsOf = (id: string) => h.count(`/sessions/${id}/requests`);
    expect([requestsOf("s1"), requestsOf("s2")]).toEqual([1, 1]);

    for (let i = 0; i < 200; i++) h.hear({ topic: { scope: "session", id: "s1" }, kind: "items" });
    await settle();
    expect(requestsOf("s1")).toBe(1);

    h.run([{ id: "r1", actionName: "respond", status: "in_progress", startedAtMs: 5 }]);
    h.hear({ topic: { scope: "session", id: "s1" }, kind: "request" });
    await until(() => seen.at(-1)!.find((row) => row.id === "s1")!.running);
    // Only that row read again, and the listing wasn't read again.
    expect([requestsOf("s1"), requestsOf("s2")]).toEqual([2, 1]);
    // One listing reads each mode's worker once.
    expect(listings.count).toBe(2);

    h.hear({ topic: { scope: "session", id: "s2", resource: "tasks" }, kind: "resource" });
    await until(() => requestsOf("s2") === 2);
  });

  it("lists a session opened in this tab at once, and hears its notices from then", async () => {
    listed.set("desk.main", [{ id: "s1", updatedAt: 1 }]);
    const h = host();
    const lab = createWiredLab(h.client);
    const seen: SessionRow[][] = [];
    stops.push(lab.watchSessions((rows) => seen.push(rows)));
    await until(() => seen.length === 1);

    listed.set("desk.main", [{ id: "s1", updatedAt: 1 }, { id: "s_new", updatedAt: 9 }]);
    await lab.openSession("session", "private/p1");
    await until(() => seen.at(-1)!.some((row) => row.id === "s_new"));
    expect(h.subscriptions.filter((s) => !s.closed).at(-1)!.topics).toEqual(expect.arrayContaining([{ scope: "session", id: "s_new" }]));
  });
});

describe("watchThread after a failed lookup", () => {
  it("asks again whether the session is threads mode's, rather than failing every retry on the same lookup", async () => {
    const h = host();
    h.fail("GET /api/flows/sessions/s1");
    const views: ThreadView[] = [];
    stops.push(createWiredLab(h.client).watchThread("s1", (view) => views.push(view)));
    // The running-turn read needs the session's mode; the first lookup failed and nothing notifies.
    await until(() => views.length > 0);
  });
});

describe("watchTaskWork", () => {
  it("follows the run's session as soon as the board's read names it, with no clock between", async () => {
    const h = host();
    const lab = createWiredLab(h.client);
    const work: number[] = [];
    stops.push(lab.watchTaskWork("s1", "t1", (next) => work.push(next.entries.length)));
    await settle();
    // No run yet: the work is empty, and nothing is read for it.
    expect(work.at(-1) ?? 0).toBe(0);

    h.list([{ id: "t1", goal: "Fix it", status: "in_progress", run: { sessionId: "run1", requestId: "q1" } }]);
    const started = Date.now();
    stops.push(lab.watchTasks("s1", () => {}));
    await until(() => (work.at(-1) ?? 0) > 0);
    // The run's link came with the board's read; a 2 s clock would have shown it up to 2 s later.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(h.calls.some((call) => call.startsWith("GET /api/flows/sessions/run1/stream"))).toBe(true);
  });
});

describe("watchTasks' freshness", () => {
  it("says stale while its read of the board fails, keeping the last rows, and fresh once one succeeds", async () => {
    const h = host();
    h.list([{ id: "t1", goal: "Fix it", status: "in_progress" }]);
    const rows: unknown[][] = [];
    const stale: boolean[] = [];
    stops.push(createWiredLab(h.client).watchTasks("s1", (next) => rows.push(next), (next) => stale.push(next)));
    await until(() => rows.length === 1);
    expect(stale).toEqual([]);

    // The next read fails: the rows handed last stay, and the watch says they may be old.
    const read = h.calls.find((call) => call.endsWith("/reads/listTasks_tasks"))!;
    h.fail(read);
    h.hear({ kind: "resource" } as WireNotice);
    await until(() => stale.length === 1);
    expect(stale).toEqual([true]);
    expect(rows).toHaveLength(1);

    // The retry reads again, and the watch says the rows are fresh.
    await until(() => stale.length === 2);
    expect(stale).toEqual([true, false]);
  });
});

describe("watchPins", () => {
  it("reads pins through the flow's read, which stores no request, and again only on a user-state notice", async () => {
    const h = host();
    h.pin(["t1"]);
    const seen: string[][] = [];
    stops.push(createWiredLab(h.client).watchPins((ids) => seen.push(ids)));
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual(["t1"]);
    // A read, never an action: an action writes a request row every time the pins are read.
    expect(h.calls.some((call) => call.startsWith("POST") && call.includes("/actions/"))).toBe(false);
    expect(h.subscriptions.at(-1)!.topics).toEqual([{ scope: "user" }]);
    expect(h.subscriptions.at(-1)!.options.pollIntervalMs).toBe(3_000);

    // Another tab's resource write or a reply's item says nothing about pins.
    h.hear({ topic: { scope: "user", resource: "workforce/messages/m1" }, kind: "resource" });
    await settle();
    expect(h.count("/reads/listPins")).toBe(1);

    h.pin(["t1", "t2"]);
    h.hear({ topic: { scope: "user" }, kind: "state" });
    await until(() => seen.length === 2);
    expect(seen[1]).toEqual(["t1", "t2"]);
    expect(h.count("/reads/listPins")).toBe(2);
  });

  it("reads again on its own after a first read that failed, with no notice to wake it", async () => {
    const h = host();
    h.pin(["t1"]);
    h.failPinReads(1);
    const seen: string[][] = [];
    stops.push(createWiredLab(h.client).watchPins((ids) => seen.push(ids)));
    await until(() => h.count("/reads/listPins") === 1);
    expect(seen).toEqual([]);
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual(["t1"]);
  });

  it("finds your pins session again after the first lookup failed, rather than failing every retry on the same lookup", async () => {
    const h = host();
    h.pin(["t1"]);
    h.fail("GET /api/flows/sessions");
    const seen: string[][] = [];
    stops.push(createWiredLab(h.client).watchPins((ids) => seen.push(ids)));
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual(["t1"]);
  });

  it("shows nothing from a read still in flight when the watch stopped", async () => {
    const h = host();
    const seen: string[][] = [];
    const release = h.holdPinReads();
    const stop = createWiredLab(h.client).watchPins((ids) => seen.push(ids));
    await until(() => h.count("/reads/listPins") === 1);
    stop();
    release();
    await settle();
    expect(seen).toEqual([]);
    expect(h.subscriptions.every((s) => s.closed)).toBe(true);
  });
});
