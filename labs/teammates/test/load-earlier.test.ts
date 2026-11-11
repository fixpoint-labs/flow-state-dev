/**
 * A conversation longer than its first read opens on its newest turns, and
 * *Load earlier* reaches the rest: without it a long-running teammate's first
 * turns, and the tasks they filed, are out of reach.
 */
import { describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { createLabAdapter, type ConversationView } from "../src/adapter";
import { liveOver } from "./live-over";

const line = (n: number) => ({
  id: `msg_${n}`,
  requestId: `req_${n}`,
  type: "message",
  role: n % 2 === 0 ? "user" : "assistant",
  ts: n,
  itemIndex: 0,
  status: "completed",
  content: [{ type: "output_text", text: `line ${n}` }],
});

/** A client whose conversation holds `count` lines, paged by offset as the server pages it. */
function clientOver(count: number): Client {
  const history = Array.from({ length: count }, (_, n) => line(n));
  return {
    sessions: {
      state: async (_id: string, { offset = 0, limit = 500 }: { offset?: number; limit?: number }) => {
        const items = history.slice(offset, offset + limit);
        const nextOffset = offset + items.length;
        return { at: 1, sessionCreatedAt: 1, items, pagination: { offset, limit, total: history.length, hasMore: nextOffset < history.length, nextOffset } };
      },
      stream: () => ({ close() {} }),
      requests: async () => [],
    },
    get live() {
      return liveOver(this as never);
    },
    subscribe: () => ({ close() {} }),
  } as unknown as Client;
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe("a long conversation", () => {
  it("opens on its newest turns, offers Load earlier, and reaches its first line with it", async () => {
    let view: ConversationView | undefined;
    const stop = createLabAdapter(clientOver(260)).watchConversation("wks_1", (next) => (view = next));
    await until(() => view !== undefined);
    expect(view!.entries).toHaveLength(200);
    expect(view!.loadEarlier).toBeTypeOf("function");

    await view!.loadEarlier!();
    await until(() => view!.entries.length === 260);
    stop();
    expect(view!.entries[0]).toMatchObject({ id: "msg_0" });
    expect(new Set(view!.entries.map((entry) => entry.id)).size).toBe(260);
    expect(view!.loadEarlier).toBeUndefined();
  });

  it("offers nothing earlier when the whole conversation fits", async () => {
    let view: ConversationView | undefined;
    const stop = createLabAdapter(clientOver(3)).watchConversation("wks_2", (next) => (view = next));
    await until(() => view !== undefined);
    stop();
    expect(view!.entries).toHaveLength(3);
    expect(view!.loadEarlier).toBeUndefined();
  });
});
