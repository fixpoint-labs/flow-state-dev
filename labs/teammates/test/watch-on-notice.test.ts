/**
 * The lab's request views read on a change instead of every 1.5 s (FIX-2466):
 * whether a conversation is answering, a worker's busy dot and last activity,
 * and the context-window divider read the conversation's requests on a
 * request notice, and the divider its history summary on that resource's
 * notice too. None reads on `items`: a streaming reply sends one per stored
 * chunk, and a view that read on each would read once per chunk. Wherever
 * push can miss a change, `client.subscribe` reads every 1.5 s, as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client, type ClientFetch, type SubscribeOptions, type WireNotice, type WireTopic } from "@flow-state-dev/client";

vi.mock("@flow-state-dev/workforce/browser", async (original) => {
  const real = await original<typeof import("@flow-state-dev/workforce/browser")>();
  return {
    ...real,
    createWorkforceClient: () => ({
      ensureWorkerSession: async ({ worker }: { worker: string }) => ({ id: `conv_${worker}`, flowKind: "agent" }),
      roster: async () => [],
    }),
  };
});

import { createLabAdapter, type Activity, type ConversationView, type Unsubscribe, type WindowMark } from "../src/adapter";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function host() {
  const calls: string[] = [];
  let requests: unknown[] = [];
  let summary: unknown;
  let holdRequests: Promise<void> | undefined;
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/requests")) {
      await holdRequests;
      return json({ requests });
    }
    if (path.endsWith("/stream")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (path.endsWith("/state")) {
      const items = [{ id: "u1", type: "message", status: "completed", requestId: "r1", itemIndex: 0, ts: 1, role: "user", content: [{ type: "output_text", text: "hi" }] }];
      return json({
        sessionId: "s1",
        flowKind: "agent",
        at: 1,
        sessionCreatedAt: 1,
        clientData: {},
        items,
        resources: { session: summary === undefined ? {} : { historySummary: summary } },
        pagination: { offset: 0, limit: 200, total: 1, hasMore: false, nextOffset: 1 },
      });
    }
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
    subscriptions,
    count: (match: string) => calls.filter((call) => call.includes(match)).length,
    hear: (notice: WireNotice | null) => {
      for (const s of subscriptions) if (!s.closed) s.options.onChange(notice);
    },
    requests: (next: unknown[]) => void (requests = next),
    summary: (next: unknown) => void (summary = next),
    holdRequestReads: () => {
      let release!: () => void;
      holdRequests = new Promise((r) => (release = r));
      return () => {
        holdRequests = undefined;
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
const chunks = (h: ReturnType<typeof host>, sessionId: string) => {
  for (let i = 0; i < 200; i++) h.hear({ topic: { scope: "session", id: sessionId }, kind: "items" });
};

const stops: Unsubscribe[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe("watchConversation's answering state", () => {
  it("reads the requests on a request notice, never on a streamed item, at the old pace where push can miss one", async () => {
    const h = host();
    const views: ConversationView[] = [];
    stops.push(createLabAdapter(h.client).watchConversation("s1", (view) => views.push(view)));
    await until(() => views.length > 0 && h.count("/sessions/s1/requests") === 1);
    const sub = h.subscriptions.find((s) => !s.closed)!;
    expect(sub.topics).toEqual([{ scope: "session", id: "s1" }]);
    expect(sub.options.pollIntervalMs).toBe(1_500);

    chunks(h, "s1");
    await settle();
    expect(h.count("/sessions/s1/requests")).toBe(1);

    h.requests([{ id: "r2", actionName: "respond", status: "in_progress", startedAtMs: 2 }]);
    h.hear({ topic: { scope: "session", id: "s1" }, kind: "request" });
    await until(() => h.count("/sessions/s1/requests") === 2);
  });
});

describe("watchActivity", () => {
  it("waits for the worker's conversation to open, then reads its requests on each request notice", async () => {
    const h = host();
    const lab = createLabAdapter(h.client);
    const seen: Activity[] = [];
    stops.push(lab.watchActivity("eng", (activity) => seen.push(activity)));
    await settle();
    // No conversation yet: idle, and nothing to read or hear.
    expect(seen.at(-1)).toEqual({ running: false, lastActiveAt: 0 });
    expect(h.count("/requests")).toBe(0);

    await lab.openConversation("eng");
    await until(() => h.count("/sessions/conv_eng/requests") === 1);
    expect(h.subscriptions.find((s) => !s.closed)!.topics).toEqual([{ scope: "session", id: "conv_eng" }]);

    chunks(h, "conv_eng");
    await settle();
    expect(h.count("/sessions/conv_eng/requests")).toBe(1);

    h.requests([{ id: "r2", actionName: "respond", status: "in_progress", startedAtMs: 7 }]);
    h.hear({ topic: { scope: "session", id: "conv_eng" }, kind: "request" });
    await until(() => seen.at(-1)!.running);
    expect(seen.at(-1)!.lastActiveAt).toBe(7);
  });

  it("shows nothing from a read still in flight when the watch stopped", async () => {
    const h = host();
    const lab = createLabAdapter(h.client);
    await lab.openConversation("eng");
    const seen: Activity[] = [];
    const release = h.holdRequestReads();
    const stop = lab.watchActivity("eng", (activity) => seen.push(activity));
    await until(() => h.count("/sessions/conv_eng/requests") === 1);
    stop();
    release();
    await settle();
    expect(seen).toEqual([]);
    expect(h.subscriptions.every((s) => s.closed)).toBe(true);
  });
});

describe("watchWindow", () => {
  it("reads on a request notice and on its history summary's notice, and on nothing else", async () => {
    const h = host();
    const marks: Array<WindowMark | undefined> = [];
    stops.push(createLabAdapter(h.client).watchWindow("s1", (mark) => marks.push(mark)));
    await until(() => h.count("/sessions/s1/requests") === 1);
    const sub = h.subscriptions.find((s) => !s.closed)!;
    expect(sub.topics).toEqual([{ scope: "session", id: "s1" }]);
    expect(sub.options.pollIntervalMs).toBe(1_500);

    chunks(h, "s1");
    h.hear({ topic: { scope: "session", id: "s1", resource: "artifacts/notes" }, kind: "resource" });
    await settle();
    expect(h.count("/sessions/s1/requests")).toBe(1);

    h.hear({ topic: { scope: "session", id: "s1", resource: "historySummary" }, kind: "resource" });
    await until(() => h.count("/sessions/s1/requests") === 2);
    h.hear({ topic: { scope: "session", id: "s1" }, kind: "request" });
    await until(() => h.count("/sessions/s1/requests") === 3);
  });
});
