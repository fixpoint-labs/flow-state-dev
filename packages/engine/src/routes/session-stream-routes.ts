/**
 * `GET /sessions/:sessionId/stream` — one live view of a whole session.
 *
 * A request's stream carries the request a client sent. A session can have
 * other writers: a channel an agent answers in, a board several people work,
 * the same conversation open in two tabs. This route follows all of them. It
 * sends each finished item any request in the session keeps, and a notice
 * naming the session's unfinished runs whenever that set changes.
 *
 * ## How it finds what is new
 *
 * No writer knows anyone is watching. Each open connection reads the store
 * about once a second, with filters every adapter already has, so a reply
 * written by another server reaches a view held by this one:
 *
 * - **Items.** The session's unfinished requests (their items can change
 *   without moving the request's update time on most adapters), plus every
 *   request updated since the floor, in one read from the newest. A request's
 *   finishing write follows its items and moves its update time, so the two
 *   reads miss nothing. The floor trails each read's start by a few seconds,
 *   which covers other servers' clocks and write latency; a repeat costs one
 *   set lookup.
 * - **Runs.** When the stream opens, one read takes every run under the session.
 *   After that, only runs whose update time moved since the floor (a run moves
 *   when a request for it is accepted, before it waits for anything) and runs
 *   already known to be unfinished are checked.
 *
 * Each read costs what is running now, never the session's whole history.
 * Items go through the session snapshot's own filter (`snapshotItemsOf`), and
 * each copy is sent once per connection, keyed by request id and item id
 * together (a keyed item repeats its id across requests) and by the copy's
 * time and index (a keyed item emitted again is a later copy of one item).
 *
 * ## Whose session it reads
 *
 * The session the caller was checked against when the stream opened, and
 * nothing else, however long the connection lasts. Requests are read under
 * that session's tenant, owner and organization (`sessionRequestScope`, as the
 * snapshot reads them), and runs under its tenant, owner and organization too.
 * After each read, before anything it found is sent, the session is read again:
 * if it is gone, or its id now holds another session (`isSameSession`), the
 * connection ends and nothing from that read is sent.
 *
 * ## How it ends
 *
 * Every way out is quiet. The loop stops with its connection, at the next
 * store read, even midway through a read. A failed read ends the connection,
 * and the client reconnects with backoff. So does a session that is gone: the
 * client's reconnect is then answered as any open is, a 404 or a 403, and
 * those stop the client for good. The server closes the connection after at
 * most 15 minutes, so access is checked again at least that often; the client
 * reconnects with the last `at` it heard as `since`, and the server reads from
 * a little before it. An event's `at` moves to a read's start only once that
 * read's items are all sent, so a connection that drops midway through a read
 * misses nothing on the next one.
 */
import type {
  OutputItem,
  SessionRun,
  SessionStreamEvent
} from "@flow-state-dev/core/items";
import type { RequestRecord, RequestStatus, SessionRecord, StoreRegistry } from "../stores/types";
import type { FlowRegistry } from "../registry/flow-registry";
import { toBareSessionId } from "../stores/scope-keys";
import { abortableSleep } from "../stores/subscribe-helpers";
import { serializeSSEFrame } from "../streaming/sse";
import { createSSEStream, type SSEStreamHandle } from "../streaming/sse-stream";
import {
  isCheckedSession,
  isSameSession,
  jsonResponse,
  loadTenantSession,
  refuseUnattributedRecord,
  sessionRequestScope,
  snapshotItemsOf,
  SSE_HEADERS
} from "./route-utils";
import {
  parentIdentity,
  readChildSessionLabels,
  resolveDispatchRunStatus,
  type ParentIdentity
} from "./child-session-routes";
import type { ParsedFlowRoute } from "./parseFlowRoute";

/**
 * The stream's clock. Module-level so a test can shorten it; not exported from
 * the package.
 */
export const SESSION_STREAM_TIMINGS = {
  /** Time between the starts of two reads. */
  intervalMs: 1_000,
  /** The longest a connection stays open before the server closes it. */
  maxAgeMs: 15 * 60_000,
  /** How far each read reaches back before the previous one's start. */
  marginMs: 5_000,
  /** How far the first read reaches back when the client names no `since`. */
  firstReadWindowMs: 60_000,
  /** Longest gap between two events before a ping is sent. */
  pingMs: 15_000
};

