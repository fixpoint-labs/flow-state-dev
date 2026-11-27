/**
 * A task's Session finds its steps in a run session the feed shows only the
 * newest of: the attribution learns which tasks are the
 * board's from its claims, read on their own when the feed holds a window.
 */
import { describe, expect, it } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { readTaskClaims, taskItems } from "../src/lib/task-items";

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

describe("a task's steps in a windowed run session", () => {
  it("still attributes a task's newest steps when its claim is older than the window, through the claims read on their own", async () => {
    // The board claimed t1 first; 260 of its steps follow, so the newest 200 hold no claim.
    const claim = { id: "tc1", type: "data", dataType: "task-change", status: "completed", requestId: "req_board", itemIndex: 0, ts: 1, value: { collectionId: "tasks/c1", taskId: "t1", kind: "claimed" } };
    const steps = Array.from({ length: 260 }, (_, i) => ({ ...message(`m${i}`, `step ${i}`, 10 + i), taskId: "t1" }));
    const h = host([claim, ...steps]);
    // What the feed holds: the newest 200.
    const window = steps.slice(-200) as unknown as OutputItem[];
    // The window alone attributes nothing: the attribution learns the board's tasks from its claims.
    expect(taskItems(window, "tasks/c1", "t1").items).toHaveLength(0);

    const claims = await readTaskClaims(h.client, "s1", "tasks/c1");
    expect(claims.map((item) => item.id)).toEqual(["tc1"]);
    const shown = taskItems([...claims, ...window], "tasks/c1", "t1").items;
    expect(shown.at(-1)!.id).toBe("m259");
    expect(shown).toHaveLength(200);
  });
});
