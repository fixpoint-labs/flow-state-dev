// @vitest-environment happy-dom
/**
 * What a running task's working line reads, wired through the real client:
 * the tool call its run is in now, and the plan its harness recorded for the
 * run the board names now (harness-manager's recorded work view). The session
 * stream sends an item only once it is finished, so a call that starts while
 * the view is open is in flight only on the run request's own stream. And a
 * re-run in the same session is a new request: its plan is the line's from
 * the moment the board names it. The same reads as the Claude Code-style
 * lab's copy of `useTaskWork` (`labs/claude-code-style/test/working-read.test.ts`).
 */
import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { CODER_FLOW, type CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { AppProvider, useTaskWork } from "../src/app";
import { codingTask } from "./stub-server";

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
 * A host with one run session, `run1`: its stored items, each request's live
 * stream, and the plan each request recorded, as the recorded work view
 * answers it. A request in `drops` loses its first connection after that many
 * items; a later one resumes after the sequence number it asks for.
 */
function host(options: { stored: unknown[]; live: Record<string, unknown[]>; plans?: Record<string, string[]>; drops?: Record<string, number> }) {
  const calls: string[] = [];
  const connections = new Map<string, number>();
  const fetcher = (async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://x");
    const path = parsed.pathname;
    calls.push(`${init?.method ?? "GET"} ${path}${parsed.search}`);
    if (path.endsWith("/views/recordedWork")) {
      const { requestId } = (JSON.parse(String(init?.body)) as { input: { requestId: string } }).input;
      const rows = options.plans?.[requestId] ?? [];
      return json({
        output: { plan: rows.length === 0 ? null : { rows: rows.map((title, i) => ({ id: `p${i}`, title, status: "in_progress" })), truncated: false }, pullRequests: { rows: [], truncated: false } },
        topics: [{ scope: "session", id: "run1" }],
      });
    }
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
    if (path.startsWith("/api/flows/sessions/")) return json({ session: { id: path.split("/").at(-1), flowKind: "f", updatedAt: 1, state: {} } });
    return json({});
  }) as ClientFetch;
  const client = createClient({ userId: "u", baseUrl: "", fetcher });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AppProvider, { client, pollIntervalMs: 100 }, children);
  return { client, calls, wrapper };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error("condition never held");
};

afterEach(cleanup);

/** A coding task the board names as running in `run1`, as request `requestId`. */
const running = (requestId: string): CodingBoardTask =>
  codingTask({ id: "t1", title: "Fix it", status: "in_progress", harness: "claude-code", run: { sessionId: "run1", requestId, attempt: 1 }, runFlow: CODER_FLOW });

/** Every work value the hook hands back, in order, deduped by identity. */
function watch(h: ReturnType<typeof host>, task: CodingBoardTask) {
  const seen: ReturnType<typeof useTaskWork>[] = [];
  const hook = renderHook(
    ({ task }: { task: CodingBoardTask }) => {
      const work = useTaskWork(task);
      if (work !== undefined && seen.at(-1) !== work) seen.push(work);
      return work;
    },
    { wrapper: h.wrapper, initialProps: { task } },
  );
  return { seen, latest: () => hook.result.current, rerender: (next: CodingBoardTask) => hook.rerender({ task: next }) };
}