/** Requests whose items may change without their update time moving. */
const UNFINISHED_REQUEST_STATUSES: readonly RequestStatus[] = ["in_progress", "suspended"];

/** Rows the first read of requests or runs updated since the floor asks for. */
const RECENT_READ_LIMIT = 20;

type SessionStreamRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /** Tenant id from the request header; namespaces the session key. */
  tenantId?: string;
  /**
   * The session the owner check read and admitted the caller to: `null` when
   * it read none, absent when it read nothing (nothing in the app
   * authenticates).
   */
  checkedSession?: SessionRecord | null;
};

/**
 * Open the session stream. Refuses exactly as the session snapshot does: an
 * unknown session is a 404 and an unattributed one a 409, before anything is
 * streamed.
 *
 * Query: `since`, a server time the stream sent earlier or the session
 * snapshot's `at` (the first read reaches a few seconds before it; without it,
 * the last minute), and `item_types`, the snapshot's own type filter.
 */
export async function handleSessionStream(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "session_stream" }>,
  ctx: SessionStreamRouteContext
): Promise<Response> {
  const session = await loadTenantSession(ctx.stores.session, route.sessionId, ctx.tenantId);
  // The owner check read the session too. Every read the stream makes for as
  // long as it lasts is scoped by this copy, so this copy must be the session
  // that check admitted the caller to, not one that took its id since (or
  // arrived after the check found none).
  if (session === undefined || !isCheckedSession(ctx.checkedSession, session)) {
    return jsonResponse(404, { error: `Unknown session "${route.sessionId}"` });
  }
  const unattributed = refuseUnattributedRecord(ctx.registry, session);
  if (unattributed !== undefined) return unattributed;

  const url = new URL(request.url);
  const since = parseSince(url.searchParams.get("since"));
  const itemTypesParam = url.searchParams.get("item_types");
  const itemTypes = itemTypesParam
    ? new Set(itemTypesParam.split(",").map((t) => t.trim()).filter(Boolean))
    : undefined;

  const handle = createSSEStream({ signal: request.signal });
  void followSession({
    stores: ctx.stores,
    sessionId: route.sessionId,
    tenantId: ctx.tenantId,
    session,
    identity: parentIdentity(session, ctx.tenantId),
    itemTypes,
    since,
    handle,
    signal: request.signal
  });

  return new Response(handle.readable, { status: 200, headers: SSE_HEADERS });
}

/** A `since` the client handed back, or `undefined` when absent or unusable. */
function parseSince(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

type FollowOptions = {
  stores: StoreRegistry;
  sessionId: string;
  tenantId: string | undefined;
  /** The session as the stream opened on it: what every read is scoped by. */
  session: SessionRecord;
  identity: ParentIdentity;
  itemTypes: ReadonlySet<string> | undefined;
  since: number | undefined;
  handle: SSEStreamHandle;
  signal: AbortSignal;
};

/** Thrown at a store read made after the connection ended; ends the loop quietly. */
class ConnectionEnded extends Error {
  override name = "ConnectionEnded";
}

/**
 * `store` as one connection reads it: each call first checks that the
 * connection is still open, and throws {@link ConnectionEnded} once it is not.
 * One read can be long (the first read of runs checks every run under the
 * session, two store reads each), and a connection that ended midway through
 * it makes no further store read.
 */
function whileOpen<T extends object>(store: T, isOpen: () => boolean): T {
  return new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (!isOpen()) throw new ConnectionEnded();
        return (value as (...params: unknown[]) => unknown).apply(target, args);
      };
    }
  });
}

