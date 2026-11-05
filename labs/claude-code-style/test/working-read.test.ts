/**
 * What a running task's working line reads, wired through the real client:
 * the tool call its run is in now, and the plan its harness recorded for the
 * run the board names now. The session stream sends an item only once it is
 * finished, so a call that starts while the view is open is in flight only on
 * the run request's own stream. And a re-run in the same session is a new
 * request: its plan is the line's from the moment the board names it, with no
 * wait for the harness to write the plan again.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type Client, type ClientFetch, type SubscribeOptions, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { createWiredLab, type TaskWork, type Unsubscribe } from "../src/adapter";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const tool = (id: string, requestId: string, status: string, command: string) => ({
  id,
  requestId,
  type: "tool_output",
  status,
  ts: 1,
  itemIndex: 0,
  blockName: "Bash",
  output: status === "completed" ? "ok" : null,
  toolCall: { callId: id, name: "Bash", arguments: JSON.stringify({ command }), generatorBlock: "claude-code" },
});

/** An SSE body that sends `frames` and stays open until the caller aborts it, or drops once sent when `drop` is set. */
function sse(frames: string[], signal: AbortSignal | null | undefined, drop = false) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      if (drop) setTimeout(() => controller.error(new TypeError("network connection lost")), 5);
      signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const itemAdded = (requestId: string, seq: number, item: unknown) =>
  `id: ${requestId}:${seq}\nevent: item.added\ndata: ${JSON.stringify({ stream: "request", type: "item.added", requestId, sequence_number: seq, ts: seq, item })}\n\n`;

/**
 * A host with one task whose run is `run1`: its stored items, each request's
 * live stream, and the plan each request recorded. A request in `drops` loses
 * its first connection after that many items; a later one resumes after the
 * sequence number it asks for.
 */
function host(options: { stored: unknown[]; live: Record<string, unknown[]>; plans?: Record<string, string[]>; drops?: Record<string, number> }) {
  const calls: string[] = [];
  const connections = new Map<string, number>();
  let board: unknown[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://x");
    const path = parsed.pathname;
    calls.push(`${init?.method ?? "GET"} ${path}${parsed.search}`);
    if (path.endsWith("/reads/listTasks_tasks")) return json({ output: { ok: true, tasks: board } });
    if (path.endsWith("/requests")) return json({ requests: [] });
    const request = /\/requests\/([^/]+)\/stream$/.exec(path)?.[1];
    if (request !== undefined) {
      const opened = (connections.get(request) ?? 0) + 1;
      connections.set(request, opened);
      const after = Number(parsed.searchParams.get("starting_after") ?? 0);
      const drop = opened === 1 ? options.drops?.[request] : undefined;
      const frames = (options.live[request] ?? []).map((item, i) => itemAdded(request, i + 1, item)).slice(after, drop);
      return sse(frames, init?.signal, drop !== undefined);
    }
    if (path.endsWith("/stream")) return sse([], init?.signal);
    if (path.endsWith("/state")) {
      const items = options.stored;
      return json({ sessionId: "run1", flowKind: "f", at: 1, sessionCreatedAt: 1, clientData: {}, items, pagination: { offset: 0, limit: 200, total: items.length, hasMore: false, nextOffset: items.length } });
    }
    if (path.endsWith("/manifest")) {
      const resources =
        options.plans === undefined
          ? []
          : [
              { kind: "collection", pattern: "observed-plan/**", ref: "plan", client: { state: { read: true } } },
              { kind: "collection", pattern: "observed-plan-list/**", ref: "markers", client: { state: { read: true } } },
            ];
      return json({ resources });
    }
    if (path.includes("/resources/")) {
      const prefix = parsed.searchParams.get("topicPrefix") ?? "";
      const req = /^observed-plan\/([^/]+)\/$/.exec(prefix)?.[1];
      const rows = req === undefined ? [] : (options.plans?.[req] ?? []);
      return json({ items: rows.map((title, i) => ({ topic: `${prefix}inv/${i}`, clientData: { title, status: "in_progress" } })), nextCursor: null });
    }
    if (path.startsWith("/api/flows/sessions/")) return json({ session: { id: path.split("/").at(-1), flowKind: "f", updatedAt: 1, state: {} } });
    return json({});
  }) as ClientFetch;
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  const client: Client = Object.assign(createClient({ userId: "u", baseUrl: "", fetcher }), {
    subscribe: (topics: readonly WireTopic[], subscribeOptions: SubscribeOptions) => {
      const entry = { topics, options: subscribeOptions, closed: false };
      subscriptions.push(entry);
      return { close: () => void (entry.closed = true) };
    },
  });
  return {
    client,
    calls,
    list: (tasks: unknown[]) => void (board = tasks),
    hear: (notice: WireNotice) => {
      for (const s of subscriptions) if (!s.closed) s.options.onChange(notice);
    },
  };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error("condition never held");
};

