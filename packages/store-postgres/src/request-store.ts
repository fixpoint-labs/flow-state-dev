/**
 * PostgreSQL RequestStore implementation.
 *
 * Two persistence paths layer on top of the generic record store:
 * - items: microtask-batched, last-write-wins. One row per item in
 *   `request_items`, written via batched UPSERT keyed by
 *   `(request_id, item_id)`.
 * - events: per-row INSERT INTO request_events with `pg_notify('flow_events', ...)`
 *   inside the same statement. The notify is suppressed on rollback so
 *   subscribers never see signals for events that aren't durable.
 *
 * `subscribeToEvents` consumes notifications via a dedicated `pg.Client`
 * checked out from `liveTailPool` and uses the dirty-bit Notifier Pattern:
 * one drain query per dirty cycle, regardless of NOTIFY volume. When
 * `liveTailPool` is absent (PGlite, raw QueryExecutor injection) it falls
 * back to polling on the same shape as SQLite.
 */

import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import {
  abortableSleep,
  endsRequestStream,
  isTerminalRequestStatus,
  pollEvents,
  synthesizeRequestInterrupted,
  StoreSubscriptionError,
  withStoredAbortRequested,
  type ConditionalRequestFields,
  type ConditionalWriteResult,
  type ExpectedVersion,
  type ReadEventsFn,
  type RequestListOptions,
  type RequestRecord,
  type RequestStatus,
  type RequestStore,
  type SetResult,
  type SubscribeToEventsOptions
} from "@flow-state-dev/engine";
import type { Pool, PoolClient } from "pg";
import type { QueryExecutor } from "./types";
import { createPgRecordStore } from "./pg-store";

const DEFAULT_LIVENESS_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const NOTIFY_CHANNEL = "flow_events";
const RECONNECT_BUDGET = 5;
const RECONNECT_BACKOFF_MIN_MS = 100;
const RECONNECT_BACKOFF_MAX_MS = 1_600;

/**
 * Postgres B-tree index row size is ~2704 bytes. Reject overlong item IDs
 * at the application layer with a clear error rather than let Postgres
 * surface `index row size … exceeds maximum`.
 */
const MAX_ITEM_ID_LENGTH = 2600;

/** `node-pg` and PGlite auto-parse JSONB; bypass paths may return strings. */
function parseItemData(data: unknown): OutputItem {
  if (typeof data === "string") return JSON.parse(data) as OutputItem;
  return data as OutputItem;
}

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