/** The loop behind one connection. Resolves when the connection ends. */
async function followSession(opened: FollowOptions): Promise<void> {
  const { handle, signal, sessionId } = opened;
  const isOpen = (): boolean => !handle.closed && !signal.aborted;
  const options: FollowOptions = {
    ...opened,
    stores: {
      ...opened.stores,
      request: whileOpen(opened.stores.request, isOpen),
      session: whileOpen(opened.stores.session, isOpen)
    }
  };
  const timings = SESSION_STREAM_TIMINGS;
  const openedAt = Date.now();
  let floor =
    options.since !== undefined
      ? options.since - timings.marginMs
      : openedAt - timings.firstReadWindowMs;
  // The `at` every event carries: a time a reconnect can hand back as `since`
  // without missing anything this connection has not sent yet. It becomes a
  // read's start only once that read's items are all sent, so a connection
  // that drops before or midway through a read resumes from where that read
  // began, and the items it had already sent arrive again.
  let resumeAt = floor + timings.marginMs;
  const sent = new Set<string>();
  const runs = new RunTracker(options);
  let lastSentAt = openedAt;

  const send = (event: SessionStreamEvent): void => {
    handle.writeRaw(serializeSSEFrame({ event: event.type, data: event }));
    lastSentAt = Date.now();
  };

  try {
    await runs.readAll();
    if (!(await stillTheSession(options))) return;
    send({ stream: "session", sessionId, type: "session.runs", at: resumeAt, runs: runs.list() });

    while (isOpen()) {
      const start = Date.now();
      if (start - openedAt >= timings.maxAgeMs) break;

      const found = await readFinishedItems(options, floor);
      const runsChanged = await runs.refresh(floor);
      // After the reads and before anything they found is sent: what they
      // found under the id is only this stream's while the id still holds the
      // session it opened on.
      if (!(await stillTheSession(options))) return;

      for (const { requestId, item } of found) {
        // One copy of an item, not the item: a keyed item emitted again keeps
        // its id and takes a later time and index, and is sent again.
        const key = `${requestId}\u0000${item.id}\u0000${item.ts}\u0000${item.itemIndex}`;
        if (sent.has(key)) continue;
        sent.add(key);
        send({ stream: "session", sessionId, type: "session.item", at: resumeAt, requestId, item });
      }
      resumeAt = start;

      if (runsChanged) {
        send({ stream: "session", sessionId, type: "session.runs", at: resumeAt, runs: runs.list() });
      } else if (Date.now() - lastSentAt >= timings.pingMs) {
        send({ stream: "session", sessionId, type: "ping", at: resumeAt });
      }

      floor = start - timings.marginMs;
      await abortableSleep(Math.max(0, start + timings.intervalMs - Date.now()), signal);
    }
  } catch (error) {
    // A failed read ends the connection; the client reconnects with backoff
    // and hands back the last `at` it heard, so nothing is lost. A read cut
    // short by the connection ending is not a failure worth a line.
    if (isOpen() && !(error instanceof ConnectionEnded)) warnOnce(error);
  } finally {
    handle.close();
  }
}

/**
 * Whether the id still holds the session the stream opened on. Gone, or
 * deleted and created again (by anyone), it is another session, and the
 * connection ends: the client's reconnect is answered as any open is.
 */
async function stillTheSession(options: FollowOptions): Promise<boolean> {
  const current = await loadTenantSession(options.stores.session, options.sessionId, options.tenantId);
  return current !== undefined && isSameSession(options.session, current);
}

/** Failure kinds already logged, so a store outage costs one line, not one per read. */
const loggedFailures = new Set<string>();

/** Log a failed read the first time its kind (error name and code) is seen. */
function warnOnce(error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  const kind = code === undefined ? name : `${name}:${String(code)}`;
  if (loggedFailures.has(kind)) return;
  loggedFailures.add(kind);
  console.warn(
    "[flow-state] a session stream read failed; the connection ends and the client reconnects. Later failures of this kind are not logged.",
    error
  );
}

/**
 * The finished items to consider on this read: everything the session's
 * unfinished requests hold, plus everything the requests updated since `floor`
 * hold. Each request's items keep their log order; the order across requests
 * is not defined (the client orders what it shows). Already-sent items are the
 * caller's to skip.
 */
async function readFinishedItems(
  options: FollowOptions,
  floor: number
): Promise<Array<{ requestId: string; item: OutputItem }>> {
  const { stores, sessionId, tenantId } = options;
  const records = new Map<string, RequestRecord>();
  // The snapshot's own filter: the bare session id, and the session's tenant,
  // owner and organization, every key present.
  const scope = sessionRequestScope(sessionId, options.session, tenantId);

  const unfinished = await stores.request.list({
    ...scope,
    status: UNFINISHED_REQUEST_STATUSES,
    orderBy: "none",
    withItems: true
  });
  for (const record of unfinished) records.set(record.id, record);

  await forEachUpdatedSince(
    floor,
    (limit) => stores.request.list({ ...scope, orderBy: "updatedAt", limit }),
    async (record) => {
      if (records.has(record.id)) return;
      // Adapters that keep items apart from the record leave them off a list
      // read without `withItems`; read the few updated since the floor whole.
      const whole = record.items !== undefined ? record : await stores.request.get(record.id);
      if (whole !== undefined) records.set(whole.id, whole);
    }
  );

  const found: Array<{ requestId: string; item: OutputItem }> = [];
  for (const record of records.values()) {
    for (const item of snapshotItemsOf(record.items, options.itemTypes)) {
      if (item.status === "in_progress") continue;
      found.push({ requestId: record.id, item });
    }
  }
  return found;
}