describe("a running task's working line", () => {
  it("names a call that started after the view opened, which only the run request's own stream sends", async () => {
    // Stored: a finished `ls`. Live on the run's request: `pnpm test`, started and not done.
    const h = host({ stored: [tool("c1", "q1", "completed", "ls")], live: { q1: [tool("c1", "q1", "completed", "ls"), tool("c2", "q1", "in_progress", "pnpm test")] } });
    const w = watch(h, running("q1"));
    await until(() => w.latest()?.working?.inFlight !== undefined);
    expect(w.latest()?.working?.inFlight).toEqual({ tool: "Bash", args: { command: "pnpm test" } });
    expect(h.calls.some((call) => call.startsWith("GET /api/flows/coder/requests/q1/stream"))).toBe(true);
  });

  it("reconnects a dropped request stream and resumes it, so a call that starts after the drop still shows", async () => {
    // The first connection carries the finished `ls`, then drops; `pnpm test` starts after it.
    const h = host({ stored: [tool("c1", "q1", "completed", "ls")], live: { q1: [tool("c1", "q1", "completed", "ls"), tool("c2", "q1", "in_progress", "pnpm test")] }, drops: { q1: 1 } });
    const w = watch(h, running("q1"));
    await until(() => w.latest()?.working?.inFlight !== undefined);
    expect(w.latest()?.working?.inFlight).toEqual({ tool: "Bash", args: { command: "pnpm test" } });
    // The second connection resumes after what the first one heard, rather than replaying it.
    expect(h.calls.filter((call) => call.startsWith("GET /api/flows/coder/requests/q1/stream"))).toEqual([
      "GET /api/flows/coder/requests/q1/stream",
      "GET /api/flows/coder/requests/q1/stream?starting_after=1",
    ]);
  });

  it("hands back nothing new for a stream delta that moves neither the work nor the call in flight", async () => {
    // `pnpm test` starts, then two calls under it finish: the call in flight is still `pnpm test`.
    const h = host({
      stored: [tool("c1", "q1", "completed", "ls")],
      live: { q1: [tool("c2", "q1", "in_progress", "pnpm test"), tool("c3", "q1", "completed", "cat a.ts"), tool("c4", "q1", "completed", "cat b.ts")] },
    });
    const w = watch(h, running("q1"));
    await until(() => w.seen.some((work) => work.working?.inFlight !== undefined));
    await new Promise((r) => setTimeout(r, 50));
    expect(new Set(w.seen.filter((work) => work.working?.inFlight !== undefined).map((work) => JSON.stringify(work.working)))).toEqual(
      new Set([JSON.stringify({ inFlight: { tool: "Bash", args: { command: "pnpm test" } } })]),
    );
  });

  it("never names a call an earlier, crashed request left half-done in the same session", async () => {
    // A reused run session: `q0` crashed mid-call and left its call `in_progress` for good. The board names `q1`.
    const h = host({ stored: [tool("c0", "q0", "in_progress", "rm -rf build"), tool("c1", "q1", "completed", "ls")], live: { q1: [tool("c1", "q1", "completed", "ls")] } });
    const w = watch(h, running("q1"));
    await until(() => h.calls.some((call) => call.startsWith("GET /api/flows/coder/requests/q1/stream")) && w.seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    expect(w.seen.some((work) => work.working?.inFlight !== undefined)).toBe(false);
  });

  it("has nothing in flight once the feed holds the call's finished copy", async () => {
    // The request stream dropped before the call's done arrived; the session stream has the finished copy.
    const h = host({ stored: [tool("c2", "q1", "completed", "pnpm test")], live: { q1: [tool("c2", "q1", "in_progress", "pnpm test")] } });
    const w = watch(h, running("q1"));
    await until(() => h.calls.some((call) => call.startsWith("GET /api/flows/coder/requests/q1/stream")) && w.seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    expect(w.latest()?.working?.inFlight).toBeUndefined();
  });

  it("shows a re-run's plan as soon as the board names the new request in the same session", async () => {
    // A feed shows nothing until it holds an item: the run has done one thing.
    const h = host({ stored: [tool("c1", "q1", "completed", "ls")], live: {}, plans: { q1: ["Old run's step"], q2: ["Re-run's step"] } });
    const w = watch(h, running("q1"));
    await until(() => w.latest()?.working?.plan?.[0]?.title === "Old run's step");
    // A re-run in the same session: the board names q2.
    w.rerender(running("q2"));
    await until(() => w.latest()?.working?.plan?.[0]?.title === "Re-run's step");
  });
});
