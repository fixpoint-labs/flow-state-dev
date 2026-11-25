/**
 * A stand-in for the lab's server at the client's fetch, for a component's
 * test that draws one screen from data the test names: each session's stored
 * items, each run's recorded work, and a session stream the test can push an
 * item on, and each board's rows as the coding board view answers them now
 * (the lab reads a task's open hold there when you answer it). Every other POST is recorded and answered done, or as `answer`
 * says. The screen still reads through `src/app/` and the real client;
 * only the host behind them is stood in for. A test of how the screen and the
 * host work together uses `app-host.ts`.
 */
import { createElement, type ReactNode } from "react";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import type { RecordedWorkView } from "@flow-state-dev/harness-manager/browser";
import type { ViewOutput } from "@flow-state-dev/core/types";
import { AppProvider, type CodingBoardTask } from "../src/app";
import { codingBoardTask } from "./coding-board-task";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** A run's recorded work, as the recorded work view answers it. */
type RecordedWork = ViewOutput<RecordedWorkView>;

/** What the stand-in serves. */
export interface StubData {
  /** Each session's stored items, by session id. */
  items?: Record<string, unknown[]>;
  /** Each run's recorded work, by request id, as the recorded work view answers it. */
  recorded?: Record<string, { plan?: RecordedWork["plan"]; pullRequests?: RecordedWork["pullRequests"]["rows"] }>;
  /**
   * Each board's tasks by its session id, as the coding board view answers them: a row's `id` and
   * `asks`. Read on every view call, so a test that changes a row here changes what the server holds.
   */
  board?: Record<string, CodingBoardTask[]>;
  /** Answers a POST the screen made: a throw fails it as a lost connection does. Absent: done. */
  answer?: (posted: Posted) => Promise<void> | void;
}

/** One POST the screen made: its path and parsed body. */
export interface Posted {
  path: string;
  body: Record<string, unknown>;
}

/** The run session and request a stub task's work is read from. */
export const RUN = { sessionId: "run-1", requestId: "q1" } as const;

/** A coding run's review stop, as its run session stores it. */
export const reviewStop = (id: string, review: unknown) => ({ id: `item-${id}`, type: "suspension", suspensionId: id, kind: "review", status: "pending", requestId: RUN.requestId, itemIndex: 0, ts: 1, data: review });

/** The review hold a coding task carries on the board, answered at the run's stop `stop`. */
const reviewHold = (stop = "stop-1"): InboxHold =>
  ({
    id: stop,
    source: { kind: "suspension", flowId: "coder", sessionId: RUN.sessionId, requestId: RUN.requestId, suspensionId: stop },
    ask: { kind: "review", prompt: "Accept the changes, or ask for changes in words." },
    openedAt: 1,
    answerable: true,
    unanswerable: null,
  }) as InboxHold;

/** A coding task under review in {@link RUN}, as the coding board's row reads. */
export const underReview = (task: CodingBoardTask, stop = "stop-1"): CodingBoardTask =>
  codingBoardTask({
    ...task,
    asks: [reviewHold(stop)],
    state: undefined,
    run: { ...RUN, attempt: 1 },
  });

/** A client over the stand-in, `wrap` to put a tree under the lab's provider on it, every POST made, `board` to change what the coding board holds, and `push` for a new item. */
export function stubServer(data: StubData = {}) {
  const board = data.board ?? {};
  const posts: Posted[] = [];
  const streams = new Map<string, (frame: string) => void>();
  let requests = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://x");
    const path = parsed.pathname;
    if (init?.method === "POST") {
      const body = (typeof init.body === "string" ? JSON.parse(init.body) : {}) as Record<string, unknown>;
      if (path.endsWith("/views/recordedWork")) {
        const { requestId } = body.input as { requestId: string };
        const run = data.recorded?.[requestId];
        return json({ output: { plan: run?.plan ?? null, pullRequests: { rows: run?.pullRequests ?? [], truncated: false } }, topics: [] });
      }
      if (path.endsWith("/views/sessionTurns")) return json({ output: [], topics: [] });
      if (path.endsWith("/views/codingBoard")) {
        const { sessionId } = body.input as { sessionId: string };
        return json({ output: (board[sessionId] ?? []).map((task) => ({ id: task.id, asks: task.asks })), topics: [] });
      }
      const posted = { path, body };
      posts.push(posted);
      await data.answer?.(posted);
      requests += 1;
      return json({ requestId: `r${requests}`, id: `r${requests}`, status: "completed", output: { ok: true } });
    }
    if (path.endsWith("/stream")) {
      const sessionId = path.split("/").at(-2)!;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.set(sessionId, (frame) => controller.enqueue(new TextEncoder().encode(frame)));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (path.endsWith("/state")) {
      const sessionId = path.split("/").at(-2)!;
      const items = data.items?.[sessionId] ?? [];
      return json({ sessionId, flowKind: "f", at: 1, sessionCreatedAt: 1, clientData: {}, items, pagination: { offset: 0, limit: 200, total: items.length, hasMore: false, nextOffset: items.length } });
    }
    // A request's result, as a board action reads its answer.
    if (/\/requests\/[^/]+(\/result)?$/.test(path)) return json({ request: { id: path.split("/").at(-1), status: "completed", output: { ok: true } }, status: "completed", output: { ok: true } });
    if (path.startsWith("/api/flows/sessions/")) return json({ session: { id: path.split("/").at(-1), flowKind: "f", updatedAt: 1, state: {} } });
    return json({});
  }) as ClientFetch;
  const client = createClient({ userId: "u", baseUrl: "", fetcher });
  let at = 100;
  return {
    client,
    posts,
    board,
    /** Sends `item` on session `sessionId`'s stream, as the host does when it stores one. */
    push: (sessionId: string, item: { requestId?: string }) => {
      at += 1;
      streams.get(sessionId)?.(`event: session.item\ndata: ${JSON.stringify({ stream: "session", sessionId, at, type: "session.item", requestId: item.requestId, item })}\n\n`);
    },
    wrap: (children: ReactNode) => createElement(AppProvider, { client, pollIntervalMs: 100 }, children),
  };
}

/** The review answer a POST carries, when it is one: the object in its body with a `verdict`. */
export function verdictOf(posted: Posted): Record<string, unknown> | undefined {
  const find = (value: unknown): Record<string, unknown> | undefined => {
    if (typeof value !== "object" || value === null) return undefined;
    if ("verdict" in value) return value as Record<string, unknown>;
    for (const inner of Object.values(value)) {
      const found = find(inner);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return find(posted.body);
}
