/**
 * SQLite-backed wake store (FIX-2078 D1): a debt's due time, kept until a pass
 * in its session clears it.
 *
 * One row per (tenant, session, entry). `owe` coalesces in one statement
 * (`ON CONFLICT ... DO UPDATE`), keeping the earlier due time and the later
 * `land_by` and bumping the version, so two writers racing on one key leave
 * one wake at the earliest due time. `move` and `clear` are conditional on
 * the version a pass read. `due_at` is indexed for the sweeper's due read.
 */
import type Database from "better-sqlite3";
import type { WakeInput, WakeKey, WakeRecord, WakeStore } from "@flow-state-dev/engine";

type WakeRow = {
  tenant_key: string;
  session_id: string;
  entry: string;
  flow_kind: string;
  user_id: string;
  org_id: string;
  due_at: number;
  land_by: number;
  version: number;
  created_at: number;
  updated_at: number;
};

/** The tenant column: `""` for no tenant, so the primary key has no NULL in it. */
function tenantKey(key: WakeKey): string {
  return key.tenantId ?? "";
}

function toRecord(row: WakeRow): WakeRecord {
  return {
    ...(row.tenant_key !== "" ? { tenantId: row.tenant_key } : {}),
    sessionId: row.session_id,
    entry: row.entry,
    flowKind: row.flow_kind,
    userId: row.user_id,
    orgId: row.org_id,
    dueAt: row.due_at,
    landBy: row.land_by,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createSQLiteWakeStore(db: Database.Database): WakeStore {
  const upsertStmt = db.prepare(
    `INSERT INTO wakes (tenant_key, session_id, entry, flow_kind, user_id, org_id, due_at, land_by, version, created_at, updated_at)
     VALUES (@tenant_key, @session_id, @entry, @flow_kind, @user_id, @org_id, @due_at, @land_by, 1, @now, @now)
     ON CONFLICT(tenant_key, session_id, entry) DO UPDATE SET
       due_at = MIN(wakes.due_at, excluded.due_at),
       land_by = MAX(wakes.land_by, excluded.land_by),
       version = wakes.version + 1,
       updated_at = excluded.updated_at
     RETURNING *`
  );
  const getStmt = db.prepare(`SELECT * FROM wakes WHERE tenant_key = ? AND session_id = ? AND entry = ?`);
  const moveStmt = db.prepare(
    `UPDATE wakes SET due_at = ?, updated_at = ? WHERE tenant_key = ? AND session_id = ? AND entry = ? AND version = ?`
  );
  const clearStmt = db.prepare(`DELETE FROM wakes WHERE tenant_key = ? AND session_id = ? AND entry = ? AND version = ?`);
  const dueStmt = db.prepare(`SELECT * FROM wakes WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?`);
  const earliestStmt = db.prepare(`SELECT MIN(due_at) AS due FROM wakes`);

  return {
    async owe(input: WakeInput): Promise<WakeRecord> {
      const row = upsertStmt.get({
        tenant_key: tenantKey(input),
        session_id: input.sessionId,
        entry: input.entry,
        flow_kind: input.flowKind,
        user_id: input.userId,
        org_id: input.orgId,
        due_at: input.dueAt,
        land_by: input.landBy,
        now: Date.now()
      }) as WakeRow;
      return toRecord(row);
    },

    async get(key: WakeKey): Promise<WakeRecord | null> {
      const row = getStmt.get(tenantKey(key), key.sessionId, key.entry) as WakeRow | undefined;
      return row === undefined ? null : toRecord(row);
    },

    async move(key: WakeKey, version: number, dueAt: number): Promise<boolean> {
      return moveStmt.run(dueAt, Date.now(), tenantKey(key), key.sessionId, key.entry, version).changes > 0;
    },

    async clear(key: WakeKey, version: number): Promise<boolean> {
      return clearStmt.run(tenantKey(key), key.sessionId, key.entry, version).changes > 0;
    },

    async listDue(now: number, limit: number): Promise<WakeRecord[]> {
      return (dueStmt.all(now, limit) as WakeRow[]).map(toRecord);
    },

    async earliestDueAt(): Promise<number | null> {
      const row = earliestStmt.get() as { due: number | null } | undefined;
      return row?.due ?? null;
    }
  };
}
