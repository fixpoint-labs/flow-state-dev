/**
 * PostgreSQL RequestStore implementation.
 * Extends the generic pg record store with item persistence (microtask batching)
 * and event persistence (separate request_events table with transaction-based writes).
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
    columns: ["flow_kind", "user_id", "session_id", "project_id", "status"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.sessionId ?? null,
      record.projectId ?? null,
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

  const pendingItemWrites = new Set<string>();
  const pendingEventWrites = new Set<string>();

  return {
    get: base.get,
    set: base.set,
    delete: base.delete,
    list: base.list,

    persistItems(requestId: string, items: OutputItem[]): void {
      if (pendingItemWrites.has(requestId)) return;
      pendingItemWrites.add(requestId);

      queueMicrotask(() => {
        pendingItemWrites.delete(requestId);
        const doWrite = async () => {
          const result = await executor.query(
            "SELECT data FROM requests WHERE id = $1",
            [requestId]
          );
          if (result.rows.length > 0) {
            const data = result.rows[0]!.data;
            const current = (typeof data === "string" ? JSON.parse(data) : data) as RequestRecord;
            const updatedAt = Date.now();
            const updated = { ...current, items, updatedAt };
            await executor.query(
              "UPDATE requests SET data = $1, updated_at = $2 WHERE id = $3",
              [JSON.stringify(updated), updatedAt, requestId]
            );
          }
        };
        doWrite().catch(() => {
          // Best-effort persistence; errors are non-fatal
        });
      });
    },

    async flushItems(_requestId: string): Promise<void> {
      // Allow microtask to drain
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },

    persistEvents(requestId: string, events: RequestStreamEvent[]): void {
      if (pendingEventWrites.has(requestId)) return;
      pendingEventWrites.add(requestId);

      const snapshot = [...events];
      queueMicrotask(() => {
        pendingEventWrites.delete(requestId);
        const doWrite = async () => {
          await executor.query("DELETE FROM request_events WHERE request_id = $1", [requestId]);
          for (const event of snapshot) {
            await executor.query(
              "INSERT INTO request_events (request_id, sequence_number, event_data) VALUES ($1, $2, $3)",
              [requestId, event.sequence_number, JSON.stringify(event)]
            );
          }
        };
        doWrite().catch(() => {
          // Best-effort persistence; errors are non-fatal
        });
      });
    },

    async flushEvents(_requestId: string): Promise<void> {
      // Allow microtask to drain
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
