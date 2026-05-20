/**
 * PostgreSQL RequestStore implementation.
 *
 * Two persistence paths layer on top of the generic record store:
 * - items: microtask-batched, last-write-wins. Persisted to a dedicated
 *   `request_items` table (FIX-657), one row per item, written via batched
 *   UPSERT. Replaces the prior `jsonb_set(data, '{items}', ...)` shape which
 *   re-TOAST'd the entire `requests.data` column on every flush and amplified
 *   on-disk storage by ~78x under serverless-throttled autovacuum.
 * - events: per-row INSERT INTO request_events with `pg_notify('flow_events', ...)`
 *   inside the same transaction. The notify is suppressed on rollback —
 *   subscribers never see signals for events that aren't durable (FIX-569 §3.4).
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
  isTerminalRequestStreamEvent,
  pollEvents,
  synthesizeRequestInterrupted,
  StoreSubscriptionError,
  type ExpectedVersion,
  type ReadEventsFn,
  type RequestListOptions,
  type RequestRecord,
  type RequestStatus,
  type RequestStore,
  type SetResult,
  type SubscribeToEventsOptions
} from "@flow-state-dev/server";
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
 * Postgres B-tree index row size is ~2704 bytes. Keyed item IDs include
 * a user-provided key inside `item_component_keyed:${key}` (~22-byte
 * prefix). Reject items at the application layer with a clear error rather
 * than let Postgres surface `index row size … exceeds maximum`. The
 * practical user-key ceiling is ~2580 bytes; keys are normally short
 * (e.g. `task-board-meta`).
 */
const MAX_ITEM_ID_LENGTH = 2600;

function isTerminalStatus(status: RequestStatus | undefined): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "aborted" ||
    status === "interrupted" ||
    status === "incomplete"
  );
}

/**
 * Item rows are JSONB. `node-pg` and PGlite both auto-parse JSONB into
 * JS values on read, but bypass paths (raw injection, future drivers)
 * may return the column as a string. Mirror the same shape the events
 * path uses for safety.
 */
