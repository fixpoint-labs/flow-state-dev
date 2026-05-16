/**
 * PostgreSQL RequestStore implementation.
 *
 * Two persistence paths layer on top of the generic record store:
 * - items: microtask-batched, last-write-wins, atomic jsonb_set merge.
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
  type ReadEventsFn,
  type RequestListOptions,
  type RequestRecord,
  type RequestStore,
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

  return {
    async get(id: string): Promise<RequestRecord | undefined> {
      return withSourceDefault(await base.get(id));
    },
    set: base.set,
    patchField: base.patchField,
    incField: base.incField,
    pushToArray: base.pushToArray,
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

      const writePromise = new Promise<void>((resolve) => {
        queueMicrotask(() => {
          const doWrite = async () => {
            try {
              const snapshot = latestItemSnapshots.get(requestId);
              latestItemSnapshots.delete(requestId);
              if (snapshot === undefined) return;

              // Atomic items-only merge using jsonb_set. The previous
              // SELECT-then-UPDATE pattern raced with concurrent state CAS
              // writes (`request.atomicState`): a state mutation that landed
              // between the SELECT and the UPDATE would be silently
              // overwritten because the UPDATE rewrote the entire `data`
              // column. jsonb_set targets only the `items` and `updatedAt`
              // sub-paths, so concurrent writes to other paths (e.g. `state`)
              // survive (FIX-447 regression).
              const updatedAt = Date.now();
              await executor.query(
                "UPDATE requests SET " +
                  "data = jsonb_set(jsonb_set(data, '{items}', $1::jsonb, true), '{updatedAt}', to_jsonb($2::bigint), true), " +
                  "updated_at = $2 " +
                  "WHERE id = $3",
                [JSON.stringify(snapshot), updatedAt, requestId]
              );
            } finally {
              pendingItemWrites.delete(requestId);
              resolve();
            }
          };
          doWrite();
        });
      });

      pendingItemWrites.set(requestId, writePromise);
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
