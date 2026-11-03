/**
 * `client.subscribe` (FIX-2428): hear that something under a topic changed,
 * and read again.
 *
 * One hub per client holds one socket (epic D4), shared by every
 * subscription on the client, with each topic counted so the last `close()`
 * on a topic unsubscribes it and the last handle closes the socket.
 *
 * - **Push.** If `GET /capabilities` reports a push, the hub mints through
 *   the client's own fetcher (`POST /users/:userId/stream`), so whatever
 *   credentials the fetcher adds prove who the socket is (D1). The answer's
 *   `transport` decides; only the `websocket` arm is built. The socket gets
 *   the ticket as its first message.
 * - **The timer** (D3). A subscription with `pollIntervalMs` reads on it
 *   wherever push can miss a change: no push; the socket down, from the first
 *   failed reconnect; until the socket's first `crossing` frame says
 *   `crosses: true`, and while it says `false`; and while one of its topics
 *   was refused, which is asked for again at each tick. Without
 *   `pollIntervalMs` there is no timer, and a refused topic is asked for again
 *   on reconnect.
 * - **`onChange`** gets the notice that woke it, or `null` for a connect, a
 *   reconnect, a change of the crossing answer, or a tick. A notice reaches
 *   every subscription with a topic that covers it: the same scope and
 *   session, and the same resource unless the subscription's topic names
 *   none.
 */
import {
  PUSH_CLOSE_CODES,
  PUSH_MINT_MAX_TOPICS,
  wireTopicKey,
  type PushMintAnswer,
  type PushServerFrame,
  type WireNotice,
  type WireTopic
} from "@flow-state-dev/contracts";
import { BACKOFF_INITIAL_MS, backoffDelay } from "../internal/backoff";
import type { Transport } from "../internal/http";
import type { FlowCapabilities } from "../types";

/** Options for `client.subscribe`. */
export type SubscribeOptions = {
  /**
   * Called when something under a subscribed topic may have changed: with
   * the notice that woke it, or `null` for a connect, a reconnect, a change
   * of whether push crosses processes, or a timer tick. Read again here.
   */
  onChange: (notice: WireNotice | null) => void;
  /**
   * Read on a timer at this pace wherever push can miss a change: the host
   * has no push, the socket is down, or its bus doesn't cross processes.
   * Omitted: no timer; reads happen on a notice, a connect and a reconnect.
   */
  pollIntervalMs?: number;
};

/** A live subscription. */
export type Subscription = {
  /** Stop hearing these topics. The last handle on a client closes its socket. */
  close(): void;
};

type Handle = {
  readonly topics: readonly WireTopic[];
  readonly keys: readonly string[];
  readonly onChange: (notice: WireNotice | null) => void;
  readonly pollIntervalMs?: number;
  timer?: ReturnType<typeof setInterval>;
};

/** How long a socket may take to open before the connect counts as failed. */
const HANDSHAKE_TIMEOUT_MS = 10_000;


/** Close codes that mean "this connect failed", not "the connection dropped". */
const FAILED_CONNECT_CODES = new Set<number>([
  PUSH_CLOSE_CODES.ticketRefused,
  PUSH_CLOSE_CODES.ticketTimeout,
  PUSH_CLOSE_CODES.badFrame
]);

let warnedTransport = false;
let warnedHandler = false;

/** The websocket arm of a mint answer. */
type WebSocketAnswer = Extract<PushMintAnswer, { transport: "websocket" }>;

/** A mint answer this client can use, a transport it doesn't build, or nothing usable. */
function readMintAnswer(value: unknown): WebSocketAnswer | { transport: "other"; name: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const answer = value as Record<string, unknown>;
  if (answer.transport === "websocket") {
    const usable =
      typeof answer.ticket === "string" && typeof answer.path === "string" && Array.isArray(answer.topics);
    return usable ? (answer as WebSocketAnswer) : undefined;
  }
  return typeof answer.transport === "string" ? { transport: "other", name: answer.transport } : undefined;
}

