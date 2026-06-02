/**
 * SQLite RequestStore implementation.
 *
 * Two persistence paths layer on top of the generic record store:
 * - items: microtask-coalesced, last-write-wins. One row per item in
 *   `request_items`, written via batched UPSERT keyed by
 *   `(request_id, item_id)`. Because better-sqlite3 is synchronous the
 *   coalescing microtask writes the latest snapshot in one transaction; no
 *   drain-loop or in-flight-promise barrier is needed.
 * - events: per-row INSERT INTO request_events.
 *
 * Live-tail subscriptions poll the durable event table so the package stays
 * independent of server runtime values.
 */
import type Database from "better-sqlite3";
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  ExpectedVersion,
  RequestListOptions,
  RequestRecord,
  RequestStatus,
  RequestStore,
  SetResult,
  SubscribeToEventsOptions
} from "@flow-state-dev/server";
import { createSQLiteRecordStore } from "./sqlite-store";

/**
 * SQLite has no B-tree index row-size limit as tight as Postgres, but we cap
 * item IDs at the same bound the Postgres adapter uses so a request that
 * round-trips through either store behaves identically. The error is raised
 * application-side before any SQL runs.
 */
const MAX_ITEM_ID_LENGTH = 2600;

/**
 * Whether a request status is past the in-flight phase. Mirrors the server
 * helper of the same name, defined locally so this package keeps a TYPE-ONLY
 * dependency on `@flow-state-dev/server` (enforced by
 * `scripts/validate-package-boundaries.mjs`); importing the runtime helper
 * would couple the SQLite store to server runtime values.
 */
function isTerminalRequestStatus(status: RequestStatus | undefined): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "incomplete" ||
    status === "interrupted" ||
    status === "aborted" ||
    status === "suspended"
  );
}

/**
 * SQLite's compile-time parameter limit (SQLITE_MAX_VARIABLE_NUMBER) is 32766
 * on modern builds. `list({ withItems: true })` chunks the request-id IN-list
 * below this so a large page never overflows the bind limit.
 */
const SQLITE_MAX_VARIABLE_NUMBER = 32766;

/**
 * Merge per-row `request_items` with any legacy `data.items` slice that
 * predates the dedicated-table migration. Table version wins on item-id
 * collision; output is sorted by `itemIndex`.
 */
