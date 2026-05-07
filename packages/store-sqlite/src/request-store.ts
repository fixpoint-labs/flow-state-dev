/**
 * SQLite RequestStore implementation.
 *
 * Persists request records, coalesced item snapshots, and per-request stream
 * events. Live-tail subscriptions poll the durable event table so the package
 * stays independent of server runtime values.
 */
import type Database from "better-sqlite3";
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  RequestListOptions,
  RequestRecord,
  RequestStore,
  SubscribeToEventsOptions
} from "@flow-state-dev/server";
import { createSQLiteRecordStore } from "./sqlite-store";

const DEFAULT_LIVENESS_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

type ReadEventsFn = (
  requestId: string,
  fromSequence?: number
) => Promise<RequestStreamEvent[]>;

/** Whether an event marks the end of a request event stream. */
function isTerminalRequestStreamEvent(event: RequestStreamEvent): boolean {
  switch (event.type) {
    case "request.completed":
    case "request.failed":
    case "request.aborted":
    case "request.incomplete":
      return true;
    case "request.interrupted":
      return (event as { status?: string }).status === "interrupted";
    default:
      return false;
  }
}

/** Build a non-persisted liveness-timeout event for stalled subscriptions. */
function synthesizeRequestInterrupted(
  requestId: string,
  sequenceNumber: number
): RequestStreamEvent {
  return {
    stream: "request",
    type: "request.interrupted",
    status: "interrupted",
    requestId,
    sequence_number: sequenceNumber,
    ts: Date.now()
  } as RequestStreamEvent;
}

/** Abort-aware sleep used by the polling subscription loop. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Poll durable request events until aborted, terminal, or liveness timeout.
 *
 * This mirrors the server helper without importing server runtime values; the
 * SQLite package may only import server types.
 */
async function* pollEvents(
  readEvents: ReadEventsFn,
  requestId: string,
  options: SubscribeToEventsOptions,
  pollIntervalMs: number
): AsyncIterableIterator<RequestStreamEvent> {
  const livenessMs = options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;

  const initial = await readEvents(requestId, options.fromSequence);
  let lastSeen = options.fromSequence;
  for (const event of initial) {
    yield event;
    lastSeen = event.sequence_number;
    if (isTerminalRequestStreamEvent(event)) return;
  }

  let lastTickAt = Date.now();

  while (!options.signal?.aborted) {
    await abortableSleep(pollIntervalMs, options.signal);
    if (options.signal?.aborted) return;

    const next = await readEvents(requestId, lastSeen);
    if (next.length > 0) {
      lastTickAt = Date.now();
      for (const event of next) {
        yield event;
        lastSeen = event.sequence_number;
        if (isTerminalRequestStreamEvent(event)) return;
      }
    } else if (Date.now() - lastTickAt > livenessMs) {
      yield synthesizeRequestInterrupted(requestId, lastSeen ?? 0);
      return;
    }
  }
}

/** Options for the SQLite-backed request store. */
export type CreateSQLiteRequestStoreOptions = {
  /**
   * Poll interval for `subscribeToEvents` in milliseconds. Default 100ms.
   * Lower values reduce live-tail latency at the cost of read load on the
   * `request_events` table.
   */
  subscribePollIntervalMs?: number;
};

/**
 * Backfill `source` on records persisted before FIX-438 added the field.
 * Records written by the new code path always carry it.
 */
function withSourceDefault(record: RequestRecord | undefined): RequestRecord | undefined {
  if (record === undefined) return undefined;
  if (typeof record.source === "string") return record;
  return { ...record, source: "http" };
}

