/**
 * The Postgres change bus (FIX-2427): notices cross processes on `LISTEN` /
 * `NOTIFY`, through the Postgres the stores already use.
 *
 * - **Publish.** A notice reaches this process's own subscribers at once, in
 *   process, then goes out as `pg_notify` on the stores' pool, outside any
 *   transaction. Its echo, which comes back over `LISTEN`, is dropped by the
 *   bus's id, so a view in the publishing process wakes once, and still wakes
 *   while the listener is down.
 * - **Listen.** One connection per process, checked out of the tail pool by
 *   the first subscriber and handed back when the last one leaves. A process
 *   with no open view (a BullMQ worker, `fsdev run`) publishes and holds no
 *   listener, ping or warning.
 * - **Whether it crosses** (D1). A `LISTEN` that succeeds proves nothing: a
 *   transaction-mode pooler accepts it and delivers nothing, and a connection
 *   a load balancer drops goes quiet without an error. So the bus pings itself
 *   every 2 s the way a notice travels, and says it crosses processes only
 *   while it hears its own ping come back. Unheard for 3 s, or the connection
 *   lost, it says it does not, and the session stream goes back to its
 *   once-a-second read; it reconnects, sends every subscriber a `resync`, and
 *   says it crosses again on the next ping it hears. It never gives up. The
 *   first connection sends the `resync` too: a notice sent between a view's
 *   first read and the `LISTEN` taking effect was heard by nobody.
 * - **No tail pool, no crossing.** Without one (`{ executor }`, `{ pool }`
 *   without `liveTailPool`, or `liveTailPool: null`) the bus never listens
 *   and never says it crosses.
 *
 * One channel, filtered in process: the payload is the notice's topic and
 * kind and the bus's id, nothing else. A payload over `NOTIFY`'s 8000 bytes
 * drops its `resource` narrowing and goes out as the bare scope: a wider
 * wake, never a lost one.
 */
import { randomUUID } from "node:crypto";
import { createInMemoryBus, type BusTopic, type ChangeBus, type ChangeListener, type ChangeNotice } from "@flow-state-dev/engine";
import type { Pool } from "pg";
import type { QueryExecutor } from "./types";
import { openListen, reconnectDelay, type ListenConnection } from "./listen";

/** The bus's own channel, apart from request tails' `flow_events`. */
export const BUS_CHANNEL = "fsd_bus";

/** `NOTIFY` refuses a payload of 8000 bytes or more. */
const MAX_PAYLOAD_BYTES = 7_999;

const DEFAULT_TIMINGS: PostgresBusTimings = {
  pingIntervalMs: 2_000,
  staleAfterMs: 3_000,
  reconnectMinMs: 100,
  reconnectMaxMs: 30_000
};

/** How often the bus pings, and how long unheard before it stops crossing. */
export type PostgresBusTimings = {
  /** A ping goes out this often while the listener is open. */
  pingIntervalMs: number;
  /** Unheard for longer than this, the bus says it does not cross, and reconnects. */
  staleAfterMs: number;
  /** First wait before a reconnect, doubling per failed attempt. */
  reconnectMinMs: number;
  /** The longest wait between reconnects. */
  reconnectMaxMs: number;
};

/** The Postgres bus, with the `close` its registry calls before ending the pools. */
export type PostgresBus = ChangeBus & {
  /** Stop the ping and hand the listening connection back. Resolves once it is back. */
  close(): Promise<void>;
};

export type PostgresBusOptions = {
  /** The stores' own executor: `pg_notify` runs here. */
  executor: QueryExecutor;
  /** The pool the listening connection comes from; `null` keeps the bus in process. */
  liveTailPool: Pool | null;
  /**
   * Whether notices go out over Postgres at all. `false` for an executor that
   * is not a shared Postgres server (PGlite), whose process no other reaches.
   */
  notify: boolean;
  /** Test-only override of the ping and stale timings. */
  timings?: Partial<PostgresBusTimings>;
};

let warnedNeverHeard = false;
let warnedOversized = false;
let warnedListenerFailure = false;
let warnedListenFailed = false;

/** Create the Postgres bus. */
export function createPostgresBus(options: PostgresBusOptions): PostgresBus {
  return new PgBus(options);
}

type Subscription = { topic: BusTopic; listener: ChangeListener };

class PgBus implements PostgresBus {
  readonly #id = randomUUID();
  readonly #executor: QueryExecutor;
  readonly #pool: Pool | null;
  readonly #notify: boolean;
  readonly #timings: PostgresBusTimings;
  /** This process's fan-out. */
  readonly #local = createInMemoryBus();
  readonly #subscriptions = new Set<Subscription>();
  readonly #crossingListeners = new Set<(crosses: boolean) => void>();

  #crosses = false;
  #closed = false;
  /** Bumped on every start and stop, so a connect that finishes late knows it is stale. */
  #generation = 0;
  #connection: ListenConnection | undefined;
  #attempt = 0;
  #openedAt = 0;
  #lastHeardAt = 0;
  #everHeard = false;
  #pingSeq = 0;
  #ticker: ReturnType<typeof setInterval> | undefined;
  /** The connect in flight, if one is: `close` waits for it to hand its connection back. */
  #connecting: Promise<void> | undefined;
  #retry: { timer: ReturnType<typeof setTimeout>; resolve(): void } | undefined;