/** A frame the server sends, checked before anything reads it; anything else is dropped. */
function readServerFrame(value: unknown): PushServerFrame | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const frame = value as Record<string, unknown>;
  if (frame.type === "subscribed") return { type: "subscribed" };
  if (frame.type === "crossing") return typeof frame.crosses === "boolean" ? { type: "crossing", crosses: frame.crosses } : undefined;
  if (frame.type !== "notice" || typeof frame.kind !== "string") return undefined;
  const topic = frame.topic as Record<string, unknown> | null | undefined;
  if (typeof topic !== "object" || topic === null) return undefined;
  if (topic.resource !== undefined && typeof topic.resource !== "string") return undefined;
  const scoped =
    topic.scope === "session" ? typeof topic.id === "string" : topic.scope === "user" || topic.scope === "org";
  return scoped ? (frame as PushServerFrame) : undefined;
}

/** Whether `subscribed` covers a notice under `heard`. */
function covers(subscribed: WireTopic, heard: WireTopic): boolean {
  if (subscribed.scope !== heard.scope) return false;
  if (subscribed.scope === "session" && heard.scope === "session" && subscribed.id !== heard.id) return false;
  return subscribed.resource === undefined || subscribed.resource === heard.resource;
}

/** The hub one client holds. */
export function createPushHub(deps: {
  transport: Transport;
  userId: string;
  capabilities: () => Promise<FlowCapabilities>;
}): { subscribe(topics: readonly WireTopic[], options: SubscribeOptions): Subscription } {
  const handles = new Set<Handle>();
  /** Every subscribed topic, counted by handle. */
  const counts = new Map<string, { topic: WireTopic; count: number }>();
  /** Topics the current socket hears: the server acknowledged their ticket. */
  const granted = new Set<string>();
  /** Topics the mint left out of its answer, until asked again. */
  const refused = new Set<string>();
  /** Topics a mint is asking for now, each with the connection it asks for. */
  const minting = new Map<string, number>();
  /**
   * The topics of each ticket sent and not yet acknowledged, in the order
   * sent. The server acknowledges tickets in that order, once it hears their
   * topics; until then a read could miss a change under them.
   */
  let unacknowledged: Array<Set<string>> = [];

  let mode: "unknown" | "checking" | "none" | "push" = "unknown";
  let socket: WebSocket | undefined;
  let state: "idle" | "connecting" | "open" = "idle";
  /** Whether the socket's process hears other processes. False until its first frame. */
  let crosses = false;
  let firstCrossingFrame = true;
  /** A connect has failed since the socket was last open: the timer runs meanwhile. */
  let lapsed = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on each connect and teardown, so a stale answer is ignored. */
  let generation = 0;

  const call = (handle: Handle, notice: WireNotice | null): void => {
    if (!handles.has(handle)) return;
    try {
      handle.onChange(notice);
    } catch (error) {
      if (warnedHandler) return;
      warnedHandler = true;
      console.error("[flow-state] a client.subscribe onChange threw; later failures are not logged.", error);
    }
  };

  const covered = (handle: Handle): boolean =>
    state === "open" && crosses && handle.keys.every((key) => granted.has(key));
  /** A first answer is on its way (capabilities, or a connect): no timer yet. */
  const waiting = (): boolean => (mode === "checking" || state === "connecting") && !lapsed;

  const tick = (handle: Handle): void => {
    call(handle, null);
    const asking = handle.keys.filter((key) => refused.has(key));
    if (asking.length > 0) void mintMore(asking);
  };

  /** Start or stop each handle's timer to match what push covers now. */
  const updateTimers = (): void => {
    for (const handle of handles) {
      const wanted = handle.pollIntervalMs !== undefined && !covered(handle) && !waiting();
      if (wanted && handle.timer === undefined) {
        handle.timer = setInterval(() => tick(handle), handle.pollIntervalMs);
      } else if (!wanted && handle.timer !== undefined) {
        clearInterval(handle.timer);
        handle.timer = undefined;
      }
    }
  };

  const allTopics = (): WireTopic[] => [...counts.values()].map((entry) => entry.topic);

  /**
   * Ask the server for `topics`. Resolves to the answer, or `undefined` when
   * what came back is not a mint answer this client can use (no body, a page
   * from a proxy, an answer missing its ticket). Rejects only when the call
   * itself failed (a network error, a non-2xx status), which is retried.
   */
  const mint = async (topics: WireTopic[]): Promise<WebSocketAnswer | { transport: "other"; name: string } | undefined> =>
    readMintAnswer(await deps.transport.json<unknown>(`/api/flows/users/${encodeURIComponent(deps.userId)}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics })
    }));

  /**
   * Record which of `asked` the answer left out, and return the ones it
   * granted. Those are heard only once the server acknowledges the ticket.
   */
  const record = (asked: readonly string[], answer: { topics: WireTopic[] }): Set<string> => {
    const answered = new Set(answer.topics.map(wireTopicKey));
    const grantedNow = new Set<string>();
    for (const key of asked) {
      if (!counts.has(key)) continue;
      if (answered.has(key)) {
        refused.delete(key);
        grantedNow.add(key);
      } else {
        refused.add(key);
      }
    }
    return grantedNow;
  };

  /** Send a ticket for `keys`, to be heard once the server acknowledges it. */
  const sendTicket = (ws: WebSocket, ticket: string, keys: Set<string>): void => {
    // Queued before sending: a server may acknowledge before `send` returns.
    unacknowledged.push(keys);
    ws.send(JSON.stringify({ type: "subscribe", ticket }));
  };

  /** The server heard the oldest ticket's topics: they are covered, and read once. */
  const acknowledged = (): void => {
    const keys = unacknowledged.shift();
    if (keys === undefined) return;
    // A ticket accepted: the connect worked, so the backoff starts over.
    failures = 0;
    const added = new Set<string>();
    for (const key of keys) {
      if (!counts.has(key) || granted.has(key)) continue;
      granted.add(key);
      added.add(key);
    }
    updateTimers();
    // Each connect, and each topic added, reads once (ER-6): it may have
    // missed changes made before the server heard it.
    touched(added);
  };

  const touched = (added: Set<string>): void => {
    for (const handle of [...handles]) if (handle.keys.some((key) => added.has(key))) call(handle, null);
  };

  /** Ask for topics the open socket doesn't hear yet. */
  const mintMore = async (keys: readonly string[]): Promise<void> => {
    if (state !== "open") return;
    const asking = keys.filter(
      (key) => counts.has(key) && !granted.has(key) && !minting.has(key) && !unacknowledged.some((set) => set.has(key))
    );
    if (asking.length === 0) return;
    // One mint takes at most PUSH_MINT_MAX_TOPICS; more go as several tickets
    // over the same socket.
    if (asking.length > PUSH_MINT_MAX_TOPICS) {
      for (let i = 0; i < asking.length; i += PUSH_MINT_MAX_TOPICS) {
        void mintMore(asking.slice(i, i + PUSH_MINT_MAX_TOPICS));
      }
      return;
    }
    const at = generation;
    for (const key of asking) minting.set(key, at);
    let answer: Awaited<ReturnType<typeof mint>>;
    try {
      answer = await mint(asking.map((key) => counts.get(key)!.topic));
    } catch {
      answer = undefined;
    }
    // Only this mint's own markers: a newer connection's mint of the same
    // topic stays in flight.
    for (const key of asking) if (minting.get(key) === at) minting.delete(key);
    if (at !== generation || state !== "open" || socket === undefined) return;
    if (answer === undefined || answer.transport !== "websocket") {
      for (const key of asking) if (counts.has(key)) refused.add(key);
      updateTimers();
      return;
    }
    const grantedNow = record(asking, answer);
    if (answer.topics.length > 0) sendTicket(socket, answer.ticket, grantedNow);
    updateTimers();
  };

  const scheduleRetry = (): void => {
    failures += 1;
    lapsed = true;
    const delay = backoffDelay(failures - 1);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void connect(), delay);
    updateTimers();
  };

  const socketUrl = (path: string): string | undefined => {
    const url = deps.transport.url(`/api/flows${path}`);
    let absolute: URL;
    try {
      const base = (globalThis as { location?: { href?: string } }).location?.href;
      absolute = base !== undefined ? new URL(url, base) : new URL(url);
    } catch {
      return undefined;
    }
    if (absolute.protocol === "http:") absolute.protocol = "ws:";
    else if (absolute.protocol === "https:") absolute.protocol = "wss:";
    else return undefined;
    return absolute.toString();
  };

  /** No push for this client: every subscription reads on its timer. */
  const noPush = (): void => {
    mode = "none";
    state = "idle";
    updateTimers();
  };

  const connect = async (): Promise<void> => {
    if (handles.size === 0 || mode !== "push" || state !== "idle") return;
    clearTimeout(retryTimer);
    state = "connecting";
    const at = ++generation;
    // The connect's own ticket carries the first chunk; the rest are minted
    // once the socket is open.
    const asked = allTopics().slice(0, PUSH_MINT_MAX_TOPICS);
    updateTimers();
    let answer: Awaited<ReturnType<typeof mint>>;
    try {
      answer = await mint(asked);
    } catch {
      if (at !== generation) return;
      state = "idle";
      scheduleRetry();
      return;
    }
    if (at !== generation) return;
    // An answer this client can't use (another transport, or not a mint
    // answer at all) means no push here: read on the timer, never reject.
    if (answer === undefined || answer.transport !== "websocket") {
      if (!warnedTransport) {
        warnedTransport = true;
        const what = answer === undefined ? "an answer it can't read" : `"${answer.name}" push`;
        console.warn(`[flow-state] client.subscribe: the server sent ${what}; reading on the timer.`);
      }
      noPush();
      return;
    }
    const ready = answer;
    const WebSocketImpl = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    const url = socketUrl(ready.path);
    if (WebSocketImpl === undefined || url === undefined) {
      noPush();
      return;
    }
    const ws = new WebSocketImpl(url);
    socket = ws;
    let opened = false;
    /**
     * The socket is gone. A browser reports a failed handshake as an error
     * and a close; Node's WebSocket reports only the error. Either counts
     * once, whichever comes first.
     */
    const ended = (code: number | undefined): void => {
      clearTimeout(handshakeTimer);
      if (socket !== ws) return;
      socket = undefined;
      state = "idle";
      crosses = false;
      granted.clear();
      minting.clear();
      unacknowledged = [];
      generation += 1;
      try {
        ws.close();
      } catch {
        // Already closing.
      }
      if (handles.size === 0) return;
      if (!opened || (code !== undefined && FAILED_CONNECT_CODES.has(code))) {
        scheduleRetry();
        return;
      }
      // A drop (or the server's hourly close): reconnect at once. If that
      // fails, the timer runs from then.
      void connect();
    };
    // A handshake that never answers is a failed connect too.
    const handshakeTimer = setTimeout(() => ended(undefined), HANDSHAKE_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      clearTimeout(handshakeTimer);
      opened = true;
      state = "open";
      lapsed = false;
      crosses = false;
      firstCrossingFrame = true;
      granted.clear();
      unacknowledged = [];
      // The connect reads once the server acknowledges this ticket, not now:
      // a read now could finish before the server hears the topics.
      sendTicket(ws, ready.ticket, record(asked.map(wireTopicKey), ready));
      updateTimers();
      // Topics subscribed while this connect was in flight.
      const asked2 = new Set(asked.map(wireTopicKey));
      void mintMore([...counts.keys()].filter((key) => !asked2.has(key) && !refused.has(key)));
    });
    ws.addEventListener("message", (event) => {
      if (socket !== ws) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String((event as MessageEvent).data));
      } catch {
        return;
      }
      const frame = readServerFrame(parsed);
      if (frame === undefined) return;
      if (frame.type === "subscribed") {
        acknowledged();
        return;
      }
      if (frame.type === "crossing") {
        const first = firstCrossingFrame;
        firstCrossingFrame = false;
        const changed = frame.crosses !== crosses;
        crosses = frame.crosses;
        updateTimers();
        // A change of the answer reads once, as a connect does. The first
        // frame follows the connect's own read (on its acknowledgement), so
        // it adds none.
        if (changed && !first) touched(new Set(granted));
        return;
      }
      if (frame.type === "notice") {
        const { type: _type, ...notice } = frame;
        for (const handle of [...handles]) {
          if (handle.topics.some((subscribed) => covers(subscribed, notice.topic))) call(handle, notice);
        }
      }
    });
    ws.addEventListener("close", (event) => ended((event as CloseEvent).code));
    ws.addEventListener("error", () => ended(undefined));
  };

  const start = async (): Promise<void> => {
    if (mode !== "unknown") {
      if (mode === "push") void connect();
      updateTimers();
      return;
    }
    mode = "checking";
    let push: FlowCapabilities["push"];
    try {
      push = (await deps.capabilities()).push;
    } catch {
      // Unknown: try again later, reading on the timer meanwhile.
      mode = "unknown";
      lapsed = true;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void start(), BACKOFF_INITIAL_MS);
      updateTimers();
      return;
    }
    // An older server sends no `push`: the same as none (BP-030).
    if (push == null) {
      noPush();
      return;
    }
    mode = "push";
    void connect();
  };

  const stop = (): void => {
    generation += 1;
    clearTimeout(retryTimer);
    const ws = socket;
    socket = undefined;
    state = "idle";
    // `ended` ignores a socket that is no longer the current one.
    crosses = false;
    lapsed = false;
    failures = 0;
    granted.clear();
    refused.clear();
    minting.clear();
    unacknowledged = [];
    if (mode === "checking") mode = "unknown";
    ws?.close(1000);
  };

  return {
    subscribe(topics, options) {
      const handle: Handle = {
        topics: [...topics],
        keys: [...new Set(topics.map(wireTopicKey))],
        onChange: options.onChange,
        ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {})
      };
      const fresh: string[] = [];
      handles.add(handle);
      for (const [index, key] of handle.keys.entries()) {
        const entry = counts.get(key);
        if (entry !== undefined) entry.count += 1;
        else {
          counts.set(key, { topic: topics.find((t) => wireTopicKey(t) === key) ?? topics[index]!, count: 1 });
          fresh.push(key);
        }
      }
      if (state === "open") {
        if (fresh.length > 0) void mintMore(fresh);
        // Every topic is already heard: this subscription's connect is now.
        else if (handle.keys.every((key) => granted.has(key))) queueMicrotask(() => call(handle, null));
        updateTimers();
      } else if (mode === "unknown" || (mode === "push" && state === "idle" && !lapsed)) {
        void start();
      } else {
        updateTimers();
      }

      let closed = false;
      return {
        close() {
          if (closed) return;
          closed = true;
          handles.delete(handle);
          if (handle.timer !== undefined) clearInterval(handle.timer);
          const gone: WireTopic[] = [];
          for (const key of handle.keys) {
            const entry = counts.get(key);
            if (entry === undefined) continue;
            entry.count -= 1;
            if (entry.count > 0) continue;
            counts.delete(key);
            refused.delete(key);
            if (granted.delete(key)) gone.push(entry.topic);
          }
          if (handles.size === 0) {
            stop();
            return;
          }
          if (gone.length > 0 && state === "open" && socket !== undefined) {
            socket.send(JSON.stringify({ type: "unsubscribe", topics: gone }));
          }
        }
      };
    }
  };
}