/** Create a SQLite-backed RequestStore using the provided database handle. */
export function createSQLiteRequestStore(
  db: Database.Database,
  options: CreateSQLiteRequestStoreOptions = {}
): RequestStore {
  const pollIntervalMs = options.subscribePollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const base = createSQLiteRecordStore<RequestRecord, RequestListOptions>(db, {
    tableName: "requests",
    columns: ["flow_kind", "user_id", "session_id", "org_id", "status"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.sessionId ?? null,
      record.orgId ?? null,
      record.status
    ],
    toWhere: (options) => {
      const parts: string[] = [];
      const params: unknown[] = [];

      if (options?.flowKind !== undefined) {
        parts.push("flow_kind = ?");
        params.push(options.flowKind);
      }
      if (options?.sessionId !== undefined) {
        parts.push("session_id = ?");
        params.push(options.sessionId);
      }
      if (options?.userId !== undefined) {
        parts.push("user_id = ?");
        params.push(options.userId);
      }
      if (options?.status !== undefined) {
        parts.push("status = ?");
        params.push(options.status);
      }

      return { clause: parts.join(" AND "), params };
    }
  });

  const pendingItemWrites = new Set<string>();
  /** Holds the most recent items so the queued write always uses the latest data. */
  const latestItemSnapshots = new Map<string, OutputItem[]>();
  const pendingEventWrites = new Set<string>();

  const getStmt = db.prepare("SELECT data FROM requests WHERE id = ?");
  const updateItemsStmt = db.prepare(
    "UPDATE requests SET data = ?, updated_at = ? WHERE id = ?"
  );

  const insertEventStmt = db.prepare(
    "INSERT OR REPLACE INTO request_events (request_id, sequence_number, event_data) VALUES (?, ?, ?)"
  );
  const selectAllEventsStmt = db.prepare(
    "SELECT event_data FROM request_events WHERE request_id = ? ORDER BY sequence_number ASC"
  );
  const selectEventsAfterStmt = db.prepare(
    "SELECT event_data FROM request_events WHERE request_id = ? AND sequence_number > ? ORDER BY sequence_number ASC"
  );
  /** Accumulates new events between coalesced writes for incremental persistence. */
  const pendingNewEvents = new Map<string, RequestStreamEvent[]>();

  const insertEventsBatch = db.transaction(
    (events: RequestStreamEvent[], requestId: string) => {
      for (const event of events) {
        insertEventStmt.run(
          requestId,
          event.sequence_number,
          JSON.stringify(event)
        );
      }
    }
  );

  async function readEvents(
    requestId: string,
    fromSequence?: number
  ): Promise<RequestStreamEvent[]> {
    const rows =
      fromSequence === undefined
        ? (selectAllEventsStmt.all(requestId) as Array<{ event_data: string }>)
        : (selectEventsAfterStmt.all(requestId, fromSequence) as Array<{
            event_data: string;
          }>);
    return rows.map((row) => JSON.parse(row.event_data) as RequestStreamEvent);
  }

  return {
    async get(id: string): Promise<RequestRecord | undefined> {
      return withSourceDefault(await base.get(id));
    },
    set: base.set,
    delete: base.delete,
    async list(options?: RequestListOptions): Promise<RequestRecord[]> {
      const records = await base.list(options);
      return records.map((r) => withSourceDefault(r) as RequestRecord);
    },

    persistItems(requestId: string, items: OutputItem[]): void {
      // Always capture the latest snapshot so the queued write uses the most
      // recent items, even when subsequent calls are coalesced away.
      latestItemSnapshots.set(requestId, [...items]);

      if (pendingItemWrites.has(requestId)) return;
      pendingItemWrites.add(requestId);

      queueMicrotask(() => {
        pendingItemWrites.delete(requestId);
        const snapshot = latestItemSnapshots.get(requestId);
        latestItemSnapshots.delete(requestId);
        if (snapshot === undefined) return;

        const row = getStmt.get(requestId) as { data: string } | undefined;
        if (row !== undefined) {
          const current = JSON.parse(row.data) as RequestRecord;
          const updatedAt = Date.now();
          const updated = { ...current, items: snapshot, updatedAt };
          updateItemsStmt.run(JSON.stringify(updated), updatedAt, requestId);
        }
      });
    },

    async flushItems(_requestId: string): Promise<void> {
      // No-op: queueMicrotask writes complete before any await resumes
    },

    persistEvents(requestId: string, events: RequestStreamEvent[]): void {
      // Accumulate new events — the emitter now sends only incremental events.
      let pending = pendingNewEvents.get(requestId);
      if (pending === undefined) {
        pending = [];
        pendingNewEvents.set(requestId, pending);
      }
      pending.push(...events);

      if (pendingEventWrites.has(requestId)) return;
      pendingEventWrites.add(requestId);

      queueMicrotask(() => {
        pendingEventWrites.delete(requestId);
        const newEvents = pendingNewEvents.get(requestId) ?? [];
        pendingNewEvents.delete(requestId);
        if (newEvents.length === 0) return;
        // INSERT OR REPLACE handles duplicates by sequence_number.
        insertEventsBatch(newEvents, requestId);
      });
    },

    async flushEvents(_requestId: string): Promise<void> {
      // No-op: queueMicrotask writes complete before any await resumes
    },

    getEvents: readEvents,

    subscribeToEvents(
      requestId: string,
      options: SubscribeToEventsOptions
    ): AsyncIterableIterator<RequestStreamEvent> {
      return pollEvents(readEvents, requestId, options, pollIntervalMs);
    }
  };
}
