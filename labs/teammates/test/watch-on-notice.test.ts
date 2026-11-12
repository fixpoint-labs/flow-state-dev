/**
 * The lab's request views read on a change instead of every 1.5 s:
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

import { createLabAdapter, type Activity, type ConversationView, type LabTalk, type Unsubscribe, type WindowMark } from "../src/adapter";
import { liveOver } from "./live-over";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function host() {
  const calls: string[] = [];
  let requests: unknown[] = [];
  let summary: unknown;
  let messages: unknown[] = [];
  let holdRequests: Promise<void> | undefined;
  let requestsFailing = 0;
  const sentIds: string[] = [];
  let items: unknown[] = [{ id: "u1", type: "message", status: "completed", requestId: "r1", itemIndex: 0, ts: 1, role: "user", content: [{ type: "output_text", text: "hi" }] }];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/abort")) return json({});
    if (path.includes("/actions/")) {
      sentIds.push(JSON.parse(String(init?.body)).requestId);
      return json({});
    }
    if (path.endsWith("/requests")) {
      await holdRequests;
      if (requestsFailing > 0) {
        requestsFailing -= 1;
        return json({ error: "down" }, 503);
      }
      const status = new URL(url, "http://x").searchParams.get("status");
      return json({ requests: status === null ? requests : requests.filter((r) => (r as { status?: string }).status === status) });
    }
    if (path.includes("workforceMessages")) return json({ items: messages.map((m) => ({ topic: `workforce/messages/${(m as { id: string }).id}`, clientData: m })) });
    if (path.endsWith("/stream")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (path.endsWith("/state")) {
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
    get live() {
      return liveOver(this as never);
    },
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
    sentIds,
    aborted: () => calls.filter((call) => call.endsWith("/abort")),
    items: (next: unknown[]) => void (items = next),
    failRequestReads: (n: number) => void (requestsFailing = n),
    summary: (next: unknown) => void (summary = next),
    messages: (next: unknown[]) => void (messages = next),
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

describe("a Stop after a turn that crashed mid-answer, long ago", () => {
  it("never aborts that turn, and never sticks on stopping", async () => {
    const h = host();
    // r0 crashed mid-answer and is past the 20-request read; r1 answered and is over.
    h.items([
      { id: "a0", type: "message", status: "in_progress", requestId: "r0", itemIndex: 0, ts: 1, role: "assistant", content: [{ type: "output_text", text: "half" }] },
      { id: "u1", type: "message", status: "completed", requestId: "r1", itemIndex: 1, ts: 2, role: "user", content: [{ type: "output_text", text: "hi" }] },
      { id: "a1", type: "message", status: "completed", requestId: "r1", itemIndex: 2, ts: 3, role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    ]);
    h.requests([{ id: "r1", actionName: "respond", status: "completed", startedAtMs: 2 }]);
    const lab = createLabAdapter(h.client);
    const id = await lab.openConversation("eng");
    const views: ConversationView[] = [];
    stops.push(lab.watchConversation(id, (view) => views.push(view)));
    await until(() => views.some((v) => v.entries.length === 3) && h.count(`/sessions/${id}/requests`) >= 1);
    await lab.interrupt(id);
    await settle();
    expect(h.count("/abort")).toBe(0);
    expect(views.at(-1)!.stopping).toBe(false);
  });
});

describe("a Stop whose read of running turns answers late", () => {
  it("leaves a line sent after the press to run on", async () => {
    const h = host();
    const lab = createLabAdapter(h.client);
    const id = await lab.openConversation("eng");
    h.requests([{ id: "r1", actionName: "respond", status: "in_progress", startedAtMs: 1 }]);
    const views: ConversationView[] = [];
    stops.push(lab.watchConversation(id, (view) => views.push(view)));
    await until(() => views.at(-1)?.running === true);
    const release = h.holdRequestReads();
    const pressed = lab.interrupt(id);
    await lab.send(id, "one more thing");
    // The held read answers after that send, and names its turn running too.
    h.requests([
      { id: "r1", actionName: "respond", status: "in_progress", startedAtMs: 1 },
      { id: h.sentIds[0], actionName: "respond", status: "in_progress", startedAtMs: 2 },
    ]);
    release();
    await pressed;
    expect(h.aborted()).toEqual([expect.stringContaining("/r1/abort")]);
  });
});

describe("a stopped line", () => {
  it("stays once its turn leaves the 20-request read", async () => {
    const h = host();
    h.requests([{ id: "r1", actionName: "respond", status: "aborted", startedAtMs: 1 }]);
    const views: ConversationView[] = [];
    stops.push(createLabAdapter(h.client).watchConversation("s1", (view) => views.push(view)));
    await until(() => views.at(-1)?.entries.some((e) => e.kind === "stopped") === true);
    // Twenty later passes push r1 out of the read.
    h.requests(Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, actionName: "dispatch", status: "completed", startedAtMs: 10 + i })));
    h.hear({ topic: { scope: "session", id: "s1" }, kind: "request" });
    await until(() => h.count("/sessions/s1/requests") === 2);
    await settle();
    expect(views.at(-1)!.entries.some((e) => e.kind === "stopped")).toBe(true);
  });
});

describe("a read that failed", () => {
  it("is tried again on its own, with no notice to wake it", async () => {
    const h = host();
    h.failRequestReads(1);
    h.requests([{ id: "r2", actionName: "respond", status: "in_progress", startedAtMs: 2 }]);
    const views: ConversationView[] = [];
    stops.push(createLabAdapter(h.client).watchConversation("s1", (view) => views.push(view)));
    await until(() => h.count("/sessions/s1/requests") === 1);
    // The retry backs off from 1 s, as the client's own reconnects do.
    await until(() => h.count("/sessions/s1/requests") === 2);
    await until(() => views.at(-1)?.running === true);
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

describe("watchTalk", () => {
  const message = (id: string, at: number) => ({
    id,
    exchange: id,
    from: "eng",
    to: "pm",
    text: `line ${id}`,
    at,
    fromSession: "conv_eng",
    fromFlow: "agent",
    toSession: "conv_pm",
    toFlow: "agent",
    hop: 1,
    status: "delivered",
  });

  it("reads your message log on a notice of it under your user scope, not on a clock; at the old pace where push can miss one", async () => {
    const h = host();
    h.messages([message("msg_1", 1)]);
    const lab = createLabAdapter(h.client);
    await lab.openConversation("eng");
    const shown: LabTalk[][] = [];
    stops.push(lab.watchTalk("eng", (talk) => shown.push(talk)));
    await until(() => shown.length === 1);
    // The log is the user's: a message sent from any session lands under the user's scope.
    const sub = h.subscriptions.find((s) => !s.closed && s.topics.some((t) => t.scope === "user"));
    expect(sub?.topics).toEqual([{ scope: "user" }]);
    expect(sub?.options.pollIntervalMs).toBe(1_500);

    // Push covers the page: no read on a clock, and none for another resource of the user's.
    await new Promise((r) => setTimeout(r, 1_700));
    h.hear({ topic: { scope: "user", resource: "lab-pins" }, kind: "resource" });
    h.hear({ topic: { scope: "user", resource: "workforce/workers/eng" }, kind: "resource" });
    await settle();
    expect(h.count("workforceMessages")).toBe(1);

    h.messages([message("msg_1", 1), message("msg_2", 2)]);
    h.hear({ topic: { scope: "user", resource: "workforce/messages/msg_2" }, kind: "resource" });
    await until(() => shown.length === 2);
    expect(shown[1]!.map((m) => m.id)).toEqual(["msg_1", "msg_2"]);
    expect(h.count("workforceMessages")).toBe(2);
  });
});
