/**
 * PostgreSQL-backed wake store (FIX-2078 D1): a debt's due time, kept until a
 * pass in its session clears it.
 *
 * One row per (tenant, session, entry). `owe` is one upsert that keeps the
 * earlier due time and the later `land_by` and bumps the version: a
 * concurrent upsert on the same key waits on the first one's row, then
 * applies its own update to the committed row, so racing writers leave one
 * wake at the earliest due time with no transaction. `move` and `clear` are
 * conditional on the version a pass read. `due_at` is indexed for the
 * sweeper's due read.
 */
import type { WakeInput, WakeKey, WakeRecord, WakeStore } from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

/** The tenant column: `""` for no tenant, so the primary key has no NULL in it. */
function tenantKey(key: WakeKey): string {
  return key.tenantId ?? "";
}

function toRecord(row: Record<string, unknown>): WakeRecord {
  const tenant = row.tenant_key as string;
  return {
    ...(tenant !== "" ? { tenantId: tenant } : {}),
    sessionId: row.session_id as string,
    entry: row.entry as string,
    flowKind: row.flow_kind as string,
    userId: row.user_id as string,
    orgId: row.org_id as string,
    dueAt: Number(row.due_at),
    landBy: Number(row.land_by),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

export function createPostgresWakeStore(executor: QueryExecutor): WakeStore {
  return {
    async owe(input: WakeInput): Promise<WakeRecord> {
      const now = Date.now();
      const result = await executor.query(
        `INSERT INTO wakes (tenant_key, session_id, entry, flow_kind, user_id, org_id, due_at, land_by, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)
         ON CONFLICT (tenant_key, session_id, entry) DO UPDATE SET
           due_at = LEAST(wakes.due_at, EXCLUDED.due_at),
           land_by = GREATEST(wakes.land_by, EXCLUDED.land_by),
           version = wakes.version + 1,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [tenantKey(input), input.sessionId, input.entry, input.flowKind, input.userId, input.orgId, input.dueAt, input.landBy, now]
      );
      return toRecord(result.rows[0]!);
    },

    async get(key: WakeKey): Promise<WakeRecord | null> {
      const result = await executor.query(
        "SELECT * FROM wakes WHERE tenant_key = $1 AND session_id = $2 AND entry = $3",
        [tenantKey(key), key.sessionId, key.entry]
      );
      const row = result.rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async move(key: WakeKey, version: number, dueAt: number): Promise<boolean> {
      const result = await executor.query(
        `UPDATE wakes SET due_at = $1, updated_at = $2
         WHERE tenant_key = $3 AND session_id = $4 AND entry = $5 AND version = $6`,
        [dueAt, Date.now(), tenantKey(key), key.sessionId, key.entry, version]
      );
      return result.rowCount > 0;
    },

    async clear(key: WakeKey, version: number): Promise<boolean> {
      const result = await executor.query(
        "DELETE FROM wakes WHERE tenant_key = $1 AND session_id = $2 AND entry = $3 AND version = $4",
        [tenantKey(key), key.sessionId, key.entry, version]
      );
      return result.rowCount > 0;
    },

    async listDue(now: number, limit: number): Promise<WakeRecord[]> {
      const result = await executor.query("SELECT * FROM wakes WHERE due_at <= $1 ORDER BY due_at ASC LIMIT $2", [now, limit]);
      return result.rows.map(toRecord);
    },

    async earliestDueAt(): Promise<number | null> {
      const result = await executor.query("SELECT MIN(due_at) AS due FROM wakes");
      const due = result.rows[0]?.due;
      return due === null || due === undefined ? null : Number(due);
    }
  };
}
