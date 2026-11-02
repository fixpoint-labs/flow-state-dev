/**
 * Tests for the session window: `readSessionTail`, `readSessionEarlier` and
 * `refreshSessionWindow`.
 *
 * A conversation that lives for days holds more items than any one read
 * should carry. Read oldest first and capped, its newest replies are the ones
 * dropped, which is the opposite of what a person opened it for. These tests
 * pin the three things that matter: the newest item is always in the first
 * read, earlier items come only on request and leave no gap, and a reply
 * stored behind items already shown still appears on the next read.
 */
import { describe, expect, it, vi } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  readSessionEarlier,
  readSessionTail,
  refreshSessionWindow,
  SESSION_WINDOW_PAGE,
  type GetSessionStateOptions,
  type SessionStateSnapshotResponse
} from "../src";

const message = (n: number, type = "message"): OutputItem =>
  ({ id: `item_${n}`, type, role: "assistant", status: "completed", content: [{ type: "text", text: `line ${n}` }] }) as unknown as OutputItem;

/**
 * A session whose `state` answers as the engine's state route does: the
 * filtered list, sliced at `offset` for `limit`, with the total and the next
 * offset. `items` can change between calls, as a live session's do.
 */
function session(items: OutputItem[]) {
  const state = vi.fn(async (_sessionId: string, options: GetSessionStateOptions = {}): Promise<SessionStateSnapshotResponse> => {
    const kept = options.itemTypes === undefined ? items : items.filter((item) => options.itemTypes!.includes(item.type));
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return {
      sessionId: "s1",
      flowKind: "chat",
      at: state.mock.calls.length,
      clientData: {},
      items: kept.slice(offset, offset + limit),
      pagination: {
        offset,
        limit,
        total: kept.length,
        hasMore: offset + limit < kept.length,
        nextOffset: Math.min(offset + limit, kept.length)
      }
    } as SessionStateSnapshotResponse;
  });
  return { items, source: { state } };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => message(from + i));
const ids = (items: readonly OutputItem[]) => items.map((item) => item.id);

describe("readSessionTail", () => {
  it("reads a session of more than 1,000 items from its end, so the newest reply is in the first read", async () => {
    const { source } = session(range(0, 1_050));

    const window = await readSessionTail(source, "s1");

    expect(window.items.at(-1)?.id).toBe("item_1049");
    expect(ids(window.items)).toEqual(ids(range(850, 1_050)));
    expect(window).toMatchObject({ start: 850, total: 1_050, hasEarlier: true });
    // One page to learn the size, one from the end: never a walk from the start.
    expect(source.state.mock.calls.map((call) => [call[1]?.offset, call[1]?.limit])).toEqual([
      [0, SESSION_WINDOW_PAGE],
      [850, SESSION_WINDOW_PAGE]
    ]);
  });

  it("reads a session that fits in one page in one call, with nothing earlier", async () => {
    const { source } = session(range(0, 12));

    const window = await readSessionTail(source, "s1");

    expect(ids(window.items)).toEqual(ids(range(0, 12)));
    expect(window).toMatchObject({ start: 0, total: 12, hasEarlier: false });
    expect(source.state).toHaveBeenCalledTimes(1);
  });

  it("reads on to the end when the session grew between its two calls", async () => {
    const live = session(range(0, 300));
    const state = live.source.state;
    // The first call answers, then three more items are stored before the second.
    live.source.state = vi.fn(async (...args: Parameters<typeof state>) => {
      const answer = await state(...args);
      if (state.mock.calls.length === 1) live.items.push(...range(300, 303));
      return answer;
    });

    const window = await readSessionTail(live.source, "s1", { limit: 100 });

    expect(window.items.at(-1)?.id).toBe("item_302");
    expect(window).toMatchObject({ start: 200, total: 303 });
  });

  it("reads the new session's end when the session is created again between its two calls", async () => {
    const live = session(range(0, 500));
    const state = live.source.state;
    let created = 1;
    // After the size call, the session is deleted and created again with three items.
    live.source.state = vi.fn(async (...args: Parameters<typeof state>) => {
      const answer = { ...(await state(...args)), sessionCreatedAt: created };
      if (live.source.state.mock.calls.length === 1) {
        live.items.splice(0, live.items.length, ...range(0, 3));
        created = 2;
      }
      return answer;
    });

    const window = await readSessionTail(live.source, "s1");

    expect(window).toMatchObject({ start: 0, total: 3, hasEarlier: false, sessionCreatedAt: 2 });
    expect(ids(window.items)).toEqual(ids(range(0, 3)));
  });

  it("still reaches the newest item with a one-item limit when an item lands between its calls", async () => {
    const live = session(range(0, 2));
    const state = live.source.state;
    live.source.state = vi.fn(async (...args: Parameters<typeof state>) => {
      const answer = await state(...args);
      if (live.source.state.mock.calls.length === 1) live.items.push(message(2));
      return answer;
    });

    const window = await readSessionTail(live.source, "s1", { limit: 1 });

    expect(window.items.at(-1)?.id).toBe("item_2");
  });

  it("asks for the item types on every call, so positions count only those", async () => {
    const mixed = [...range(0, 5).map((item, i) => (i % 2 === 0 ? item : message(100 + i, "reasoning")))];
    const { source } = session(mixed);

    const window = await readSessionTail(source, "s1", { limit: 2, itemTypes: ["message"] });

    expect(ids(window.items)).toEqual(["item_2", "item_4"]);
    expect(window).toMatchObject({ start: 1, total: 3, itemTypes: ["message"] });
    expect(source.state.mock.calls.every((call) => call[1]?.itemTypes?.join() === "message")).toBe(true);
  });
});

