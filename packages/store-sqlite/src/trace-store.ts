/**
 * SQLite-backed trace event store with FIFO retention by request (FIX-506).
 *
 * Two tables:
 *   - `trace_events` holds the events themselves, keyed by
 *     `(request_id, sequence_number)`. Foreign-keyed onto
 *     `trace_request_roster` with `ON DELETE CASCADE` so retention deletes
 *     a single roster row and lets SQLite reap the events.
 *   - `trace_request_roster` records the insertion timestamp of the first
 *     event seen for each request, providing a stable FIFO ordering for
 *     `maxRequests` retention without scanning the events table.
 *
 * Retention runs on every append: after inserting the new event, if the
 * roster size exceeds `maxRequests`, delete the oldest roster rows. The
 * cascade clears their events.
 *
 * `flush` is a no-op — better-sqlite3 commits writes synchronously.
 */
import type Database from "better-sqlite3";
import type { TraceEvent, TraceStore } from "@flow-state-dev/server";

export type SQLiteTraceStoreOptions = {
  maxRequests?: number;
};

const DEFAULT_MAX_REQUESTS = 50;

export function createSQLiteTraceStore(
  db: Database.Database,
  options: SQLiteTraceStoreOptions = {}
): TraceStore {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;

  const upsertRosterStmt = db.prepare(
    `INSERT INTO trace_request_roster (request_id, inserted_at)
     VALUES (?, ?)
     ON CONFLICT(request_id) DO NOTHING`
  );
  const insertEventStmt = db.prepare(
    `INSERT INTO trace_events (request_id, sequence_number, ts, type, item)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(request_id, sequence_number) DO UPDATE SET
       ts = excluded.ts,
       type = excluded.type,
       item = excluded.item`
  );
  const rosterCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM trace_request_roster`);
  const evictOldestStmt = db.prepare(
    `DELETE FROM trace_request_roster WHERE request_id IN (
       SELECT request_id FROM trace_request_roster
       ORDER BY inserted_at ASC, request_id ASC
       LIMIT ?
     )`
  );
  const getEventsStmt = db.prepare(
    `SELECT ts, type, item, sequence_number FROM trace_events
     WHERE request_id = ? AND sequence_number > ?
     ORDER BY sequence_number ASC`
  );
  const listRequestsStmt = db.prepare(
    `SELECT request_id FROM trace_request_roster ORDER BY inserted_at ASC, request_id ASC`
  );

  const appendTx = db.transaction((requestId: string, event: TraceEvent) => {
    upsertRosterStmt.run(requestId, event.ts);
    insertEventStmt.run(
      requestId,
      event.sequenceNumber,
      event.ts,
      event.type,
      JSON.stringify(event.item)
    );
    const { n } = rosterCountStmt.get() as { n: number };
    if (n > maxRequests) {
      evictOldestStmt.run(n - maxRequests);
    }
  });

  return {
    async appendEvent(requestId: string, event: TraceEvent): Promise<void> {
      appendTx(requestId, event);
    },

    async flush(_requestId: string): Promise<void> {
      // No-op: better-sqlite3 commits writes synchronously.
    },

    async getEvents(requestId: string, fromSequence?: number): Promise<TraceEvent[]> {
      const cursor = fromSequence ?? -1;
      const rows = getEventsStmt.all(requestId, cursor) as Array<{
        ts: number;
        type: string;
        item: string;
        sequence_number: number;
      }>;
      return rows.map((row) => ({
        requestId,
        sequenceNumber: row.sequence_number,
        ts: row.ts,
        type: row.type as TraceEvent["type"],
        item: JSON.parse(row.item) as TraceEvent["item"]
      }));
    },

    async listRequestIds(): Promise<string[]> {
      const rows = listRequestsStmt.all() as Array<{ request_id: string }>;
      return rows.map((r) => r.request_id);
    }
  };
}
