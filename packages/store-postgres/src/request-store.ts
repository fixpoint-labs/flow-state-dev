/**
 * PostgreSQL RequestStore implementation.
 * Extends the generic pg record store with item persistence (microtask batching)
 * and event persistence (separate request_events table).
 */

import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  RequestListOptions,
  RequestRecord,
  RequestStore
} from "@flow-state-dev/server";
import type { QueryExecutor } from "./types";
import { createPgRecordStore } from "./pg-store";

export function createPostgresRequestStore(executor: QueryExecutor): RequestStore {
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

  return {
    get: base.get,
    set: base.set,
    delete: base.delete,
    list: base.list,

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

              const result = await executor.query(
                "SELECT data FROM requests WHERE id = $1",
                [requestId]
              );
              if (result.rows.length > 0) {
                const data = result.rows[0]!.data;
                const current = (typeof data === "string" ? JSON.parse(data) : data) as RequestRecord;
                const updatedAt = Date.now();
                const updated = { ...current, items: snapshot, updatedAt };
                await executor.query(
                  "UPDATE requests SET data = $1, updated_at = $2 WHERE id = $3",
                  [JSON.stringify(updated), updatedAt, requestId]
                );
              }
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
              // Insert only newly accumulated events. ON CONFLICT handles
              // duplicate sequence numbers from retries.
              for (const event of newEvents) {
                await executor.query(
                  "INSERT INTO request_events (request_id, sequence_number, event_data) VALUES ($1, $2, $3) ON CONFLICT (request_id, sequence_number) DO UPDATE SET event_data = $3",
                  [requestId, event.sequence_number, JSON.stringify(event)]
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

    async getEvents(requestId: string): Promise<RequestStreamEvent[]> {
      const result = await executor.query(
        "SELECT event_data FROM request_events WHERE request_id = $1 ORDER BY sequence_number ASC",
        [requestId]
      );
      return result.rows.map((row) => {
        const data = row.event_data;
        return (typeof data === "string" ? JSON.parse(data) : data) as RequestStreamEvent;
      });
    }
  };
}
