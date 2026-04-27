import type Database from "better-sqlite3";
import type { ExpectedVersion, SetResult } from "@flow-state-dev/server";

export type SQLiteRecordStoreConfig<TRecord, TListOptions> = {
  tableName: string;
  /** Column names to insert (excluding 'id' and 'data') */
  columns: string[];
  /** Extract indexed scalar column values from the record (same order as columns) */
  toRow: (record: TRecord) => unknown[];
  /** Build WHERE clause fragments from list options */
  toWhere: (options?: TListOptions) => { clause: string; params: unknown[] };
};

export type SQLiteRecordStore<TRecord, TListOptions> = {
  get(id: string): Promise<TRecord | undefined>;
  set(
    id: string,
    value: TRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<TRecord>>;
  delete(id: string): Promise<void>;
  list(options?: TListOptions): Promise<TRecord[]>;
};

export function createSQLiteRecordStore<
  TRecord extends { version: number; createdAt: number; updatedAt: number },
  TListOptions extends { limit?: number; offset?: number }
>(
  db: Database.Database,
  config: SQLiteRecordStoreConfig<TRecord, TListOptions>
): SQLiteRecordStore<TRecord, TListOptions> {
  const { tableName, columns, toRow, toWhere } = config;

  const allColumns = ["id", ...columns, "version", "created_at", "updated_at", "data"];
  const placeholders = allColumns.map(() => "?").join(", ");
  const updateSet = columns
    .map((col) => `${col} = excluded.${col}`)
    .concat(["version = excluded.version", "updated_at = excluded.updated_at", "data = excluded.data"])
    .join(", ");

  const upsertSQL = `INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
  // CAS update: only succeeds when the stored row's version equals the expected version.
  const updateAssignments = [
    ...columns.map((col) => `${col} = ?`),
    "version = ?",
    "updated_at = ?",
    "data = ?"
  ].join(", ");
  const casUpdateSQL = `UPDATE ${tableName} SET ${updateAssignments} WHERE id = ? AND version = ?`;
  const casInsertSQL = `INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders})`;
  const getSQL = `SELECT data FROM ${tableName} WHERE id = ?`;
  const deleteSQL = `DELETE FROM ${tableName} WHERE id = ?`;

  const upsertStmt = db.prepare(upsertSQL);
  const casUpdateStmt = db.prepare(casUpdateSQL);
  const casInsertStmt = db.prepare(casInsertSQL);
  const getStmt = db.prepare(getSQL);
  const deleteStmt = db.prepare(deleteSQL);

  return {
    async get(id: string): Promise<TRecord | undefined> {
      const row = getStmt.get(id) as { data: string } | undefined;
      return row === undefined ? undefined : JSON.parse(row.data) as TRecord;
    },

    async set(
      id: string,
      value: TRecord,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<TRecord>> {
      const scalarValues = toRow(value);
      const data = JSON.stringify(value);

      if (expectedVersion === "any") {
        upsertStmt.run(id, ...scalarValues, value.version, value.createdAt, value.updatedAt, data);
        return { ok: true, version: value.version };
      }

      // Try the CAS update first — the common case when a row already exists
      // at the expected version.
      const info = casUpdateStmt.run(
        ...scalarValues,
        value.version,
        value.updatedAt,
        data,
        id,
        expectedVersion
      );
      if (info.changes > 0) {
        return { ok: true, version: value.version };
      }

      // No row matched. When expectedVersion is 0 this could mean "no row
      // exists yet" — try the insert. A PK conflict means a row exists at a
      // different version → report CAS conflict.
      if (expectedVersion === 0) {
        try {
          casInsertStmt.run(
            id,
            ...scalarValues,
            value.version,
            value.createdAt,
            value.updatedAt,
            data
          );
          return { ok: true, version: value.version };
        } catch (error) {
          if (!isPrimaryKeyConflict(error)) throw error;
          return loadConflict<TRecord>(getStmt, id);
        }
      }

      // expectedVersion > 0 and no row matched → conflict.
      return loadConflict<TRecord>(getStmt, id);
    },

    async delete(id: string): Promise<void> {
      deleteStmt.run(id);
    },

    async list(options?: TListOptions): Promise<TRecord[]> {
      const { clause, params } = toWhere(options);

      let sql = `SELECT data FROM ${tableName}`;
      if (clause.length > 0) {
        sql += ` WHERE ${clause}`;
      }
      sql += ` ORDER BY updated_at DESC`;

      const offset = Math.max(0, options?.offset ?? 0);
      const limit = options?.limit;

      if (limit !== undefined) {
        sql += ` LIMIT ? OFFSET ?`;
        params.push(Math.max(0, limit), offset);
      } else if (offset > 0) {
        sql += ` LIMIT -1 OFFSET ?`;
        params.push(offset);
      }

      const rows = db.prepare(sql).all(...params) as { data: string }[];
      return rows.map((row) => JSON.parse(row.data) as TRecord);
    }
  };
}

function isPrimaryKeyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT_UNIQUE";
}

function loadConflict<TRecord extends { version: number }>(
  getStmt: Database.Statement,
  id: string
): SetResult<TRecord> {
  const row = getStmt.get(id) as { data: string } | undefined;
  const currentValue = row === undefined ? undefined : (JSON.parse(row.data) as TRecord);
  const currentVersion = currentValue?.version ?? 0;
  return {
    ok: false,
    conflict: { currentValue, currentVersion }
  };
}
