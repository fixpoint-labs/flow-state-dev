/**
 * A worker's conversation follows its session (FIX-2466): the newest items
 * once, then each item the session stream brings, with nothing read on a
 * clock. Shift Manager's conversation view used to read the whole session
 * every 5 s; on the stream, another worker's message shows as it is stored,
 * and a long reply costs no more reads than a short one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { followSessionItems, readTaskClaims, taskItems, type SessionItems } from "../src/lib/run";
import type { Failure } from "../src/lib/reads";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const message = (id: string, text: string, ts: number) => ({ id, type: "message", status: "completed", requestId: `req_${id}`, itemIndex: 0, ts, role: "assistant", content: [{ type: "output_text", text }] });

function host(history: unknown[], options: { failState?: boolean; failStream?: boolean } = {}) {
  const counts = { state: 0, stream: 0 };
  let send!: (frame: string) => void;
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.includes("/state")) {
      counts.state += 1;
      if (options.failState === true) return json({ error: "the store is down" }, 503);
      const query = new URL(url, "http://x").searchParams;
      const offset = Number(query.get("offset") ?? 0);
      const limit = Number(query.get("limit") ?? 200);
      const types = query.get("item_types")?.split(",");
      const kept = types === undefined ? history : history.filter((item) => types.includes((item as { type: string }).type));
      const page = kept.slice(offset, offset + limit);
      return json({ sessionId: "s1", flowKind: "f", at: 100, sessionCreatedAt: 1, clientData: {}, items: page, pagination: { offset, limit, total: kept.length, hasMore: offset + page.length < kept.length, nextOffset: offset + page.length } });
    }
    if (url.includes("/stream")) {
      counts.stream += 1;
      if (options.failStream === true) return json({ error: "the stream is down" }, 503);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          send = (frame) => controller.enqueue(new TextEncoder().encode(frame));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return json({});
  }) as ClientFetch;
  return {
    client: createClient({ userId: "u", baseUrl: "", fetcher }),
    counts,
    push: (at: number, item: { requestId: string }) =>
      send(`event: session.item\ndata: ${JSON.stringify({ stream: "session", sessionId: "s1", at, type: "session.item", requestId: item.requestId, item })}\n\n`),
  };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error("condition never held");
};

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe("followSessionItems", () => {
  it("reads the session once, then shows each item the stream brings, reading nothing again", async () => {
    const h = host([message("a1", "First.", 10)]);
    const reads: SessionItems[] = [];
    stops.push(followSessionItems(h.client, "s1", { onRead: (read) => reads.push(read), onFailure: () => {} }));
    await until(() => reads.length > 0 && h.counts.stream === 1);
    expect(reads.at(-1)!.items.map((item) => item.id)).toEqual(["a1"]);

    h.push(101, message("a2", "From eng.author: the build is green.", 20));
    await until(() => reads.at(-1)!.items.length === 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(h.counts.state).toBe(1);
  });

  it("says when the session holds more than the first read, newest items first in view", async () => {
    const history = Array.from({ length: 260 }, (_, i) => message(`m${i}`, `line ${i}`, 10 + i));
    const h = host(history);
    const reads: SessionItems[] = [];
    stops.push(followSessionItems(h.client, "s1", { onRead: (read) => reads.push(read), onFailure: () => {} }));
    await until(() => reads.length > 0);
    expect(reads.at(-1)!.truncated).toBe(true);
    expect(reads.at(-1)!.items.at(-1)!.id).toBe("m259");
  });

  it("loads the earlier items on request, reaching the first with no gap or repeat while the stream keeps adding", async () => {
    const history = Array.from({ length: 260 }, (_, i) => message(`m${i}`, `line ${i}`, 10 + i));
    const h = host(history);
    const reads: SessionItems[] = [];
    stops.push(followSessionItems(h.client, "s1", { onRead: (read) => reads.push(read), onFailure: () => {} }));
    await until(() => reads.length > 0 && h.counts.stream === 1);
    expect(reads.at(-1)!.items).toHaveLength(200);

    // A reply arrives on the stream before the earlier page is asked for.
    const live = message("m260", "line 260", 270);
    history.push(live);
    h.push(101, live);
    await until(() => reads.at(-1)!.items.at(-1)!.id === "m260");

    await reads.at(-1)!.loadEarlier!();
    const last = reads.at(-1)!;
    expect(last.items.map((item) => item.id)).toEqual([...history.map((item) => item.id)]);
    expect(last.truncated).toBe(false);
    expect(last.loadEarlier).toBeUndefined();
  });

  it("reports an empty session once its history read lands, whether or not the stream ever opens", async () => {
    const h = host([], { failStream: true });
    const reads: SessionItems[] = [];
    stops.push(followSessionItems(h.client, "s1", { onRead: (read) => reads.push(read), onFailure: () => {} }));
    // The history read landed with nothing in it; the stream keeps failing and never names the runs.
    await until(() => h.counts.state === 1 && h.counts.stream >= 1);
    await until(() => reads.length > 0);
    expect(reads[0]).toEqual({ items: [], truncated: false });
  });

  it("keeps the failure once the feed gives up, never reporting a stopped feed as an empty read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const h = host([], { failState: true });
      const events: string[] = [];
      stops.push(followSessionItems(h.client, "s1", { onRead: (read) => events.push(`read ${read.items.length}`), onFailure: () => events.push("failure") }));
      // Every history try fails, backed off, until the feed stops.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.counts.state).toBeGreaterThan(1);
      expect(events.length).toBeGreaterThan(0);
      expect(events.filter((event) => event.startsWith("read"))).toEqual([]);
      expect(events.at(-1)).toBe("failure");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the feed's connection as it moves, once per change, so the page's bar can say the server is gone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const h = host([], { failState: true });
      const states: string[] = [];
      stops.push(followSessionItems(h.client, "s1", { onRead: () => {}, onFailure: () => {}, onState: (state) => states.push(state) }));
      await vi.advanceTimersByTimeAsync(60_000);
      // It starts connecting and ends stopped once the feed gives up; no state is reported twice in a row.
      expect(states[0]).toBe("connecting");
      expect(states.at(-1)).toBe("stopped");
      expect(states.filter((state, i) => state === states[i - 1])).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why when the first read fails", async () => {
    const h = host([], { failState: true });
    const failures: Failure[] = [];
    stops.push(followSessionItems(h.client, "s1", { onRead: () => {}, onFailure: (why) => failures.push(why) }));
    await until(() => failures.length > 0);
    expect(failures[0]!.message).toContain("the store is down");
  });

  it("still attributes a task's newest steps when its claim is older than the window, through the claims read on their own", async () => {
    // The board claimed t1 first; 260 of its steps follow, so the newest 200 hold no claim.
    const claim = { id: "tc1", type: "component", component: "task-change", status: "completed", requestId: "req_board", itemIndex: 0, ts: 1, data: { collectionId: "tasks/c1", taskId: "t1", kind: "claimed" } };
    const steps = Array.from({ length: 260 }, (_, i) => ({ ...message(`m${i}`, `step ${i}`, 10 + i), taskId: "t1" }));
    const h = host([claim, ...steps]);
    const reads: SessionItems[] = [];
    stops.push(followSessionItems(h.client, "s1", { onRead: (read) => reads.push(read), onFailure: () => {} }));
    await until(() => reads.length > 0);
    const window = reads.at(-1)!;
    expect(window.truncated).toBe(true);
    // The window alone attributes nothing: the attribution learns the board's tasks from its claims.
    expect(taskItems(window.items, "tasks/c1", "t1").items).toHaveLength(0);

    const claims = await readTaskClaims(h.client, "s1", "tasks/c1");
    expect(claims.map((item) => item.id)).toEqual(["tc1"]);
    const shown = taskItems([...claims, ...window.items], "tasks/c1", "t1").items;
    expect(shown.at(-1)!.id).toBe("m259");
    expect(shown).toHaveLength(200);
  });
});