function parseItemData(data: unknown): OutputItem {
  if (typeof data === "string") return JSON.parse(data) as OutputItem;
  return data as OutputItem;
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
    columns: ["flow_kind", "user_id", "session_id", "org_id", "status"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.sessionId ?? null,
      record.orgId ?? null,
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
      if (options?.status !== undefined) {
        parts.push(`status = $${p++}`);
        params.push(options.status);
      }

      return { clause: parts.join(" AND "), params };
    }
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
   * Per-request map of the item references that were last persisted to
   * `request_items`. ResponseEmitter creates a new reference on
   * emitItemAdded / emitItemUpdated / emitItemDone (`itemsById.set(id, merged)`),
   * so reference inequality catches every item-boundary update. `applyDelta`
   * mutates the inner text part in place — those token-rate updates
   * intentionally accumulate in the events log (which captures every delta)
   * rather than rewriting a row per keystroke; the items table is the
   * "state at item-boundary events" snapshot, not the replay journal.
   */
  const lastPersistedItems = new Map<string, Map<string, OutputItem>>();
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

  async function readItems(
    requestId: string,
    legacyItems: OutputItem[] | undefined
  ): Promise<OutputItem[]> {
    const { rows } = await executor.query(
      "SELECT data FROM request_items WHERE request_id = $1 ORDER BY sequence ASC",
      [requestId]
    );
    const fromTable = rows.map((r) => parseItemData(r.data));

    // Lazy migration: requests written before FIX-657 carry items in
    // `data.items`. The new table is authoritative — on collision the
    // table version wins. After the optional operator cleanup
    // (`UPDATE requests SET data = data - 'items'`) the legacy slice is
    // gone and this fallback is a no-op.
    if (!Array.isArray(legacyItems) || legacyItems.length === 0) return fromTable;

    const seenIds = new Set(fromTable.map((i) => i.id));
    const legacyOnly = legacyItems.filter((i) => !seenIds.has(i.id));
    if (legacyOnly.length === 0) return fromTable;

    return [...fromTable, ...legacyOnly].sort(
      (a, b) => a.itemIndex - b.itemIndex
    );
  }

  async function doFlushRequestItems(requestId: string): Promise<void> {
    const snapshot = latestItemSnapshots.get(requestId) ?? [];
    latestItemSnapshots.delete(requestId);

    const priorById = lastPersistedItems.get(requestId);
    const delta: OutputItem[] = [];
    for (const item of snapshot) {
      if (item.id.length > MAX_ITEM_ID_LENGTH) {
        throw new Error(
          `request_items: item.id length ${item.id.length} exceeds limit ${MAX_ITEM_ID_LENGTH} ` +
            `(Postgres B-tree index row size). Item ID prefix: ${item.id.slice(0, 64)}...`
        );
      }
      if (priorById?.get(item.id) !== item) delta.push(item);
    }
    if (delta.length > 0) {
      // De-dup defensively (itemsById is already keyed by ID, but ON CONFLICT
      // errors on duplicate keys in a single batch). Sort by item_id for
      // deterministic ON CONFLICT row ordering — guards against the documented
      // deadlock pattern when concurrent batches arrive in different orders,
      // even though in practice there's one writer per request.
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

    // Reconcile the per-request reference map with whatever state is
    // visible NOW. If a `persistItems` arrived during the await, that
    // snapshot is the latest; otherwise the snapshot we just persisted is.
    const post = latestItemSnapshots.get(requestId) ?? snapshot;
    const next = new Map<string, OutputItem>();
    for (const item of post) next.set(item.id, item);
    lastPersistedItems.set(requestId, next);
  }

  return {
    async get(id: string): Promise<RequestRecord | undefined> {
      const base_ = await base.get(id);
      if (base_ === undefined) return undefined;
      const record = withSourceDefault(base_) as RequestRecord;
      // `base.get` reads `requests.data` which (post-FIX-657) carries no
      // items slice for new requests; legacy and in-flight-at-deploy
      // records may still have `data.items` populated, surfaced here as
      // `record.items`. `readItems` merges both sources, table-wins on
      // collision.
      const items = await readItems(id, record.items);
      return { ...record, items };
    },
    async set(
      id: string,
      value: RequestRecord,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<RequestRecord>> {
      // Strip `items` before JSONB serialization. Items are persisted via
      // `request_items`; carrying them in `requests.data` as well would
      // resurrect the FIX-657 bloat on every terminal set. The in-memory
      // record returned by `get` still has `items` populated (assembled
      // from the items table + legacy fallback above).
      const { items: _omitted, ...withoutItems } = value;
      const result = await base.set(
        id,
        withoutItems as RequestRecord,
        expectedVersion
      );
      if (result.ok && isTerminalStatus(value.status)) {
        // Release the reference map for the request. A subsequent stray
        // `persistItems` (which the framework should not issue post-terminal)
        // would treat all items as new and re-UPSERT them idempotently —
        // not a correctness issue, just an extra round-trip.
        lastPersistedItems.delete(id);
      }
      return result;
    },
    patchField: base.patchField,
    incField: base.incField,
    pushToArray: base.pushToArray,
    async delete(id: string): Promise<void> {
      // Await any pending flush first — otherwise a queued microtask could
      // re-insert rows after the DELETE.
      const pending = pendingItemWrites.get(id);
      if (pending) await pending;
      await executor.query("DELETE FROM request_items WHERE request_id = $1", [id]);
      await base.delete(id);
      lastPersistedItems.delete(id);
      latestItemSnapshots.delete(id);
    },
    async list(options?: RequestListOptions): Promise<RequestRecord[]> {
      const records = await base.list(options);
      const withSource = records.map((r) => withSourceDefault(r) as RequestRecord);

      if (options?.withItems !== true) {
        // Strip any legacy `data.items` from results so the wire shape is
        // consistent across mixed-state requests.
        return withSource.map((r) => {
          if (r.items === undefined) return r;
          return { ...r, items: undefined };
        });
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

      return withSource.map((r) => {
        const fromTable = byRequestId.get(r.id) ?? [];
        const legacy = r.items;
        if (!Array.isArray(legacy) || legacy.length === 0) {
          return { ...r, items: fromTable };
        }
        const seen = new Set(fromTable.map((i) => i.id));
        const legacyOnly = legacy.filter((i) => !seen.has(i.id));
        const merged = [...fromTable, ...legacyOnly].sort(
          (a, b) => a.itemIndex - b.itemIndex
        );
        return { ...r, items: merged };
      });
    },

    persistItems(requestId: string, items: OutputItem[]): void {
      // Always capture the latest snapshot so the queued write uses the most
      // recent items, even when subsequent calls are coalesced away.
      latestItemSnapshots.set(requestId, [...items]);

      if (pendingItemWrites.has(requestId)) return;

      // Wrap the microtask + flush in a single promise that also clears
      // the in-flight map entry on settle. The cleanup is on the same
      // chain as the stored promise — a caller awaiting `flushItems`
      // sees the rejection (so it can be handled), and there's no
      // dangling `.finally` to surface as an unhandled rejection.
      const writePromise = (async () => {
        try {
          await new Promise<void>((r) => queueMicrotask(r));
          await doFlushRequestItems(requestId);
        } finally {
          pendingItemWrites.delete(requestId);
        }
      })();
      pendingItemWrites.set(requestId, writePromise);
      // Suppress unhandled-rejection warnings for fire-and-forget
      // `persistItems` callers. A caller that awaits `flushItems` still
      // observes the rejection through the stored promise; this attached
      // no-op handler simply marks it as handled to avoid the process-
      // level warning when nothing is awaiting the flush.
      writePromise.catch(() => {});
    },

    async flushItems(requestId: string): Promise<void> {
      const pending = pendingItemWrites.get(requestId);
      if (pending) await pending;
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
    if (isTerminalRequestStreamEvent(event)) return;
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
        if (isTerminalRequestStreamEvent(event)) return;
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
              if (isTerminalRequestStreamEvent(event)) return;
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
