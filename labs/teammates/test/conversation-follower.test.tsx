// @vitest-environment happy-dom
/**
 * A conversation as its one follower reads it (`ConversationFollower`), over a
 * host this test answers at the client's fetch: what Stop stops and how long
 * it says stopping, the stopped line, the divider from the turns view's
 * `historyStart` and the history summary's mark, *Load earlier* on a long
 * conversation, and one feed for every screen on a conversation. The package
 * reads under it (react's `useSessionFeed`, `useView` and `useResource`, and
 * workforce's `stopTurns`) are pinned in their own packages; these pin how the
 * lab puts them together.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { AppProvider, ConversationFollower, useConversation, useConversationCalls } from "../src/app";
import type { ConversationView } from "../src/lib/conversation";

afterEach(cleanup);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A stored line of request `requestId`. */
const line = (id: string, requestId: string, ts: number, fields: Record<string, unknown> = {}) => ({
  id,
  type: "message",
  status: "completed",
  requestId,
  itemIndex: 0,
  ts,
  role: "user",
  content: [{ type: "output_text", text: id }],
  ...fields,
});
/** A row of workforce's session turns view. */
const turn = (id: string, status: string, startedAt: number, historyStart: string | null = null) => ({
  id, action: "respond", status, source: "http", startedAt, completedAt: null, endedAt: status === "in_progress" ? null : startedAt, error: null,
  historyStart: historyStart === null ? null : { requestId: historyStart },
});

/** The host: a session's items (paged by offset), its turns, its running requests, its history summary, and what was posted to it. */
function host() {
  let items: unknown[] = [line("u1", "r1", 1)];
  let turns: unknown[] = [];
  let running: unknown[] = [];
  let summary: unknown;
  let holdRequests: Promise<void> | undefined;
  const sentIds: string[] = [];
  const aborted: string[] = [];
  let streams = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://x");
    const path = parsed.pathname;
    if (init?.method === "POST" && path.endsWith("/views/sessionTurns")) return json({ output: turns, topics: [] });
    if (init?.method === "POST" && path.endsWith("/views/roster")) return json({ output: [], topics: [] });
    if (init?.method === "POST" && path.endsWith("/abort")) {
      aborted.push(path.split("/").at(-2)!);
      return json({});
    }
    if (init?.method === "POST" && path.includes("/actions/")) {
      const { requestId } = JSON.parse(String(init.body)) as { requestId: string };
      sentIds.push(requestId);
      return json({ request: { id: requestId, status: "in_progress" }, requestId, id: requestId, status: "in_progress" });
    }
    if (path.endsWith("/requests")) {
      await holdRequests;
      return json({ requests: parsed.searchParams.get("status") === "in_progress" ? running : [] });
    }
    if (path.endsWith("/stream")) {
      streams += 1;
      const body = new ReadableStream<Uint8Array>({ start: (controller) => init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError"))) });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (path.endsWith("/state")) {
      const offset = Number(parsed.searchParams.get("offset") ?? 0);
      const limit = Number(parsed.searchParams.get("limit") ?? 500);
      const page = items.slice(offset, offset + limit);
      const next = offset + page.length;
      return json({
        sessionId: "s1", flowKind: "agent", at: 1, sessionCreatedAt: 1, clientData: {}, items: page,
        resources: { session: summary === undefined ? {} : { historySummary: { clientData: summary } } },
        pagination: { offset, limit, total: items.length, hasMore: next < items.length, nextOffset: next },
      });
    }
    if (path.startsWith("/api/flows/sessions/")) return json({ session: { id: path.split("/").at(-1), flowKind: "agent", updatedAt: 1, state: {} } });
    return json({});
  }) as ClientFetch;
  return {
    client: createClient({ userId: "u", baseUrl: "", fetcher }),
    items: (next: unknown[]) => void (items = next),
    turns: (next: unknown[]) => void (turns = next),
    running: (next: unknown[]) => void (running = next),
    summary: (next: unknown) => void (summary = next),
    sentIds,
    aborted,
    streams: () => streams,
    holdRequestReads: () => {
      let release!: () => void;
      holdRequests = new Promise((resolve) => (release = resolve));
      return () => {
        holdRequests = undefined;
        release();
      };
    },
  };
}

