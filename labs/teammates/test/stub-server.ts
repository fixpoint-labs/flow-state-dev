/**
 * A stand-in for the lab's server at the client's fetch, for a screen test
 * that draws tasks from rows the test names: each conversation's coding board
 * as harness-manager's view answers it (a row's `detail` only on the task the
 * read's `taskId` names, as the view fills it), each session's stored items
 * and a stream the test can push an item on, each run's recorded plan, files
 * and pull requests, and a session's flow. Every other POST is recorded and
 * answered done, or as `answer` says. The screen still reads through
 * `src/app/` and the real client; only the host behind them is stood in for.
 * `TestProvider` puts a tree under the lab's provider on a client over it,
 * merged with the scripted server's when a test hands it one.
 */
import { createElement, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createClient, type Client, type ClientFetch, type SessionConnectionStatus } from "@flow-state-dev/client";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import { AppProvider, useAppClient } from "../src/app";
import type { ConversationView, WindowMark } from "../src/lib/conversation";
import type { ScriptedServer } from "./scripted-server";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** What the stand-in serves. */
export interface StubData {
  /**
   * Each conversation's tasks by its session id, as the coding board view answers them. Read on
   * every view call, so a test that changes a row here changes what the server holds. A row's
   * `detail` is served on the read that names it only, as the view does.
   */
  board?: Record<string, CodingBoardTask[]>;
  /** Each session's stored items, by session id. */
  items?: Record<string, unknown[]>;
  /** Each run's recorded plan, by request id, as the recorded work view answers it. */
  plan?: Record<string, { title: string; status: string | null }[]>;
  /**
   * Each run session's recorded files (a path, or a path and how many of its edits landed) and pull
   * requests, as harness-manager's direct reads read them. A section left out is one the run's
   * harness records none of.
   */
  recorded?: Record<string, { files?: (string | { path: string; applied: number })[]; pullRequests?: { number: number; url: string; title: string | null }[] }>;
  /** Every coding board read fails, as a server that lost the board does: the screen keeps its last rows, stale. */
  boardFails?: boolean;
  /** Answers a POST the screen made: a throw fails it as the board's refusal does. Absent: done. */
  answer?: (posted: Posted) => unknown;
}

/** One POST the screen made: its path and parsed body. */
export interface Posted {
  path: string;
  body: Record<string, unknown>;
}

/** How long a test waits for what the first board read draws (a popup's title, a panel's row): the page draws, reads, then draws again, and a full suite's load can stretch that to seconds. */
export const POPUP_READ = { timeout: 5_000 };

/** A coding board row: the fields a test names over a plain pending row with nothing open. */
export const codingTask = (fields: Partial<CodingBoardTask> & { id: string }): CodingBoardTask => ({
  goal: fields.title ?? fields.id,
  status: "pending",
  attempts: 0,
  asks: [],
  harness: null,
  review: null,
  landed: null,
  error: null,
  pullRequests: [],
  runFlow: null,
  detail: null,
  ...fields,
});

/**
 * An open hold on task `taskId` of Lead's board, as the view's `asks` carries it: a question,
 * answered through the board's `updateTask` on the conversation that filed it, or a review,
 * answered at the run's stop in `run-1`.
 */
/** Thrown by a test's `answer` to refuse the post as the server would: its status and its words, as the engine's answer route refuses a stop already resolved (409, `already-resolved`). */
export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly refused?: string,
  ) {
    super(message);
  }
}

export const hold = (kind: "question" | "review", prompt: string, { id = `hold-${kind}`, taskId = "t1", unanswerable = null as string | null } = {}): InboxHold =>
  ({
    id,
    source:
      kind === "question"
        ? { kind: "task", flowId: "agent", sessionId: "conversation:teammates.chief-of-staff", action: "updateTask_tasks", taskId }
        : { kind: "suspension", flowId: "coder", sessionId: "run-1", requestId: "q1", suspensionId: id },
    ask: { kind, prompt },
    openedAt: 1,
    answerable: unanswerable === null,
    unanswerable,
  }) as InboxHold;

