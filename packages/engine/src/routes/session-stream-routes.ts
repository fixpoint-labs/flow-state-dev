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
 *   without moving the request's update time on most adapters), plus its
 *   requests newest-updated first, read until one is older than the floor.
 *   A request's finishing write follows its items and moves its update time,
 *   so the two reads miss nothing. The floor trails each read's start by a few
 *   seconds, which covers other servers' clocks, write latency and rows that
 *   move while paging; a repeat costs one set lookup.
 * - **Runs.** Every run under the session is read once when the stream opens.
 *   After that, only runs whose update time moved since the floor (a run moves
 *   when it starts) and runs already known to be unfinished are checked.
 *
 * Each read costs what is running now, never the session's whole history.
 * Items go through the session snapshot's own filter (`snapshotItemsOf`), and
 * each is sent once per connection, keyed by request id and item id together:
 * a keyed item repeats its id across requests.
 *
 * ## How it ends
 *
 * Every way out is quiet. The loop stops with its connection. A failed read
 * ends the connection, and the client reconnects with backoff. The server
 * closes the connection after at most 15 minutes, so access is checked again at
 * least that often; the client reconnects with the last `at` it heard as
 * `since`, and the server reads from a little before it. An event's `at` moves
 * to a read's start only once that read's items are all sent, so a connection
 * that drops midway through a read misses nothing on the next one.
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
  jsonResponse,
  loadTenantSession,
  refuseUnattributedRecord,
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

/** Rows per page when reading requests or runs newest-updated first. */
const RECENT_PAGE_SIZE = 20;

/** Rows per page when reading every run once, at open. */
const OPEN_PAGE_SIZE = 100;

type SessionStreamRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /** Tenant id from the request header; namespaces the session key. */
  tenantId?: string;
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
  if (session === undefined) {
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
  identity: ParentIdentity;
  itemTypes: ReadonlySet<string> | undefined;
  since: number | undefined;
  handle: SSEStreamHandle;
  signal: AbortSignal;
};

/** The loop behind one connection. Resolves when the connection ends. */
async function followSession(options: FollowOptions): Promise<void> {
  const { handle, signal, sessionId } = options;
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
    send({ stream: "session", sessionId, type: "session.runs", at: resumeAt, runs: runs.list() });

    while (!handle.closed && !signal.aborted) {
      const start = Date.now();
      if (start - openedAt >= timings.maxAgeMs) break;

      for (const { requestId, item } of await readFinishedItems(options, floor)) {
        const key = `${requestId}\u0000${item.id}`;
        if (sent.has(key)) continue;
        sent.add(key);
        send({ stream: "session", sessionId, type: "session.item", at: resumeAt, requestId, item });
      }
      resumeAt = start;

      if (await runs.refresh(floor)) {
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
    if (!handle.closed && !signal.aborted) warnOnce(error);
  } finally {
    handle.close();
  }
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

  // Snapshot's filters: the bare session id and the tenant key, always present.
  const unfinished = await stores.request.list({
    sessionId,
    tenantId,
    status: UNFINISHED_REQUEST_STATUSES,
    orderBy: "none",
    withItems: true
  });
  for (const record of unfinished) records.set(record.id, record);

  await forEachUpdatedSince(
    floor,
    (page) => stores.request.list({ sessionId, tenantId, orderBy: "updatedAt", ...page }),
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

  /** Read every run under the session once, and keep the unfinished ones. */
  async readAll(): Promise<void> {
    const { stores, sessionId, identity } = this.options;
    for (let offset = 0; ; offset += OPEN_PAGE_SIZE) {
      const page = await stores.session.list({
        parentage: { parentOf: sessionId },
        orderBy: "createdAt",
        limit: OPEN_PAGE_SIZE,
        offset,
        ...identity
      });
      for (const child of page) await this.check(child);
      if (page.length < OPEN_PAGE_SIZE) break;
    }
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
      (page) =>
        stores.session.list({
          parentage: { parentOf: sessionId },
          orderBy: "updatedAt",
          ...page,
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
 * Visit rows newest-updated first, a page at a time, until one is older than
 * `floor` or a page comes back short. `readPage` reads the page it is given.
 */
async function forEachUpdatedSince<T extends { updatedAt: number }>(
  floor: number,
  readPage: (page: { limit: number; offset: number }) => Promise<T[]>,
  visit: (row: T) => Promise<void>
): Promise<void> {
  for (let offset = 0; ; offset += RECENT_PAGE_SIZE) {
    const page = await readPage({ limit: RECENT_PAGE_SIZE, offset });
    for (const row of page) {
      if (row.updatedAt < floor) return;
      await visit(row);
    }
    if (page.length < RECENT_PAGE_SIZE) return;
  }
}