export type CreatePostgresRequestStoreOptions = {
  /**
   * Dedicated `pg.Pool` for `LISTEN flow_events` checkouts. Reusing the
   * main query pool would pin one connection per concurrent subscriber
   * and starve query traffic. Set to `null` to disable LISTEN entirely
   * and fall back to polling. Default: undefined (caller wires it via
   * `createPostgresStores`).
   */
  liveTailPool?: Pool | null;
  /**
   * Poll interval (ms) for the no-LISTEN fallback path used when
   * `liveTailPool` is absent (PGlite, raw QueryExecutor). Default 250ms.
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

export function createPostgresRequestStore(
  executor: QueryExecutor,
  options: CreatePostgresRequestStoreOptions = {}
): RequestStore {
  const liveTailPool = options.liveTailPool ?? null;
  const pollIntervalMs =
    options.subscribePollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const base = createPgRecordStore<RequestRecord, RequestListOptions>(executor, {
    tableName: "requests",
    // `abortRequested` is off `set`'s write surface (FIX-1026): the stored
    // value wins in both directions, enforced inside the UPDATE so a
    // concurrent `setFieldsIfStatus` cannot be overwritten by a full-record
    // write that read the row a moment earlier.
    preserveJsonKeys: ["abortRequested"],
    columns: ["flow_kind", "user_id", "session_id", "org_id", "tenant_id", "status"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.sessionId ?? null,
      record.orgId ?? null,
      record.tenantId ?? null,
      record.status
    ],
    toWhere: (options, nextParam = 1) => {
      const parts: string[] = [];
      const params: unknown[] = [];
      let p = nextParam;

      if (options?.flowKind !== undefined) {
        parts.push(`flow_kind = $${p++}`);
        params.push(options.flowKind);
      }
      if (options?.sessionId !== undefined) {
        parts.push(`session_id = $${p++}`);
        params.push(options.sessionId);
      }
      if (options?.userId !== undefined) {
        parts.push(`user_id = $${p++}`);
        params.push(options.userId);
      }
      // Tenant filter (FIX-682): present (incl. explicit undefined) → NULL-safe
      // exact match; absent → no filter. Isolates cross-turn history between
      // two tenants sharing a bare session id.
      if (options !== undefined && "tenantId" in options) {
        parts.push(`tenant_id IS NOT DISTINCT FROM $${p++}`);
        params.push(options.tenantId ?? null);
      }
      if (options?.status !== undefined) {
        parts.push(`status = $${p++}`);
        params.push(options.status);
      }

      return { clause: parts.join(" AND "), params };
    },
    // `started_at` is not a column — startedAtMs lives in the record blob and
    // equals `created_at` (set together at creation, never mutated). Order by
    // created_at to honor `orderBy: "startedAtMs"`.
    resolveOrderBy: (options) =>
      options?.orderBy === "startedAtMs" ? "created_at DESC" : "updated_at DESC"
  });

  /**
   * Track in-flight async write promises so flush can await them.
   * Unlike SQLite (synchronous writes), Postgres writes are async and
   * won't complete within the microtask that initiates them.
   */
  const pendingItemWrites = new Map<string, Promise<void>>();
  /** Holds the most recent items so the queued write always uses the latest data. */
  const latestItemSnapshots = new Map<string, OutputItem[]>();
  /**
   * Per-request map of item id → the JSON last persisted to `request_items`.
   * Diffing by serialized content (not object reference) keeps persistence
   * incremental while still catching in-place field mutations: the runtime
   * mutates a block_trace item in place across in_progress → completed (same
   * reference, new content), so a reference compare would drop the completed
   * write and leave the row in_progress, defeating resume memoization (FIX-839).
   * (`applyDelta`'s in-place text growth still rewrites the row at the store's
   * flush cadence, as before — the per-keystroke deltas live in the events log.)
   */
  const lastPersistedItems = new Map<string, Map<string, string>>();
  const pendingEventWrites = new Map<string, Promise<void>>();
  /** Accumulates new events between coalesced writes for incremental persistence. */
  const pendingNewEvents = new Map<string, RequestStreamEvent[]>();

  async function readEvents(
    requestId: string,
    fromSequence?: number
  ): Promise<RequestStreamEvent[]> {
    const result =
      fromSequence === undefined
        ? await executor.query(
            "SELECT event_data FROM request_events WHERE request_id = $1 ORDER BY sequence_number ASC",
            [requestId]
          )
        : await executor.query(
            "SELECT event_data FROM request_events WHERE request_id = $1 AND sequence_number > $2 ORDER BY sequence_number ASC",
            [requestId, fromSequence]
          );
    return result.rows.map((row) => {
      const data = row.event_data;
      return (typeof data === "string" ? JSON.parse(data) : data) as RequestStreamEvent;
    });
  }

  async function queryItems(requestId: string): Promise<OutputItem[]> {
    const { rows } = await executor.query(
      "SELECT data FROM request_items WHERE request_id = $1 ORDER BY sequence ASC",
      [requestId]
    );
    return rows.map((r) => parseItemData(r.data));
  }

  async function doFlushRequestItems(requestId: string): Promise<void> {
    // Drain loop: a `persistItems` call landing during the awaited UPSERT
    // below updates `latestItemSnapshots` but does not schedule a second
    // microtask (only one in-flight write per request). Looping here makes
    // `flushItems` a real barrier; without it the in-flight promise would
    // settle with the latest snapshot still pending.
    while (latestItemSnapshots.has(requestId)) {
      const snapshot = latestItemSnapshots.get(requestId) ?? [];
      latestItemSnapshots.delete(requestId);

      // Diff by serialized content, not object reference: the runtime mutates
      // a block_trace item in place across in_progress → completed (same
      // reference, new content), so a reference compare would drop the
      // completed write and leave the row in_progress, defeating resume
      // memoization (FIX-839).
      const priorById = lastPersistedItems.get(requestId);
      const nextById = new Map<string, string>();
      const delta: OutputItem[] = [];
      for (const item of snapshot) {
        if (item.id.length > MAX_ITEM_ID_LENGTH) {
          throw new Error(
            `request_items: item.id length ${item.id.length} exceeds limit ${MAX_ITEM_ID_LENGTH} ` +
              `(Postgres B-tree index row size). Item ID prefix: ${item.id.slice(0, 64)}...`
          );
        }
        const serialized = JSON.stringify(item);
        nextById.set(item.id, serialized);
        if (priorById?.get(item.id) !== serialized) delta.push(item);
      }
      if (delta.length > 0) {
        // De-dup by id (ON CONFLICT errors on duplicate keys in a single
        // batch). Sort by id for deterministic conflict-row ordering.
        const byId = new Map<string, OutputItem>();
        for (const item of delta) byId.set(item.id, item);
        const batch = [...byId.values()].sort((a, b) =>
          a.id.localeCompare(b.id)
        );

        await executor.query(
          "INSERT INTO request_items (request_id, item_id, sequence, item_type, data) " +
            "SELECT $1, item_id, sequence, item_type, data::jsonb FROM unnest(" +
            "$2::text[], $3::bigint[], $4::text[], $5::text[]" +
            ") AS t(item_id, sequence, item_type, data) " +
            "ON CONFLICT (request_id, item_id) DO UPDATE SET " +
            "sequence = EXCLUDED.sequence, " +
            "item_type = EXCLUDED.item_type, " +
            "data = EXCLUDED.data",
          [
            requestId,
            batch.map((i) => i.id),
            batch.map((i) => i.itemIndex),
            batch.map((i) => i.type),
            batch.map((i) => JSON.stringify(i))
          ]
        );
      }

      // Reconcile from what we actually persisted. If a newer snapshot
      // arrived during the await, the next loop iteration picks it up.
      lastPersistedItems.set(requestId, nextById);
    }
  }

  function clearItemMaps(id: string): void {
    lastPersistedItems.delete(id);
    latestItemSnapshots.delete(id);
  }

  return {
    async get(id: string): Promise<RequestRecord | undefined> {
      const [base_, fromTable] = await Promise.all([
        base.get(id),
        queryItems(id)
      ]);
      if (base_ === undefined) return undefined;
      const record = withSourceDefault(base_) as RequestRecord;
      return { ...record, items: mergeLegacyWithTable(fromTable, record.items) };
    },
    async set(
      id: string,
      value: RequestRecord,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<RequestRecord>> {
      // On terminal status, drain in-flight item writes first so the last
      // snapshot is durable AND so a late `doFlushRequestItems` can't
      // repopulate `lastPersistedItems` after this set clears it.
      if (isTerminalRequestStatus(value.status)) {
        const pending = pendingItemWrites.get(id);
        if (pending) await pending;
      }
      // Items live in `request_items`; keep them out of `requests.data` to
      // avoid double-storage.
      const { items: _omitted, ...withoutItems } = value;
      // Strip the abort flag before it is bound: `preserveJsonKeys` re-applies
      // the stored value on the UPDATE paths, and an INSERT has no stored row
      // to preserve, so a record carrying the flag must not create one.
      const result = await base.set(
        id,
        withStoredAbortRequested(withoutItems as RequestRecord, undefined),
        expectedVersion
      );
      if (result.ok && isTerminalRequestStatus(value.status)) {
        clearItemMaps(id);
      }
      return result;
    },

    async isAbortRequested(requestId: string): Promise<boolean> {
      // `data` is JSONB and items live in `request_items`, so this is a
      // primary-key lookup plus a key probe — O(1) in item count, as the
      // interface requires of every adapter.
      const result = await executor.query(
        "SELECT data -> 'abortRequested' AS flag FROM requests WHERE id = $1",
        [requestId]
      );
      const row = result.rows[0] as { flag: unknown } | undefined;
      return row?.flag === true;
    },

    async setFieldsIfStatus(
      id: string,
      fields: ConditionalRequestFields,
      allowedStatuses: readonly RequestStatus[],
      updatedAt: number
    ): Promise<ConditionalWriteResult> {
      // One statement: the status the predicate reads and the write it gates
      // are the same snapshot. A version CAS cannot stand in for this —
      // terminal transitions persist `version` unchanged, so a version-checked
      // write validates after a terminal commit and resurrects a dead record.
      const result = await executor.query(
        `WITH found AS (
           SELECT status FROM requests WHERE id = $1
         ), updated AS (
           UPDATE requests
              SET data = data || $2::jsonb, updated_at = $3
            WHERE id = $1 AND status = ANY($4::text[])
            RETURNING status
         )
         SELECT (SELECT status FROM found) AS found_status,
                EXISTS (SELECT 1 FROM updated) AS applied`,
        [id, JSON.stringify(fields), updatedAt, [...allowedStatuses]]
      );
      const row = result.rows[0] as
        | { found_status: RequestStatus | null; applied: boolean }
        | undefined;
      const status = row?.found_status ?? undefined;
      return { applied: row?.applied === true, status };
    },

    patchField: base.patchField,
    incField: base.incField,
    pushToArray: base.pushToArray,
    async delete(id: string): Promise<void> {
      // Drain pending flush first; otherwise a queued microtask could
      // re-insert rows after the DELETE.
      const pending = pendingItemWrites.get(id);
      if (pending) await pending;
      await Promise.all([
        executor.query("DELETE FROM request_items WHERE request_id = $1", [id]),
        base.delete(id)
      ]);
      clearItemMaps(id);
    },
    async list(options?: RequestListOptions): Promise<RequestRecord[]> {
      const records = await base.list(options);
      const withSource = records.map((r) => withSourceDefault(r) as RequestRecord);

      if (options?.withItems !== true) {
        return withSource.map((r) =>
          r.items === undefined ? r : { ...r, items: undefined }
        );
      }

      if (withSource.length === 0) return withSource;

      const requestIds = withSource.map((r) => r.id);
      const { rows } = await executor.query(
        "SELECT request_id, data FROM request_items " +
          "WHERE request_id = ANY($1::text[]) ORDER BY request_id, sequence ASC",
        [requestIds]
      );
      const byRequestId = new Map<string, OutputItem[]>();
      for (const r of rows) {
        const rid = r.request_id as string;
        const list = byRequestId.get(rid) ?? [];
        list.push(parseItemData(r.data));
        byRequestId.set(rid, list);
      }

      return withSource.map((r) => ({
        ...r,
        items: mergeLegacyWithTable(byRequestId.get(r.id) ?? [], r.items)
      }));
    },

    persistItems(requestId: string, items: OutputItem[]): void {
      // Always capture the latest snapshot so the queued write picks up
      // the freshest items even when intervening calls are coalesced.
      latestItemSnapshots.set(requestId, [...items]);

      if (pendingItemWrites.has(requestId)) return;

      const writePromise = (async () => {
        try {
          await new Promise<void>((r) => queueMicrotask(r));
          await doFlushRequestItems(requestId);
        } finally {
          pendingItemWrites.delete(requestId);
        }
      })();
      pendingItemWrites.set(requestId, writePromise);
      // Mark as handled so fire-and-forget callers don't trigger Node's
      // unhandled-rejection warning; a caller awaiting `flushItems` still
      // observes the rejection through the stored promise.
      writePromise.catch(() => {});
    },

    async flushItems(requestId: string): Promise<void> {
      const pending = pendingItemWrites.get(requestId);
      if (pending) await pending;
    },

    async countItems(requestId: string): Promise<number> {
      // Mirror the `get` dual-read (FIX-686): records persisted before the
      // child table existed may still carry blob items, and the table wins on
      // id collision. The common (post-migration) path is an indexed COUNT
      // plus one record-row read — item payloads are never loaded.
      const [countResult, record] = await Promise.all([
        executor.query(
          "SELECT COUNT(*)::int AS c FROM request_items WHERE request_id = $1",
          [requestId]
        ),
        base.get(requestId)
      ]);
      const tableCount = (countResult.rows[0] as { c: number }).c;
      const legacy = record?.items;
      if (!Array.isArray(legacy) || legacy.length === 0) return tableCount;
      const { rows } = await executor.query(
        "SELECT item_id FROM request_items WHERE request_id = $1",
        [requestId]
      );
      const tableIds = new Set(rows.map((row) => row.item_id as string));
      let count = tableIds.size;
      for (const item of legacy) {
        if (!tableIds.has(item.id)) count += 1;
      }
      return count;
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

      const writePromise = new Promise<void>((resolve) => {
        queueMicrotask(() => {
          const doWrite = async () => {
            try {
              const newEvents = pendingNewEvents.get(requestId) ?? [];
              pendingNewEvents.delete(requestId);
              // Each event row carries its own (request_id, sequence_number)
              // PK so duplicates from retries are handled by ON CONFLICT.
              // `pg_notify` runs in the same statement so it's elided on
              // rollback (OQ-4 inside-transaction): subscribers never see a
              // signal for an event that didn't make it to the table.
              for (const event of newEvents) {
                await executor.query(
                  "WITH inserted AS (" +
                    "INSERT INTO request_events (request_id, sequence_number, event_data) " +
                    "VALUES ($1, $2, $3) " +
                    "ON CONFLICT (request_id, sequence_number) DO UPDATE SET event_data = $3 " +
                    "RETURNING request_id, sequence_number" +
                  ") SELECT pg_notify($4, request_id || ':' || sequence_number) FROM inserted",
                  [
                    requestId,
                    event.sequence_number,
                    JSON.stringify(event),
                    NOTIFY_CHANNEL
                  ]
                );
              }
            } finally {
              pendingEventWrites.delete(requestId);
              resolve();
            }
          };
          doWrite();
        });
      });

      pendingEventWrites.set(requestId, writePromise);
    },

    async flushEvents(requestId: string): Promise<void> {
      const pending = pendingEventWrites.get(requestId);
      if (pending) await pending;
    },

    getEvents: readEvents,

    subscribeToEvents(
      requestId: string,
      options: SubscribeToEventsOptions
    ): AsyncIterableIterator<RequestStreamEvent> {
      if (liveTailPool !== null) {
        return subscribeViaListen(liveTailPool, readEvents, requestId, options);
      }
      // PGlite / raw `QueryExecutor`: poll on the same shape as SQLite.
      return pollEvents(readEvents, requestId, options, pollIntervalMs);
    },

    async getRunOnceResult(
      requestId: string,
      key: string
    ): Promise<{ found: boolean; value?: unknown }> {
      const result = await executor.query(
        "SELECT value FROM request_runonce WHERE request_id = $1 AND key = $2",
        [requestId, key]
      );
      const row = result.rows[0] as { value: unknown } | undefined;
      if (row === undefined) return { found: false };
      // node-pg and PGlite both auto-parse JSONB columns to JS values, so no
      // JSON.parse is needed here. (The events table stores TEXT and DOES
      // need parsing — different shape on purpose.)
      return { found: true, value: row.value };
    },

    async setRunOnceResult(
      requestId: string,
      key: string,
      value: unknown
    ): Promise<void> {
      await executor.query(
        "INSERT INTO request_runonce (request_id, key, value) VALUES ($1, $2, $3::jsonb) " +
          "ON CONFLICT (request_id, key) DO UPDATE SET value = EXCLUDED.value",
        [requestId, key, JSON.stringify(value)]
      );
    }
  };
}

/**
 * `LISTEN flow_events` subscription on a dedicated checkout from
 * `liveTailPool`. Implements the Notifier Pattern: NOTIFYs are signals
 * only; the dirty-bit promise is resolved on each notification, and the
 * drain loop reads `getEvents(id, lastSeen)` once per cycle so N
 * notifications collapse into one query.
 *
 * Reconnection budget: 5 attempts with exponential backoff (100ms →
 * 1.6s). Exhaustion yields `StoreSubscriptionError("listen_unrecoverable")`.
 */
async function* subscribeViaListen(
  pool: Pool,
  readEvents: ReadEventsFn,
  requestId: string,
  options: SubscribeToEventsOptions
): AsyncIterableIterator<RequestStreamEvent> {
  const livenessMs = options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;

  const initial = await readEvents(requestId, options.fromSequence);
  let lastSeen = options.fromSequence;
  for (const event of initial) {
    yield event;
    lastSeen = event.sequence_number;
    if (endsRequestStream(event, options)) return;
  }

  let attempt = 0;
  let lastTickAt = Date.now();

  while (!options.signal?.aborted) {
    let client: PoolClient | undefined;
    let dirty = false;
    let dirtyResolve: (() => void) | undefined;
    let connectionFailed = false;

    const onNotification = (msg: { channel: string; payload?: string }): void => {
      if (msg.channel !== NOTIFY_CHANNEL) return;
      if (msg.payload === undefined) return;
      const colon = msg.payload.indexOf(":");
      const id = colon === -1 ? msg.payload : msg.payload.slice(0, colon);
      if (id !== requestId) return;
      dirty = true;
      const resolve = dirtyResolve;
      dirtyResolve = undefined;
      resolve?.();
    };

    const onClientError = (): void => {
      connectionFailed = true;
      const resolve = dirtyResolve;
      dirtyResolve = undefined;
      resolve?.();
    };

    try {
      client = await pool.connect();
      client.on("notification", onNotification);
      client.on("error", onClientError);
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      attempt = 0;

      // Drain anything persisted between the catch-up SELECT and LISTEN setup.
      const gap = await readEvents(requestId, lastSeen);
      for (const event of gap) {
        yield event;
        lastSeen = event.sequence_number;
        if (endsRequestStream(event, options)) return;
      }
      if (gap.length > 0) lastTickAt = Date.now();

      while (!options.signal?.aborted && !connectionFailed) {
        // Wait for dirty-bit OR liveness timeout — whichever comes first.
        // The timer and abort listener are torn down on every wakeup path
        // so they don't accumulate across cycles on a long-lived
        // subscription.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted || dirty || connectionFailed) {
            resolve();
            return;
          }
          dirtyResolve = resolve;
          onAbort = resolve;
          options.signal?.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(resolve, livenessMs);
          timer.unref();
        });
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort !== undefined) {
          options.signal?.removeEventListener("abort", onAbort);
        }
        dirtyResolve = undefined;

        if (options.signal?.aborted) return;
        if (connectionFailed) break;

        if (dirty) {
          dirty = false;
          const next = await readEvents(requestId, lastSeen);
          if (next.length > 0) {
            lastTickAt = Date.now();
            for (const event of next) {
              yield event;
              lastSeen = event.sequence_number;
              if (endsRequestStream(event, options)) return;
            }
          }
        } else if (Date.now() - lastTickAt > livenessMs) {
          yield synthesizeRequestInterrupted(requestId, lastSeen ?? 0);
          return;
        }
      }
    } catch {
      connectionFailed = true;
    } finally {
      if (client !== undefined) {
        try {
          client.removeListener("notification", onNotification);
          client.removeListener("error", onClientError);
          if (!connectionFailed) {
            await client.query(`UNLISTEN ${NOTIFY_CHANNEL}`).catch(() => {});
          }
        } catch {
          // Best-effort cleanup. The release call below decides whether the
          // client returns to the pool clean or is discarded.
        }
        // Pass `true` for a broken connection so `pg` discards it instead of
        // returning a half-dead client to the pool.
        client.release(connectionFailed ? true : undefined);
      }
    }

    if (options.signal?.aborted) return;

    // Connection dropped or LISTEN setup failed — try to reconnect within budget.
    attempt += 1;
    if (attempt > RECONNECT_BUDGET) {
      throw new StoreSubscriptionError(
        "listen_unrecoverable",
        `Postgres LISTEN connection unrecoverable after ${RECONNECT_BUDGET} attempts`
      );
    }
    const backoff = Math.min(
      RECONNECT_BACKOFF_MIN_MS * 2 ** (attempt - 1),
      RECONNECT_BACKOFF_MAX_MS
    );
    await abortableSleep(backoff, options.signal);
  }
}