describe("readSessionEarlier", () => {
  it("grows the window back a page at a time with no gap, and stops at the start", async () => {
    const { source } = session(range(0, 450));

    const tail = await readSessionTail(source, "s1");
    const once = await readSessionEarlier(source, tail);
    const twice = await readSessionEarlier(source, once);

    expect(once).toMatchObject({ start: 50, total: 450, hasEarlier: true });
    expect(ids(once.items)).toEqual(ids(range(50, 450)));
    expect(twice).toMatchObject({ start: 0, hasEarlier: false });
    expect(ids(twice.items)).toEqual(ids(range(0, 450)));

    const calls = source.state.mock.calls.length;
    expect(await readSessionEarlier(source, twice)).toBe(twice);
    expect(source.state).toHaveBeenCalledTimes(calls);
  });
});

describe("refreshSessionWindow", () => {
  it("shows a reply stored behind an item already on screen, which a read past the old end misses", async () => {
    const live = session(range(0, 500));
    const window = await readSessionTail(live.source, "s1");

    // A reply stamped before the newest item but first stored after it: the
    // session orders items by their stamp, so it lands one from the end.
    const reply = message(9_000);
    live.items.splice(499, 0, reply);
    live.items.push(message(500));

    const refreshed = await refreshSessionWindow(live.source, window);

    expect(ids(refreshed.items)).toContain("item_9000");
    expect(refreshed.items.at(-1)?.id).toBe("item_500");
    expect(refreshed).toMatchObject({ start: 300, total: 502 });
    // Why the window reads from its start: the delta past the old end holds
    // only the shifted tail, never the reply.
    const delta = await live.source.state("s1", { includeItems: true, offset: window.total, limit: 200 });
    expect(ids(delta.items ?? [])).not.toContain("item_9000");
  });

  it("shows the finished text of a reply it first read while the reply was still streaming", async () => {
    const live = session(range(0, 500));
    // The newest item is a reply still being written: it is stored as it runs.
    live.items[499] = { ...message(499), status: "in_progress", content: [{ type: "text", text: "half" }] } as unknown as OutputItem;
    const window = await readSessionTail(live.source, "s1");
    live.items[499] = { ...message(499), content: [{ type: "text", text: "the whole reply" }] } as unknown as OutputItem;
    live.items.push(message(500));

    const refreshed = await refreshSessionWindow(live.source, window);

    expect(refreshed.items.find((item) => item.id === "item_499")).toMatchObject({ status: "completed", content: [{ text: "the whole reply" }] });
  });

  it("starts over when an item is stored behind its read between two pages, so nothing is doubled or skipped", async () => {
    const live = session(range(0, 250));
    const window = await readSessionTail(live.source, "s1", { limit: 50 });
    live.items.push(...range(250, 700));
    const state = live.source.state;
    // After the refresh's first page, an item is stored before the window:
    // every later position shifts by one under the read.
    live.source.state = vi.fn(async (...args: Parameters<typeof state>) => {
      const answer = await state(...args);
      if (live.source.state.mock.calls.length === 1) live.items.unshift(message(-1));
      return answer;
    });

    const refreshed = await refreshSessionWindow(live.source, window);

    // The read noticed the shift and read again: the window is exactly the
    // session from its start, as it now stands.
    expect(ids(refreshed.items)).toEqual(ids(live.items.slice(200)));
    expect(live.source.state.mock.calls.length).toBeGreaterThan(2);
  });

  it("starts at the end again when the session under the id is another one", async () => {
    const live = session(range(0, 500));
    const window = await readSessionTail(live.source, "s1");
    const state = live.source.state;
    // The session was deleted and created again: the same id, a new session.
    live.items.splice(0, live.items.length, ...range(0, 3));
    live.source.state = vi.fn(async (...args: Parameters<typeof state>) => ({ ...(await state(...args)), sessionCreatedAt: 2 }));

    const refreshed = await refreshSessionWindow(live.source, { ...window, sessionCreatedAt: 1 });

    expect(refreshed).toMatchObject({ start: 0, total: 3, hasEarlier: false, sessionCreatedAt: 2 });
    expect(ids(refreshed.items)).toEqual(ids(range(0, 3)));
  });
});
