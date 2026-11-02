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
  let answer!: (event: string, data: Record<string, unknown>) => void;
  let seq = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.includes("respond")) {
      // The send's own streamed response: the answer as it is written.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          answer = (event, data) => controller.enqueue(new TextEncoder().encode(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: seq, ...data })}\n\n`));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
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
  return {
    client: createClient({ userId: "u", baseUrl: "", fetcher }),
    counts,
    push: (at: number, value: unknown) => send(item(at, value)),
    answer: (event: string, data: Record<string, unknown>) => answer(event, data),
  };
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

  it("shows the answer while it is written, from the send's streamed response", async () => {
    // The session stream sends an item once it is finished; without the send's own stream the
    // thread would sit on the question until the whole answer was done.
    const h = host([message("u1", "user", "fix the build", 10)]);
    const lab = createWiredLab(h.client);
    const views: ThreadView[] = [];
    stops.push(lab.watchThread("s1", (view) => views.push(view)));
    await until(() => views.length > 0 && h.counts.stream === 1);

    await lab.send("s1", "and the tests");
    const writing = { id: "a2", requestId: "req_a2", type: "message", role: "assistant", ts: 30, itemIndex: 0, status: "in_progress", content: [{ type: "output_text", text: "" }] };
    h.answer("item.added", { item: writing });
    h.answer("content.delta", { itemId: "a2", contentIndex: 0, delta: "Running the te" });
    await until(() => JSON.stringify(views.at(-1)!.entries).includes("Running the te"));
  });
});
