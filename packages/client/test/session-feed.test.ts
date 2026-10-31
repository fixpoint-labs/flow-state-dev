/**
 * `sessionFeed`: one session followed without React. The feed is what a
 * board of workers or a task transcript reads, so each case holds it to a
 * promise such a view makes to the person looking at it:
 *
 * - what it shows is the history plus everything kept since, from one read
 *   and one connection;
 * - `live` is said only while a connection vouches for it, and a dead
 *   connection says so (`lapsed`), then recovers by itself;
 * - an answer being written grows in place, and a finished answer is never
 *   replaced by a partial copy that arrives late.
 *
 * The transport is scripted at the client's `fetcher` seam; the real host is
 * `packages/node/test/session-feed.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { OutputItem, SessionStreamEvent } from "@flow-state-dev/core/items";
import { createClient, sessionFeed, type ClientFetch, type SessionFeed } from "../src";

/** A body that sends what the case pushes, and stays open until ended or aborted. */
function pipe(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });
  signal?.addEventListener("abort", () => {
    try {
      controller.error(new DOMException("aborted", "AbortError"));
    } catch {
      // Already closed.
    }
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    send: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close()
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function message(requestId: string, id: string, text: string, ts: number, status = "completed"): OutputItem {
  return {
    id,
    type: "message",
    status,
    requestId,
    itemIndex: 0,
    ts,
    provenance: { blockName: "b", blockInstanceId: "b_1", phase: "main" },
    role: "assistant",
    content: [{ type: "output_text", text }]
  } as unknown as OutputItem;
}

const sessionFrame = (event: Omit<SessionStreamEvent, "stream" | "sessionId">): string =>
  `event: ${event.type}\ndata: ${JSON.stringify({ stream: "session", sessionId: "s1", ...event })}\n\n`;
const itemFrame = (at: number, item: OutputItem): string =>
  sessionFrame({ at, type: "session.item", requestId: item.requestId, item } as never);
const runsFrame = (at: number, ids: string[]): string =>
  sessionFrame({
    at,
    type: "session.runs",
    runs: ids.map((id) => ({ id, parentSessionId: "s1", createdAt: at, updatedAt: at }))
  } as never);

let sequence = 0;
const requestFrame = (type: string, data: Record<string, unknown>): string => {
  sequence += 1;
  const payload = { stream: "request", type, requestId: "req_2", sequence_number: sequence, ts: sequence, ...data };
  return `id: req_2:${sequence}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
};

function snapshot(items: OutputItem[], at = 1_000) {
  return {
    sessionId: "s1",
    flowKind: "demo",
    at,
    sessionCreatedAt: 1,
    clientData: {},
    items,
    pagination: { offset: 0, limit: 100, total: items.length, hasMore: false, nextOffset: items.length }
  };
}

function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error("condition never held"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const texts = (feed: SessionFeed): string[] =>
  feed.getSnapshot().items.map((item) => (item as unknown as { content: Array<{ text: string }> }).content[0].text);

const feeds: SessionFeed[] = [];
afterEach(() => {
  for (const feed of feeds.splice(0)) feed.close();
  sequence = 0;
});

/** A host whose state read and session streams the case scripts. */
function host(state: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  const streams: Array<ReturnType<typeof pipe>> = [];
  const next: Array<(signal?: AbortSignal | null) => Response> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.includes("/state")) return state(url);
    const scripted = next.shift();
    if (scripted !== undefined) return scripted(init?.signal);
    const stream = pipe(init?.signal);
    streams.push(stream);
    return stream.response;
  }) as ClientFetch;
  const client = createClient({ userId: "devuser", baseUrl: "", fetcher });
  return { client, urls, streams, next };
}

describe("sessionFeed", () => {
  it("shows the history, then follows the session from where that read began, and says live once the runs are named", async () => {
    const h = host(() => json(snapshot([message("req_1", "m1", "earlier", 10)], 1_000)));
    const feed = sessionFeed(h.client, "s1");
    feeds.push(feed);

    await until(() => h.streams.length === 1);
    expect(feed.getSnapshot().state).toBe("connecting");
    expect(texts(feed)).toEqual(["earlier"]);
    // The stream starts where the history read began, for this session and no other that takes the id.
    expect(h.urls[1]).toBe("/api/flows/sessions/s1/stream?since=1000&session_created_at=1");

    h.streams[0].send(runsFrame(1_001, ["child_1"]) + itemFrame(1_002, message("req_9", "m9", "from another tab", 1_002)));
    await until(() => feed.getSnapshot().items.length === 2);
    expect(feed.getSnapshot().state).toBe("live");
    expect(feed.getSnapshot().runs?.map((run) => run.id)).toEqual(["child_1"]);
    expect(texts(feed)).toEqual(["earlier", "from another tab"]);
  });

  it("says reconnecting on an ordinary close, lapsed once a retry fails, and live again when a connection names the runs", async () => {
    const h = host(() => json(snapshot([])));
    const seen: string[] = [];
    const feed = sessionFeed(h.client, "s1");
    feeds.push(feed);
    feed.subscribe((s) => {
      if (seen[seen.length - 1] !== s.state) seen.push(s.state);
    });

    await until(() => h.streams.length === 1);
    h.streams[0].send(runsFrame(1_001, []));
    await until(() => feed.getSnapshot().state === "live");

    // The server closes; the first retry finds it down.
    h.next.push(() => {
      throw new TypeError("fetch failed");
    });
    h.streams[0].end();
    await until(() => feed.getSnapshot().state === "lapsed");

    // The next try connects and names the runs.
    await until(() => h.streams.length === 2);
    h.streams[1].send(runsFrame(5_000, []));
    await until(() => feed.getSnapshot().state === "live");

    expect(seen).toEqual(["connecting", "live", "reconnecting", "lapsed", "live"]);
  });

  it("says stopped, and keeps the history, when the server has no stream", async () => {
    const h = host(() => json(snapshot([message("req_1", "m1", "earlier", 10)])));
    h.next.push(() => json({ error: "not found" }, 404));
    const feed = sessionFeed(h.client, "s1");
    feeds.push(feed);

    await until(() => feed.getSnapshot().state === "stopped");
    expect(texts(feed)).toEqual(["earlier"]);
  });

  it("grows a sent answer in place, and keeps the finished copy over a partial one that arrives late", async () => {
    const h = host(() => json(snapshot([])));
    const feed = sessionFeed(h.client, "s1");
    feeds.push(feed);
    await until(() => h.streams.length === 1);
    h.streams[0].send(runsFrame(1_001, []));

    const response = pipe();
    feed.followResponse(response.response);
    response.send(requestFrame("request.created", { status: "in_progress" }));
    response.send(requestFrame("item.added", { item: message("req_2", "a1", "Hel", 2_000, "in_progress") }));
    await until(() => texts(feed).join() === "Hel");
    expect(feed.getSnapshot().items[0].status).toBe("in_progress");

    // The session stream carries the finished answer.
    h.streams[0].send(itemFrame(2_100, message("req_2", "a1", "Hello", 2_000)));
    await until(() => texts(feed).join() === "Hello");

    // The send's own stream, behind, sends a partial copy again: the finished one stays.
    response.send(requestFrame("item.updated", { item: message("req_2", "a1", "Hell", 2_000, "in_progress") }));
    response.send(requestFrame("request.completed", { status: "completed" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts(feed)).toEqual(["Hello"]);
    expect(feed.getSnapshot().items[0].status).toBe("completed");
  });

  it("reads the history again after a failure, saying what failed until a read lands", async () => {
    let reads = 0;
    const h = host(() => {
      reads += 1;
      return reads === 1 ? json({ error: "boom" }, 500) : json(snapshot([message("req_1", "m1", "earlier", 10)]));
    });
    const feed = sessionFeed(h.client, "s1", { retryMs: 10 });
    feeds.push(feed);

    await until(() => feed.getSnapshot().error !== null);
    expect(feed.getSnapshot().items).toEqual([]);
    await until(() => texts(feed).join() === "earlier");
    expect(feed.getSnapshot().error).toBeNull();
    expect(feed.getSnapshot().state).toBe("connecting");
  });

  it("backs off a failing history read and gives up after four retries, rather than poll a host that is down", async () => {
    const at: number[] = [];
    const h = host(() => {
      at.push(Date.now());
      return json({ error: "down" }, 503);
    });
    const feed = sessionFeed(h.client, "s1", { retryMs: 10 });
    feeds.push(feed);

    await until(() => feed.getSnapshot().state === "stopped");
    expect(feed.getSnapshot().error).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(at).toHaveLength(5);
    // Each wait is longer than the one before.
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(gaps[3]).toBeGreaterThan(gaps[0]);
    expect(h.streams).toHaveLength(0);
  });

  it("stops on close: the state says stopped, the stream is closed, and no listener hears anything after", async () => {
    const h = host(() => json(snapshot([])));
    const feed = sessionFeed(h.client, "s1");
    await until(() => h.streams.length === 1);
    h.streams[0].send(runsFrame(1_001, []));
    await until(() => feed.getSnapshot().state === "live");

    const heard: string[] = [];
    feed.subscribe((s) => heard.push(s.state));
    feed.close();
    expect(feed.getSnapshot().state).toBe("stopped");
    expect(heard).toEqual(["stopped"]);

    // The stream was aborted, so nothing it would have sent reaches the feed.
    expect(() => h.streams[0].send(itemFrame(1_002, message("req_9", "m9", "late", 1_002)))).toThrow();
    expect(feed.getSnapshot().items).toEqual([]);
  });

  it("keeps only the item types it was asked for, and no transient item", async () => {
    const transient = { ...message("req_1", "t1", "typing", 11), transient: true } as OutputItem;
    const status = { ...message("req_1", "st", "status", 12), type: "status" } as unknown as OutputItem;
    const h = host(() => json(snapshot([message("req_1", "m1", "earlier", 10), transient, status])));
    const feed = sessionFeed(h.client, "s1", { itemTypes: ["message"] });
    feeds.push(feed);

    await until(() => h.streams.length === 1);
    expect(h.urls[0]).toContain("item_types=message");
    expect(texts(feed)).toEqual(["earlier"]);
  });
});