  constructor(options: PostgresBusOptions) {
    this.#executor = options.executor;
    this.#pool = options.liveTailPool;
    this.#notify = options.notify;
    this.#timings = { ...DEFAULT_TIMINGS, ...options.timings };
  }

  get crossesProcesses(): boolean {
    return this.#crosses;
  }

  onCrossingChange(listener: (crosses: boolean) => void): () => void {
    this.#crossingListeners.add(listener);
    return () => {
      this.#crossingListeners.delete(listener);
    };
  }

  async publish(notice: ChangeNotice): Promise<void> {
    // This process's views hear it at once, whatever the listener's state.
    await this.#local.publish(notice);
    if (!this.#notify || this.#closed) return;
    await this.#executor.query("SELECT pg_notify($1, $2)", [BUS_CHANNEL, payloadOf(this.#id, notice)]);
  }

  subscribe(topic: BusTopic, listener: ChangeListener): () => void {
    const subscription: Subscription = { topic, listener };
    const stop = this.#local.subscribe(topic, listener);
    this.#subscriptions.add(subscription);
    if (this.#subscriptions.size === 1) this.#start();
    return () => {
      stop();
      if (!this.#subscriptions.delete(subscription)) return;
      if (this.#subscriptions.size === 0) void this.#stop();
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#stop();
  }

  // -------------------------------------------------------------------------
  // The listener
  // -------------------------------------------------------------------------

  #start(): void {
    if (this.#pool === null || this.#closed) return;
    this.#generation += 1;
    this.#attempt = 0;
    this.#connecting = this.#connect(this.#generation);
  }

  async #stop(): Promise<void> {
    this.#generation += 1;
    this.#stopTicker();
    this.#retry?.resolve();
    this.#setCrossing(false);
    const connection = this.#connection;
    this.#connection = undefined;
    await connection?.release();
    await this.#connecting;
  }

  /** Open the listening connection, retrying with backoff until it opens or the run ends. */
  async #connect(generation: number): Promise<void> {
    const pool = this.#pool!;
    while (generation === this.#generation) {
      let connection: ListenConnection | undefined;
      try {
        connection = await openListen(pool, BUS_CHANNEL, {
          notification: (payload) => this.#heard(payload),
          lost: () => this.#lost(connection)
        });
      } catch (error) {
        warnListenFailed(error);
        connection = undefined;
      }
      if (generation !== this.#generation) {
        await connection?.release();
        return;
      }
      if (connection !== undefined && !connection.lost) {
        this.#opened(connection);
        return;
      }
      // Failed to open, or lost before it could be used.
      await connection?.release(true);
      this.#attempt += 1;
      await this.#wait(reconnectDelay(this.#attempt, this.#timings.reconnectMinMs, this.#timings.reconnectMaxMs));
    }
  }

  #opened(connection: ListenConnection): void {
    this.#connection = connection;
    this.#openedAt = Date.now();
    // Every connection, the first included, may have missed notices: one sent
    // after a view's last read and before this LISTEN took effect is gone. So
    // every subscriber reads once, and before the first ping heard can say
    // "crosses" and stop the views' timed read.
    this.#resync();
    this.#startPinging();
  }

  /** The connection failed, or went quiet past the stale bound: stop crossing and reconnect. */
  #lost(connection: ListenConnection | undefined): void {
    if (connection === undefined || this.#connection !== connection) return;
    this.#connection = undefined;
    this.#stopTicker();
    this.#setCrossing(false);
    void connection.release(true);
    const generation = this.#generation;
    this.#attempt += 1;
    this.#connecting = this.#wait(
      reconnectDelay(this.#attempt, this.#timings.reconnectMinMs, this.#timings.reconnectMaxMs)
    ).then(() => this.#connect(generation));
  }

  #startPinging(): void {
    this.#stopTicker();
    this.#ping();
    this.#ticker = setInterval(() => this.#tick(), this.#timings.pingIntervalMs);
    this.#ticker.unref?.();
  }

  #stopTicker(): void {
    if (this.#ticker !== undefined) clearInterval(this.#ticker);
    this.#ticker = undefined;
  }

  /** Check the last ping heard, then send the next. */
  #tick(): void {
    const connection = this.#connection;
    if (connection === undefined) return;
    const since = Math.max(this.#lastHeardAt, this.#openedAt);
    if (Date.now() - since > this.#timings.staleAfterMs) {
      if (!this.#everHeard) warnNeverHeard();
      this.#lost(connection);
      return;
    }
    this.#ping();
  }

  #ping(): void {
    this.#pingSeq += 1;
    const payload = JSON.stringify({ p: this.#id, ping: this.#pingSeq });
    // A ping that fails to go out is a ping unheard: the stale rule answers it.
    this.#executor.query("SELECT pg_notify($1, $2)", [BUS_CHANNEL, payload]).catch(() => {});
  }

  /** A payload on the bus channel: our own ping, our own echo, or another process's notice. */
  #heard(payload: string): void {
    let message: unknown;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const { p, ping } = message as { p?: unknown; ping?: unknown };
    if (p === this.#id) {
      if (ping === undefined) return; // our own notice, already delivered in process
      this.#lastHeardAt = Date.now();
      this.#everHeard = true;
      this.#attempt = 0;
      this.#setCrossing(true);
      return;
    }
    if (ping !== undefined) return; // another process's ping
    const notice = noticeOf(message);
    if (notice === undefined) return;
    if ((message as { w?: unknown }).w === true) this.#wakeScope(notice);
    else void this.#local.publish(notice);
  }

  /**
   * A notice widened to its scope on the way (too large for `NOTIFY`): every
   * subscriber of that scope hears it, narrowed or not, each on its own topic,
   * since the in-process fan-out gives a narrowed subscriber only its own
   * resource and the widened notice names none.
   */
  #wakeScope(notice: ChangeNotice): void {
    const { scope, id, tenantId } = notice.topic;
    const hearing = [...this.#subscriptions].filter(
      ({ topic }) => topic.scope === scope && topic.id === id && topic.tenantId === tenantId
    );
    if (hearing.length === 0) return;
    queueMicrotask(() => {
      for (const subscription of hearing) {
        if (!this.#subscriptions.has(subscription)) continue;
        try {
          subscription.listener({ topic: subscription.topic, kind: notice.kind });
        } catch (error) {
          if (warnedListenerFailure) continue;
          warnedListenerFailure = true;
          console.warn("[flow-state] a change-bus listener threw; later failures are not logged.", error);
        }
      }
    });
  }

  #resync(): void {
    for (const subscription of [...this.#subscriptions]) {
      if (!this.#subscriptions.has(subscription)) continue;
      const { topic, listener } = subscription;
      try {
        listener({ topic, kind: "resync" });
      } catch (error) {
        if (warnedListenerFailure) continue;
        warnedListenerFailure = true;
        console.warn("[flow-state] a change-bus listener threw on resync; later failures are not logged.", error);
      }
    }
  }

  #setCrossing(crosses: boolean): void {
    if (this.#crosses === crosses) return;
    this.#crosses = crosses;
    for (const listener of [...this.#crossingListeners]) {
      try {
        listener(crosses);
      } catch {
        // A listener's failure is its own; the others still hear.
      }
    }
  }

  /** Sleep `ms`, unless the run stops first. Never holds the process open. */
  #wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        if (this.#retry?.timer === timer) this.#retry = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      this.#retry = { timer, resolve: done };
    });
  }
}

/**
 * The `NOTIFY` payload for `notice`: its topic and kind, and the bus's id;
 * `w: true` when it was widened to its scope to fit.
 */
function payloadOf(id: string, notice: ChangeNotice): string {
  const { topic, kind } = notice;
  const payload = JSON.stringify({ p: id, topic, kind });
  if (Buffer.byteLength(payload) <= MAX_PAYLOAD_BYTES || topic.resource === undefined) return payload;
  if (!warnedOversized) {
    warnedOversized = true;
    console.warn(
      "[flow-state] a change notice was too large for Postgres NOTIFY; it went out as its whole scope, waking every view of it. Later ones are not logged."
    );
  }
  const { resource: _resource, ...scope } = topic;
  return JSON.stringify({ p: id, topic: scope, kind, w: true });
}

/** A notice read off the wire, or `undefined` when it isn't one. */
function noticeOf(message: object): ChangeNotice | undefined {
  const { topic, kind } = message as { topic?: Partial<BusTopic>; kind?: unknown };
  if (topic === undefined || typeof kind !== "string") return undefined;
  const { scope, id, tenantId, resource } = topic;
  if (typeof scope !== "string" || typeof id !== "string" || typeof tenantId !== "string") return undefined;
  if (resource !== undefined && typeof resource !== "string") return undefined;
  return {
    topic: { scope, id, tenantId, ...(resource !== undefined ? { resource } : {}) },
    kind: kind as ChangeNotice["kind"]
  };
}

/** The first time a listening connection fails to open, say why; later failures are not logged. */
function warnListenFailed(error: unknown): void {
  if (warnedListenFailed) return;
  warnedListenFailed = true;
  console.warn(
    "[flow-state] the Postgres change bus could not open its listening connection; views on this process keep reading the store once a second while it retries. Later failures are not logged.",
    error
  );
}

function warnNeverHeard(): void {
  if (warnedNeverHeard) return;
  warnedNeverHeard = true;
  console.warn(
    "[flow-state] the Postgres change bus never heard its own ping come back, so views on this process keep reading the store once a second. " +
      "The likely cause is a transaction-mode pooler (PgBouncer, or Supabase's or Neon's pooled endpoint), which accepts LISTEN and delivers nothing. " +
      "To fix it, pass `liveTailPool` a pg.Pool on a direct (session-mode) connection string."
  );
}
