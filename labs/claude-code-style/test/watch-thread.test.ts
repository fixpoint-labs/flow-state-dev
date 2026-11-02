/**
 * A thread is followed, not re-read: the history once, then each new item
 * from the session stream. A pane open on a long session used to read every
 * item again every 1.5 seconds; one that hears the stream shows a reply as
 * soon as it is stored and costs the host one connection.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { createWiredLab, type ThreadView, type Unsubscribe } from "../src/adapter";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const message = (id: string, role: string, text: string, ts: number) => ({
  id,
  type: "message",
  status: "completed",
  requestId: `req_${id}`,
  itemIndex: 0,
  ts,
  role,
  content: [{ type: "output_text", text }],
});

/** A host with one session: its history, its stream (the case pushes frames), and no running turn. */
function host(history: unknown[]) {
  const counts = { state: 0, stream: 0 };
  let send!: (frame: string) => void;
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.includes("/state")) {
      counts.state += 1;
      return json({ sessionId: "s1", flowKind: "f", at: 100, sessionCreatedAt: 1, clientData: {}, items: history, pagination: { offset: 0, limit: 200, total: history.length, hasMore: false, nextOffset: history.length } });
    }
    if (url.includes("/stream")) {
      counts.stream += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          send = (frame) => controller.enqueue(new TextEncoder().encode(frame));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (url.includes("/requests")) return json({ requests: [] });
    return json({ session: { id: "s1", flowKind: "f", state: {} } });
  }) as ClientFetch;
  const item = (at: number, value: unknown) =>
    `event: session.item\ndata: ${JSON.stringify({ stream: "session", sessionId: "s1", at, type: "session.item", requestId: (value as { requestId: string }).requestId, item: value })}\n\n`;
  return { client: createClient({ userId: "u", baseUrl: "", fetcher }), counts, push: (at: number, value: unknown) => send(item(at, value)) };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error("condition never held");
};

const stops: Unsubscribe[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe("watchThread", () => {
  it("reads the history once and shows a new reply from the session stream", async () => {
    const h = host([message("u1", "user", "fix the build", 10)]);
    const views: ThreadView[] = [];
    stops.push(createWiredLab(h.client).watchThread("s1", (view) => views.push(view)));

    await until(() => views.length > 0 && h.counts.stream === 1);
    expect(views.at(-1)!.running).toBe(false);
    const before = views.at(-1)!.entries.length;

    h.push(101, message("a1", "assistant", "On it.", 20));
    await until(() => views.at(-1)!.entries.length > before);
    // The reply came from the stream: the history was read once, and nothing re-read it.
    await new Promise((r) => setTimeout(r, 1_700));
    expect(h.counts.state).toBe(1);
    expect(h.counts.stream).toBe(1);
  });
});