function mergeLegacyWithTable(
  fromTable: OutputItem[],
  legacy: OutputItem[] | undefined
): OutputItem[] {
  if (!Array.isArray(legacy) || legacy.length === 0) return fromTable;
  const seen = new Set(fromTable.map((i) => i.id));
  const legacyOnly = legacy.filter((i) => !seen.has(i.id));
  if (legacyOnly.length === 0) return fromTable;
  return [...fromTable, ...legacyOnly].sort((a, b) => a.itemIndex - b.itemIndex);
}

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
    },
    // `started_at` is not a column — startedAtMs lives in the record blob and
    // equals `created_at` (set together at creation, never mutated). Order by
    // created_at to honor `orderBy: "startedAtMs"`.
    resolveOrderBy: (listOptions) =>
      listOptions?.orderBy === "startedAtMs" ? "created_at DESC" : "updated_at DESC"
  });

  /** Set membership marks a request with a queued (synchronous) item flush. */
  const pendingItemWrites = new Set<string>();
  /** Holds the most recent items so the queued write always uses the latest data. */
  const latestItemSnapshots = new Map<string, OutputItem[]>();
  /**
   * Per-request map of the item references last persisted to `request_items`.
   * The emitter swaps the item reference on each item-boundary update, so
   * reference inequality catches every boundary change while skipping
   * unchanged items — the diff that makes persistence incremental.
   */
  const lastPersistedItems = new Map<string, Map<string, OutputItem>>();
  const pendingEventWrites = new Set<string>();

  const insertItemStmt = db.prepare(
    "INSERT INTO request_items (request_id, item_id, sequence, item_type, data) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (request_id, item_id) DO UPDATE SET " +
      "sequence = excluded.sequence, item_type = excluded.item_type, data = excluded.data"
  );
  const writeItemsBatchTxn = db.transaction(
    (batch: OutputItem[], requestId: string) => {
      for (const item of batch) {
        insertItemStmt.run(
          requestId,
          item.id,
          item.itemIndex,
          item.type,
          JSON.stringify(item)
        );
      }
    }
  );
  const selectItemsStmt = db.prepare(
    "SELECT data FROM request_items WHERE request_id = ? ORDER BY sequence ASC"
  );
  const deleteItemsStmt = db.prepare(
    "DELETE FROM request_items WHERE request_id = ?"
  );

  const insertEventStmt = db.prepare(
    "INSERT OR REPLACE INTO request_events (request_id, sequence_number, event_data) VALUES (?, ?, ?)"
  );
  const selectRunOnceStmt = db.prepare(
    "SELECT value FROM request_runonce WHERE request_id = ? AND key = ?"
  );
  const insertRunOnceStmt = db.prepare(
    "INSERT OR REPLACE INTO request_runonce (request_id, key, value) VALUES (?, ?, ?)"
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

  /** Read all persisted items for a request, ordered by sequence. */
  function queryItems(requestId: string): OutputItem[] {
    const rows = selectItemsStmt.all(requestId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as OutputItem);
  }

  /** Forget the per-request item-tracking state (terminal write / delete). */
  function clearItemMaps(id: string): void {
    lastPersistedItems.delete(id);
    latestItemSnapshots.delete(id);
  }

  return {
    async get(id: string): Promise<RequestRecord | undefined> {
      const base_ = await base.get(id);
      if (base_ === undefined) return undefined;
      const record = withSourceDefault(base_) as RequestRecord;
      return {
        ...record,
        items: mergeLegacyWithTable(queryItems(id), record.items)
      };
    },

    async set(
      id: string,
      value: RequestRecord,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<RequestRecord>> {
      // Items live in `request_items`; keep them out of `requests.data` to
      // avoid double-storage. better-sqlite3 is synchronous so any queued
      // item write for this request has already flushed within its
      // microtask before this async method body runs — no drain needed.
      const { items: _omitted, ...withoutItems } = value;
      const result = await base.set(
        id,
        withoutItems as RequestRecord,
        expectedVersion
      );
      if (result.ok && isTerminalRequestStatus(value.status)) {
        clearItemMaps(id);
      }
      return result;
    },

    patchField: base.patchField,
    incField: base.incField,
    pushToArray: base.pushToArray,

    async delete(id: string): Promise<void> {
      // Clear the tracking maps FIRST. A `persistItems` microtask queued
      // before this call drains on the next await below; discarding its
      // snapshot here makes that microtask a no-op so it can't re-insert
      // rows after the DELETE. (better-sqlite3 is synchronous, so there is
      // no in-flight async write to await — only the queued microtask.)
      clearItemMaps(id);
      deleteItemsStmt.run(id);
      await base.delete(id);
    },

    async list(options?: RequestListOptions): Promise<RequestRecord[]> {
      const records = await base.list(options);
      const withSource = records.map((r) => withSourceDefault(r) as RequestRecord);

      if (options?.withItems !== true) {
        // Default: do NOT query request_items. Strip any legacy blob items so
        // list payloads stay lean (callers opt in with `withItems: true`).
        return withSource.map((r) =>
          r.items === undefined ? r : { ...r, items: undefined }
        );
      }

      if (withSource.length === 0) return withSource;

      const requestIds = withSource.map((r) => r.id);
      const byRequestId = new Map<string, OutputItem[]>();
      for (let i = 0; i < requestIds.length; i += SQLITE_MAX_VARIABLE_NUMBER) {
        const chunk = requestIds.slice(i, i + SQLITE_MAX_VARIABLE_NUMBER);
        const placeholders = chunk.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT request_id, data FROM request_items ` +
              `WHERE request_id IN (${placeholders}) ` +
              `ORDER BY request_id, sequence ASC`
          )
          .all(...chunk) as Array<{ request_id: string; data: string }>;
        for (const r of rows) {
          const list = byRequestId.get(r.request_id) ?? [];
          list.push(JSON.parse(r.data) as OutputItem);
          byRequestId.set(r.request_id, list);
        }
      }

      return withSource.map((r) => ({
        ...r,
        items: mergeLegacyWithTable(byRequestId.get(r.id) ?? [], r.items)
      }));
    },

    persistItems(requestId: string, items: OutputItem[]): void {
      // Validate synchronously, before scheduling the coalesced write. A throw
      // from inside the queueMicrotask callback would escape as an
      // uncaughtException (crashing the process) rather than failing the
      // caller; validating here surfaces the error to ResponseEmitter cleanly.
      for (const item of items) {
        if (item.id.length > MAX_ITEM_ID_LENGTH) {
          throw new Error(
            `request_items: item.id length ${item.id.length} exceeds limit ` +
              `${MAX_ITEM_ID_LENGTH}. Item ID prefix: ${item.id.slice(0, 64)}...`
          );
        }
      }

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

        // Diff against the last persisted references: only items whose
        // reference changed need an UPSERT. This is what keeps writes
        // proportional to new/changed items rather than the whole snapshot.
        const priorById = lastPersistedItems.get(requestId);
        const delta: OutputItem[] = [];
        for (const item of snapshot) {
          if (priorById?.get(item.id) !== item) delta.push(item);
        }
        if (delta.length > 0) {
          // De-dup by id and sort for deterministic write ordering.
          const byId = new Map<string, OutputItem>();
          for (const item of delta) byId.set(item.id, item);
          const batch = [...byId.values()].sort((a, b) =>
            a.id.localeCompare(b.id)
          );
          writeItemsBatchTxn(batch, requestId);
        }

        const next = new Map<string, OutputItem>();
        for (const item of snapshot) next.set(item.id, item);
        lastPersistedItems.set(requestId, next);
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
    },

    async getRunOnceResult(
      requestId: string,
      key: string
    ): Promise<{ found: boolean; value?: unknown }> {
      const row = selectRunOnceStmt.get(requestId, key) as
        | { value: string }
        | undefined;
      if (row === undefined) return { found: false };
      return { found: true, value: JSON.parse(row.value) as unknown };
    },

    async setRunOnceResult(
      requestId: string,
      key: string,
      value: unknown
    ): Promise<void> {
      insertRunOnceStmt.run(requestId, key, JSON.stringify(value));
    }
  };
}
