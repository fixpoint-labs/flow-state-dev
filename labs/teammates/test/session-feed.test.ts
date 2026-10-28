/**
 * The session feed's snapshot read: a history that moves while it is paged
 * (a keyed item emitted again, later in display order) must not lose an item
 * the stream would never send again.
 */
import { describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { sessionFeeds } from "../src/lib/session-feed";

const item = (n: number, ts = n): OutputItem =>
  ({ id: `item_${n}`, requestId: "req_1", type: "message", role: "assistant", ts, itemIndex: n, status: "completed", content: [] }) as unknown as OutputItem;

/** A client whose session history is `history`, paged by offset as the server pages it; `onPage` may change it between reads. */
function clientOver(history: OutputItem[], onPage: (offset: number) => void): Client {
  return {
    sessions: {
      state: async (_id: string, { offset = 0, limit = 500 }: { offset?: number; limit?: number }) => {
        onPage(offset);
        const items = history.slice(offset, offset + limit);
        const hasMore = offset + limit < history.length;
        return { at: 1, sessionCreatedAt: 1, items, pagination: { hasMore, nextOffset: offset + items.length } };
      },
      stream: () => ({ close() {} }),
    },
  } as unknown as Client;
}

describe("the session feed", () => {
  it("reads again when a keyed item moves while the history is paged, and loses no item", async () => {
    const history = Array.from({ length: 502 }, (_, n) => item(n));
    let moved = false;
    const client = clientOver(history, (offset) => {
      // Between the first page and the second, item 10 is emitted again, later than everything.
      if (offset > 0 && !moved) {
        moved = true;
        const [again] = history.splice(10, 1);
        history.push({ ...again!, ts: 10_000 } as OutputItem);
      }
    });
    const seen = await new Promise<OutputItem[]>((resolve) => {
      const stop = sessionFeeds(client)("s1").watch((items) => {
        stop();
        resolve(items);
      });
    });
    expect(moved).toBe(true);
    expect(new Set(seen.map((i) => i.id)).size).toBe(502);
  });
});
