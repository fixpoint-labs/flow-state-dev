import type Database from "better-sqlite3";

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
  set(id: string, value: TRecord): Promise<void>;
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

  const insertSQL = `INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
  const getSQL = `SELECT data FROM ${tableName} WHERE id = ?`;
  const deleteSQL = `DELETE FROM ${tableName} WHERE id = ?`;

  const insertStmt = db.prepare(insertSQL);
  const getStmt = db.prepare(getSQL);
  const deleteStmt = db.prepare(deleteSQL);

  return {
    async get(id: string): Promise<TRecord | undefined> {
      const row = getStmt.get(id) as { data: string } | undefined;
      return row === undefined ? undefined : JSON.parse(row.data) as TRecord;
    },

    async set(id: string, value: TRecord): Promise<void> {
      const scalarValues = toRow(value);
      const data = JSON.stringify(value);
      insertStmt.run(id, ...scalarValues, value.version, value.createdAt, value.updatedAt, data);
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