const stops: Unsubscribe[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

const running = (requestId: string) => [{ id: "t1", goal: "Fix it", status: "in_progress", run: { sessionId: "run1", requestId } }];

describe("a running task's working line, as the adapter reads it", () => {
  it("names a call that started after the view opened, which only the run request's own stream sends", async () => {
    // Stored: a finished `ls`. Live on the run's request: `pnpm test`, started and not done.
    const h = host({ stored: [tool("c1", "q1", "completed", "ls")], live: { q1: [tool("c1", "q1", "completed", "ls"), tool("c2", "q1", "in_progress", "pnpm test")] } });
    h.list(running("q1"));
    const lab = createWiredLab(h.client);
    let work: TaskWork | undefined;
    stops.push(lab.watchTaskWork("s1", "t1", (next) => (work = next)));
    stops.push(lab.watchTasks("s1", () => {}));
    await until(() => work?.working?.inFlight !== undefined);
    expect(work?.working?.inFlight).toEqual({ tool: "Bash", args: { command: "pnpm test" } });
    expect(h.calls.some((call) => call.startsWith("GET /api/flows/f/requests/q1/stream"))).toBe(true);
  });

  it("reconnects a dropped request stream and resumes it, so a call that starts after the drop still shows", async () => {
    // The first connection carries the finished `ls`, then drops; `pnpm test` starts after it.
    const h = host({ stored: [tool("c1", "q1", "completed", "ls")], live: { q1: [tool("c1", "q1", "completed", "ls"), tool("c2", "q1", "in_progress", "pnpm test")] }, drops: { q1: 1 } });
    h.list(running("q1"));
    const lab = createWiredLab(h.client);
    let work: TaskWork | undefined;
    stops.push(lab.watchTaskWork("s1", "t1", (next) => (work = next)));
    stops.push(lab.watchTasks("s1", () => {}));
    await until(() => work?.working?.inFlight !== undefined);
    expect(work?.working?.inFlight).toEqual({ tool: "Bash", args: { command: "pnpm test" } });
    // The second connection resumes after what the first one heard, rather than replaying it.
    expect(h.calls.filter((call) => call.startsWith("GET /api/flows/f/requests/q1/stream"))).toEqual([
      "GET /api/flows/f/requests/q1/stream",
      "GET /api/flows/f/requests/q1/stream?starting_after=1",
    ]);
  });

  it("has nothing in flight once the feed holds the call's finished copy", async () => {
    // The request stream dropped before the call's done arrived; the session stream has the finished copy.
    const h = host({ stored: [tool("c2", "q1", "completed", "pnpm test")], live: { q1: [tool("c2", "q1", "in_progress", "pnpm test")] } });
    h.list(running("q1"));
    const lab = createWiredLab(h.client);
    const seen: TaskWork[] = [];
    stops.push(lab.watchTaskWork("s1", "t1", (next) => seen.push(next)));
    stops.push(lab.watchTasks("s1", () => {}));
    await until(() => h.calls.some((call) => call.startsWith("GET /api/flows/f/requests/q1/stream")) && seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)?.working?.inFlight).toBeUndefined();
  });

  it("shows a re-run's plan as soon as the board names the new request in the same session", async () => {
    // A feed shows nothing until it holds an item: the run has done one thing.
    const h = host({ stored: [tool("c1", "q1", "completed", "ls")], live: {}, plans: { q1: ["Old run's step"], q2: ["Re-run's step"] } });
    h.list(running("q1"));
    const lab = createWiredLab(h.client);
    let work: TaskWork | undefined;
    stops.push(lab.watchTaskWork("s1", "t1", (next) => (work = next)));
    stops.push(lab.watchTasks("s1", () => {}));
    await until(() => work?.working?.plan?.[0]?.title === "Old run's step");

    // A re-run in the same session: the board names q2. No plan notice arrives.
    h.list(running("q2"));
    h.hear({ topic: { scope: "session", id: "s1", resource: "tasks" }, kind: "board" });
    await until(() => work?.working?.plan?.[0]?.title === "Re-run's step");
  });
});
