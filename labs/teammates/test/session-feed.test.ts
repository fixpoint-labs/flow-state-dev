/**
 * The session feed: a history that moves while it is paged (a keyed item
 * emitted again, later in display order) must not lose an item the stream
 * would never send again; an answer being written shows as it grows, from its
 * request's stream, since the session stream sends finished items only; and a
 * snapshot read that fails is read again.
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

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
};

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

  it("shows an answer while it is written, from the send's streamed response", async () => {
    const client = clientOver([], () => {});
    let seen: OutputItem[] = [];
    const feed = sessionFeeds(client)("s2");
    const stop = feed.watch((items) => (seen = items));
    await until(() => seen !== undefined);
    const encoder = new TextEncoder();
    let push!: (event: string, data: Record<string, unknown>) => void;
    let seq = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (event, data) => controller.enqueue(encoder.encode(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: seq, ...data })}\n\n`));
      },
    });
    feed.followResponse(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const message = { id: "msg_1", requestId: "req_2", type: "message", role: "assistant", ts: 5, itemIndex: 0, status: "in_progress", content: [{ type: "output_text", text: "" }] };
    push("item.added", { item: message });
    push("content.delta", { itemId: "msg_1", contentIndex: 0, delta: "```ts\nconst a" });
    const textOf = () => (seen.find((i) => i.id === "msg_1") as unknown as { content: { text: string }[] } | undefined)?.content[0]?.text ?? "";
    await until(() => textOf().includes("const a"));
    expect(textOf()).toBe("```ts\nconst a");
    push("content.delta", { itemId: "msg_1", contentIndex: 0, delta: " = 1;" });
    await until(() => textOf().endsWith("= 1;"));
    expect((seen.find((i) => i.id === "msg_1") as unknown as { status: string }).status).toBe("in_progress");
    stop();
  });

  it("keeps a tool result from the send's own stream, so a card lands in order beside the text", async () => {
    const client = clientOver([], () => {});
    let seen: OutputItem[] = [];
    const feed = sessionFeeds(client)("s4");
    const stop = feed.watch((items) => (seen = items));
    const encoder = new TextEncoder();
    let push!: (event: string, data: Record<string, unknown>) => void;
    let seq = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (event, data) => controller.enqueue(encoder.encode(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: seq, ...data })}\n\n`));
      },
    });
    feed.followResponse(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const sent = { id: "out_1", requestId: "req_3", type: "tool_output", ts: 5, itemIndex: 0, status: "completed", toolCall: { name: "sendMessage" }, output: { sent: "m1" } };
    const text = { id: "msg_2", requestId: "req_3", type: "message", role: "assistant", ts: 6, itemIndex: 1, status: "in_progress", content: [{ type: "output_text", text: "" }] };
    push("item.added", { item: sent });
    push("item.added", { item: text });
    push("content.delta", { itemId: "msg_2", contentIndex: 0, delta: "Asked writer." });
    await until(() => seen.some((i) => i.id === "msg_2"));
    // The card's item is there while the text is still being written, and before it.
    expect(seen.map((i) => i.id)).toEqual(["out_1", "msg_2"]);
    stop();
  });

  it("reads the snapshot again when a read fails", async () => {
    let reads = 0;
    const client = clientOver([item(1)], () => {
      reads += 1;
      if (reads === 1) throw new Error("network down");
    });
    const seen = await new Promise<OutputItem[]>((resolve) => {
      const stop = sessionFeeds(client)("s3").watch((items) => {
        stop();
        resolve(items);
      });
    });
    expect(reads).toBe(2);
    expect(seen.map((i) => i.id)).toEqual(["item_1"]);
  }, 10_000);
});