/** Conversation `s1` on `h`, followed, with `screens` screens reading it: what the last one read, and the calls. */
function follow(h: ReturnType<typeof host>, screens = 1) {
  const seen: { current?: NonNullable<ReturnType<typeof useConversation>> & { view: ConversationView }; calls?: ReturnType<typeof useConversationCalls> } = {};
  function Screen({ last }: { last: boolean }) {
    const read = useConversation("s1");
    const calls = useConversationCalls();
    if (last) Object.assign(seen, { current: read?.view === undefined ? undefined : read, calls });
    return null;
  }
  const tree = (children: ReactNode) => createElement(AppProvider, { client: h.client, pollIntervalMs: 50 }, children);
  render(tree([createElement(ConversationFollower, { key: "f", sessionId: "s1" }), ...Array.from({ length: screens }, (_, i) => createElement(Screen, { key: i, last: i === screens - 1 }))]));
  return seen;
}

describe("a Stop after a turn that crashed mid-answer, long ago", () => {
  it("never aborts that turn, and never sticks on stopping", async () => {
    const h = host();
    // r0 crashed mid-answer and is past the turns read; r1 answered and is over.
    h.items([
      line("a0", "r0", 1, { role: "assistant", status: "in_progress" }),
      line("u1", "r1", 2),
      line("a1", "r1", 3, { role: "assistant" }),
    ]);
    h.turns([turn("r1", "completed", 2)]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(3));
    await waitFor(() => expect(seen.current?.view.running).toBe(false));
    await seen.calls!.stop("s1");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.aborted).toEqual([]);
    expect(seen.current!.view.stopping).toBe(false);
  });
});

describe("a Stop whose read of running turns answers late", () => {
  it("leaves a line sent after the press to run on", async () => {
    const h = host();
    h.turns([turn("r1", "in_progress", 1)]);
    h.running([{ id: "r1", actionName: "respond", status: "in_progress", startedAtMs: 1 }]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.running).toBe(true));
    const release = h.holdRequestReads();
    const pressed = seen.calls!.stop("s1");
    await seen.calls!.send("s1", "one more thing");
    // The held read answers after that send, and names its turn running too.
    h.running([
      { id: "r1", actionName: "respond", status: "in_progress", startedAtMs: 1 },
      { id: h.sentIds[0], actionName: "respond", status: "in_progress", startedAtMs: 2 },
    ]);
    release();
    await pressed;
    expect(h.aborted).toEqual(["r1"]);
    // Stopping shows until the turn it stopped reads ended, and then clears.
    expect(seen.current!.view.stopping).toBe(true);
    h.turns([turn("r1", "aborted", 1), turn(h.sentIds[0]!, "in_progress", 2)]);
    await waitFor(() => expect(seen.current!.view.stopping).toBe(false));
    expect(seen.current!.view.running).toBe(true);
  });
});

describe("a Stop of a turn older than the turns view's fifty", () => {
  it("ends once the turn is stopped, though the full view never lists it", async () => {
    const h = host();
    // Fifty newer turns fill the view; r0 started before them and still runs.
    h.turns(Array.from({ length: 50 }, (_, i) => turn(`d${i}`, "completed", 10 + i)));
    h.running([{ id: "r0", actionName: "respond", status: "in_progress", startedAtMs: 1 }]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(1));
    await seen.calls!.stop("s1");
    expect(h.aborted).toEqual(["r0"]);
    await waitFor(() => expect(seen.current!.view.stopping).toBe(false));
  });

  it("still says stopping for a stopped turn a view listing fewer than fifty doesn't list yet", async () => {
    const h = host();
    // The view lists fewer than fifty: a turn it doesn't list is one it hasn't read yet, not one that fell off.
    h.turns([turn("r1", "completed", 1)]);
    h.running([{ id: "r2", actionName: "respond", status: "in_progress", startedAtMs: 2 }]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(1));
    await seen.calls!.stop("s1");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen.current!.view.stopping).toBe(true);
    h.turns([turn("r1", "completed", 1), turn("r2", "aborted", 2)]);
    await waitFor(() => expect(seen.current!.view.stopping).toBe(false));
  });
});