/** A client over the stand-in, every POST made, each board read's input, and `push` for a new item on a session's stream. */
export function stubServer(data: StubData = {}) {
  const board = data.board ?? {};
  const posts: Posted[] = [];
  const boardReads: { sessionId: string; taskId?: string }[] = [];
  const planReads: string[] = [];
  const streams = new Map<string, (frame: string) => void>();
  let requests = 0;
  const outputs = new Map<string, unknown>();
  const fetcher = (async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://x");
    const path = parsed.pathname;
    if (init?.method === "POST") {
      const body = (typeof init.body === "string" ? JSON.parse(init.body) : {}) as Record<string, unknown>;
      if (path.endsWith("/views/codingBoard")) {
        const input = body.input as { sessionId: string; taskId?: string };
        boardReads.push(input);
        if (data.boardFails) return new Response(JSON.stringify({ error: "The board can't be read." }), { status: 500, headers: { "content-type": "application/json" } });
        const tasks = (board[input.sessionId] ?? []).map((task) => ({ ...task, detail: task.id === input.taskId ? (task.detail ?? { answer: null, answerCut: false }) : null }));
        return json({ output: tasks, topics: [] });
      }
      if (path.endsWith("/views/recordedWork")) {
        const { requestId } = body.input as { requestId: string };
        planReads.push(requestId);
        const steps = data.plan?.[requestId];
        return json({ output: { plan: steps === undefined ? null : { rows: steps.map((r, i) => ({ id: `p${i}`, ...r })), truncated: false }, pullRequests: { rows: [], truncated: false } }, topics: [] });
      }
      if (path.endsWith("/views/sessionTurns")) return json({ output: [], topics: [] });
      const posted = { path, body };
      posts.push(posted);
      requests += 1;
      const id = `r${requests}`;
      try {
        outputs.set(id, (await data.answer?.(posted)) ?? { ok: true });
      } catch (error) {
        if (error instanceof Refused) return new Response(JSON.stringify({ error: error.message, refused: error.refused }), { status: error.status, headers: { "content-type": "application/json" } });
        outputs.set(id, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return json({ request: { id, flowId: path.split("/")[3], status: "completed" }, requestId: id, id, status: "completed", output: outputs.get(id) });
    }
    if (path.endsWith("/stream")) {
      const sessionId = path.split("/").at(-2)!;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.set(sessionId, (frame) => {
            // A stream the screen already closed takes nothing more.
            try {
              controller.enqueue(new TextEncoder().encode(frame));
            } catch {}
          });
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
    // A session's resources, as harness-manager's direct reads list them: a run's files and pull requests.
    const manifest = /^\/api\/flows\/sessions\/([^/]+)\/manifest$/.exec(path);
    if (manifest !== null) {
      const run = data.recorded?.[decodeURIComponent(manifest[1]!)];
      const collection = (ref: string, pattern: string) => ({ kind: "collection", ref, pattern, client: { state: { read: true } } });
      return json({
        resources: [...(run?.files === undefined ? [] : [collection("files", "observed-file-ops/**")]), ...(run?.pullRequests === undefined ? [] : [collection("prs", "observed-pull-requests/**")])],
      });
    }
    const listed = /^\/api\/flows\/sessions\/([^/]+)\/resources\/(files|prs)$/.exec(path);
    if (listed !== null) {
      const run = data.recorded?.[decodeURIComponent(listed[1]!)];
      const items =
        listed[2] === "files"
          ? (run?.files ?? []).map((file) => {
              const { path, applied } = typeof file === "string" ? { path: file, applied: 1 } : file;
              return { topic: `run/inv/${path}`, clientData: { lastKind: "edited", appliedCount: applied } };
            })
          : (run?.pullRequests ?? []).map((pr) => ({ topic: `observed-pull-requests/${pr.number}`, clientData: pr }));
      return json({ items, nextCursor: null });
    }
    // A request's status with its stored result, as a board action reads its answer.
    const result = /\/requests\/([^/]+)\/status$/.exec(path);
    if (result !== null) return json({ status: "completed", result: { hasOutput: true, output: outputs.get(result[1]!) ?? { ok: true } } });
    if (path.startsWith("/api/flows/sessions/")) return json({ session: { id: path.split("/").at(-1), flowKind: "agent", updatedAt: 1, state: {} } });
    return json({});
  }) as ClientFetch;
  const client = createClient({ userId: "u", baseUrl: "", fetcher });
  let at = 100;
  return {
    client,
    posts,
    board,
    boardReads,
    /** Each recorded work view read, by the run request it named. */
    planReads,
    /** Whether a feed has session `sessionId`'s stream open, so an item pushed now reaches it. */
    streaming: (sessionId: string) => streams.has(sessionId),
    /** Sends `item` on session `sessionId`'s stream, as the host does when it stores one. */
    push: (sessionId: string, item: { requestId?: string }) => {
      at += 1;
      streams.get(sessionId)?.(`event: session.item\ndata: ${JSON.stringify({ stream: "session", sessionId, at, type: "session.item", requestId: item.requestId, item })}\n\n`);
    },
  };
}

/**
 * The lab's provider for a test, on `client` (a stand-in server's, or none). With the scripted server
 * (`scripted-server.ts`, which answers the roster, the conversations and their other package views) it
 * keeps that one's client and connection, and the stand-in answers what the scripted one leaves to it:
 * the coding board and the recorded work views, a task's run sessions and flows, its board's actions, and
 * their resources. With neither, an empty stand-in.
 */
export function TestProvider({ server, client, children }: { server?: ScriptedServer; client?: Client; children?: ReactNode }) {
  const merged = server === undefined ? (client ?? EMPTY()) : client === undefined ? server.client : mergedClient(server, client);
  return createElement(AppProvider, { client: merged, connection: server?.connection, pollIntervalMs: 100 }, children);
}

/** One merged client per pair, so a provider that draws again keeps its client. */
const merges = new WeakMap<ScriptedServer, WeakMap<Client, Client>>();
function mergedClient(server: ScriptedServer, stand: Client): Client {
  const known = merges.get(server)?.get(stand);
  if (known !== undefined) return known;
  const own = server.client;
  /** The scripted conversations are `conversation:<worker>`: every other session is the stand-in's. */
  const ofScripted = (sessionId: unknown) => typeof sessionId === "string" && sessionId.startsWith("conversation:");
  const sessions = new Proxy(own.sessions, {
    // A list is the scripted server's: it is what workforce's client reads to open a conversation.
    get: (target, key) => (sessionId: unknown, ...rest: unknown[]) => {
      const from = (key === "list" || ofScripted(sessionId) ? target : stand.sessions) as unknown as Record<PropertyKey, (...args: unknown[]) => unknown>;
      return from[key]!(sessionId, ...rest);
    },
  });
  /**
   * A flow's handle: a conversation's door (`respond`), its opening and its turns' aborts and retries are
   * the scripted server's; a board's actions (the Inbox client's posts) and a task's requests, the stand-in's.
   */
  const flow = (address: string) => {
    const scripted = own.flow(address) as unknown as Record<string, (...args: unknown[]) => unknown>;
    const stood = stand.flow(address) as unknown as Record<string, (...args: unknown[]) => unknown>;
    return new Proxy(stood, {
      get: (target, key) => {
        if (key === "send") return (action: unknown, ...rest: unknown[]) => (action === "respond" ? scripted : target).send!(action, ...rest);
        if (key === "createSession" || key === "identity") return scripted[key];
        if (key === "request") {
          return (id: string) => {
            const mine = own.flow(address).request(id) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
            const theirs = stand.flow(address).request(id) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
            // A scripted turn's request is the scripted server's; one it doesn't know is the stand-in's.
            return new Proxy(theirs, {
              get: (handle, verb) =>
                typeof mine[verb as string] === "function"
                  ? (...args: unknown[]) => mine[verb as string]!(...args).catch((error: { status?: number }) => (error?.status === 404 ? handle[verb as string]!(...args) : Promise.reject(error)))
                  : handle[verb as string],
            });
          };
        }
        return target[key as string];
      },
    });
  };
  const merged = {
    ...own,
    view: (ref: { view: string }, input: unknown, options?: unknown) =>
      (ref.view === "codingBoard" || ref.view === "recordedWork" ? stand : own).view(ref as never, input as never, options as never),
    // Both: the scripted server's notices wake a read at once, and the stand-in, a host with no push socket, has each read on its pace too.
    subscribe: (topics: unknown, options: unknown) => {
      const subscriptions = [own.subscribe(topics as never, options as never), stand.subscribe(topics as never, options as never)];
      return { close: () => subscriptions.forEach((subscription) => subscription.close()) };
    },
    sessions,
    flow,
    resources: stand.resources,
  } as unknown as Client;
  if (!merges.has(server)) merges.set(server, new WeakMap());
  merges.get(server)!.set(stand, merged);
  return merged;
}

/** An empty stand-in, once: a provider that draws again keeps its client. */
let empty: Client | undefined;
const EMPTY = (): Client => (empty ??= stubServer().client);

/**
 * A conversation's follower stood in for, for a screen test that draws the views it names:
 * `Follower` publishes them for `sessionId` as the real follower (`ConversationFollower`) publishes
 * what it read, and `show` and `connect` change what it publishes. The screen's own hooks read it;
 * only the reads behind the follower are skipped.
 */
export function standInFollower(sessionId: string, view: ConversationView, connection: SessionConnectionStatus = "live", mark?: WindowMark) {
  let current = { view, connection, mark, follow: (_response: Response) => {} };
  const tells = new Set<() => void>();
  const set = (next: Partial<typeof current>) => {
    current = { ...current, ...next };
    tells.forEach((tell) => tell());
  };
  const subscribe = (tell: () => void) => {
    tells.add(tell);
    return () => void tells.delete(tell);
  };
  function Follower(): null {
    const { conversations } = useAppClient();
    const read = useSyncExternalStore(subscribe, () => current);
    useEffect(() => conversations.publish(sessionId, read), [conversations, read]);
    return null;
  }
  return { Follower, show: (next: ConversationView) => set({ view: next }), connect: (next: SessionConnectionStatus) => set({ connection: next }) };
}