/**
 * The session's unfinished runs, kept current by reading only what can have
 * changed: runs whose update time moved since the floor, and runs already
 * known to be unfinished.
 */
class RunTracker {
  private readonly open = new Map<string, SessionRun>();

  constructor(private readonly options: FollowOptions) {}

  /** The unfinished runs, newest first. */
  list(): SessionRun[] {
    return [...this.open.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Read every run under the session once, and keep the unfinished ones.
   *
   * One read, never pages at an offset. A run deleted between two pages shifts
   * the run after it onto the page already read, and an unfinished run skipped
   * that way is found by no later read: its update time is old, and it is not
   * yet known to be unfinished.
   */
  async readAll(): Promise<void> {
    const { stores, sessionId, identity } = this.options;
    const children = await stores.session.list({
      parentage: { parentOf: sessionId },
      orderBy: "createdAt",
      ...identity
    });
    for (const child of children) await this.check(child);
  }

  /**
   * Check the runs that moved since `floor` and the runs known to be
   * unfinished. Returns whether the unfinished set changed.
   */
  async refresh(floor: number): Promise<boolean> {
    const { stores, sessionId, identity } = this.options;
    const before = new Set(this.open.keys());
    const checked = new Set<string>();

    await forEachUpdatedSince(
      floor,
      (limit) =>
        stores.session.list({
          parentage: { parentOf: sessionId },
          orderBy: "updatedAt",
          limit,
          ...identity
        }),
      async (child) => {
        checked.add(await this.check(child));
      }
    );

    for (const run of [...this.open.values()]) {
      if (checked.has(run.id)) continue;
      const status = await resolveDispatchRunStatus(stores.request, run.id, identity);
      if (status !== "active") this.open.delete(run.id);
    }

    if (before.size !== this.open.size) return true;
    for (const id of this.open.keys()) if (!before.has(id)) return true;
    return false;
  }

  /** Resolve one run's status and record it. Returns the run's bare id. */
  private async check(child: SessionRecord): Promise<string> {
    const { stores, tenantId, identity } = this.options;
    const id = toBareSessionId(child.id, tenantId);
    const status = await resolveDispatchRunStatus(stores.request, id, identity);
    if (status === "active") this.open.set(id, toSessionRun(child, id, this.options.sessionId));
    else this.open.delete(id);
    return id;
  }
}

/** One unfinished run as a notice names it: a background-work row, less its status. */
function toSessionRun(child: SessionRecord, id: string, parentSessionId: string): SessionRun {
  return {
    id,
    parentSessionId,
    createdAt: child.createdAt,
    updatedAt: child.updatedAt,
    ...(child.flowId != null ? { flowId: child.flowId } : {}),
    ...readChildSessionLabels(child)
  };
}

/**
 * Visit every row updated since `floor`, newest first.
 *
 * The rows come from one read that starts at the newest, never from pages at
 * an offset. An update time changes while a scan runs: a write moves a row up,
 * a server whose clock runs behind can move one down, a delete removes one.
 * Between two pages, a row moving down past the boundary or leaving shifts the
 * row after it onto the page already read, and a row left unchanged is never
 * visited. `read` asks for the newest `limit` rows. When every row it returns
 * is newer than `floor`, the window may hold more, so it reads again from the
 * newest with twice the limit. The cost follows what changed since the floor,
 * never the history.
 */
async function forEachUpdatedSince<T extends { updatedAt: number }>(
  floor: number,
  read: (limit: number) => Promise<T[]>,
  visit: (row: T) => Promise<void>
): Promise<void> {
  for (let limit = RECENT_READ_LIMIT; ; limit *= 2) {
    const rows = await read(limit);
    const oldest = rows[rows.length - 1];
    if (rows.length === limit && oldest !== undefined && oldest.updatedAt >= floor) continue;
    for (const row of rows) {
      if (row.updatedAt < floor) return;
      await visit(row);
    }
    return;
  }
}