describe("a Stop of a turn newer than a full turns view's last read", () => {
  it("still says stopping until the view lists it ended", async () => {
    const h = host();
    // Fifty turns fill the view; r9 started after its last read, so the full view is behind, not past it.
    h.turns(Array.from({ length: 50 }, (_, i) => turn(`d${i}`, "completed", 10 + i)));
    h.running([{ id: "r9", actionName: "respond", status: "in_progress", startedAtMs: 100 }]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(1));
    await seen.calls!.stop("s1");
    expect(h.aborted).toEqual(["r9"]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen.current!.view.stopping).toBe(true);
    h.turns([...Array.from({ length: 49 }, (_, i) => turn(`d${i + 1}`, "completed", 11 + i)), turn("r9", "aborted", 100)]);
    await waitFor(() => expect(seen.current!.view.stopping).toBe(false));
  });
});

describe("a stopped line", () => {
  it("stays once its turn leaves the turns read", async () => {
    const h = host();
    h.turns([turn("r1", "aborted", 1)]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.lines.some((e) => e.kind === "stopped")).toBe(true));
    // Fifty later turns push r1 out of the view's read.
    h.turns(Array.from({ length: 50 }, (_, i) => turn(`d${i}`, "completed", 10 + i)));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen.current!.view.lines.some((e) => e.kind === "stopped")).toBe(true);
  });
});

describe("the divider", () => {
  it("sits where the latest turn's window began, and says summarized once the summary's mark reaches it", async () => {
    const h = host();
    h.items([line("u1", "r1", 1), line("u2", "r2", 2), line("u3", "r3", 3)]);
    h.turns([turn("r1", "completed", 1), turn("r2", "completed", 2), turn("r3", "completed", 3, "r2")]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.mark).toEqual({ firstVerbatimLineId: "u2", summarized: false }));
    // The summary folds r1: the turns before the window's first are summarized, not dropped.
    h.summary({ throughRequestId: "r1", complete: true, folds: 1 });
    await waitFor(() => expect(seen.current?.mark).toEqual({ firstVerbatimLineId: "u2", summarized: true }));
  });
});

describe("a long conversation", () => {
  it("opens on its newest turns, offers Load earlier, and reaches its first line with it", async () => {
    const h = host();
    h.items(Array.from({ length: 260 }, (_, n) => line(`msg_${n}`, `req_${n}`, n, { role: n % 2 === 0 ? "user" : "assistant" })));
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(200));
    expect(seen.current!.view.loadEarlier).toBeTypeOf("function");
    await seen.current!.view.loadEarlier!();
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(260));
    expect(seen.current!.view.lines[0]).toMatchObject({ id: "msg_0" });
    expect(new Set(seen.current!.view.lines.map((line) => line.id)).size).toBe(260);
    expect(seen.current!.view.loadEarlier).toBeUndefined();
  });

  it("offers nothing earlier when the whole conversation fits", async () => {
    const h = host();
    h.items([line("a", "r1", 1), line("b", "r1", 2), line("c", "r1", 3)]);
    const seen = follow(h);
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(3));
    expect(seen.current!.view.loadEarlier).toBeUndefined();
  });
});

describe("a conversation on several screens", () => {
  it("is read once: the list row, the header and the conversation share its one feed", async () => {
    const h = host();
    const seen = follow(h, 3);
    await waitFor(() => expect(seen.current?.view.lines).toHaveLength(1));
    expect(h.streams()).toBe(1);
  });
});
