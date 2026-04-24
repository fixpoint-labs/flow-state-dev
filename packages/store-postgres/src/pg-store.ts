/**
 * Generic PostgreSQL record store abstraction.
 * All 4 record stores (session, request, user, project) use this base
 * with store-specific column mappings and filter builders.
 */

import type { ExpectedVersion, SetResult } from "@flow-state-dev/server";
import type { QueryExecutor, QueryResultRow } from "./types";

export type PgRecordStoreConfig<TRecord, TListOptions> = {
  tableName: string;
  /** Column names to insert (excluding 'id' and 'data') */
  columns: string[];
  /** Extract indexed scalar column values from the record (same order as columns) */
  toRow: (record: TRecord) => unknown[];
  /** Build WHERE clause fragments from list options. Uses $N numbered params starting at nextParam. */
  toWhere: (options?: TListOptions, nextParam?: number) => { clause: string; params: unknown[] };
};

export type PgRecordStore<TRecord, TListOptions> = {
  get(id: string): Promise<TRecord | undefined>;
  set(
    id: string,
    value: TRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<TRecord>>;
  delete(id: string): Promise<void>;
  list(options?: TListOptions): Promise<TRecord[]>;
};

export function createPgRecordStore<
  TRecord extends { version: number; createdAt: number; updatedAt: number },
  TListOptions extends { limit?: number; offset?: number }
>(
  executor: QueryExecutor,
  config: PgRecordStoreConfig<TRecord, TListOptions>
): PgRecordStore<TRecord, TListOptions> {
  const { tableName, columns, toRow, toWhere } = config;

  const allColumns = ["id", ...columns, "version", "created_at", "updated_at", "data"];
  const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(", ");
  const updateSet = columns
    .map((col) => `${col} = EXCLUDED.${col}`)
    .concat([
      "version = EXCLUDED.version",
      "updated_at = EXCLUDED.updated_at",
      "data = EXCLUDED.data"
    ])
    .join(", ");

  const upsertSQL = `INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
  const casInsertSQL = `INSERT INTO ${tableName} (${allColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO NOTHING`;

  const updateAssignments = [
    ...columns.map((col, i) => `${col} = $${i + 1}`),
    `version = $${columns.length + 1}`,
    `updated_at = $${columns.length + 2}`,
    `data = $${columns.length + 3}`
  ].join(", ");
  const idParam = columns.length + 4;
  const expectedVersionParam = columns.length + 5;
  const casUpdateSQL = `UPDATE ${tableName} SET ${updateAssignments} WHERE id = $${idParam} AND version = $${expectedVersionParam}`;

  const getSQL = `SELECT data FROM ${tableName} WHERE id = $1`;
  const deleteSQL = `DELETE FROM ${tableName} WHERE id = $1`;

  async function loadConflict(id: string): Promise<SetResult<TRecord>> {
    const result = await executor.query(getSQL, [id]);
    const row = result.rows[0] as QueryResultRow | undefined;
    const currentValue = row === undefined ? undefined : (parseData(row.data) as TRecord);
    const currentVersion = currentValue?.version ?? 0;
    return {
      ok: false,
      conflict: { currentValue, currentVersion }
    };
  }

  return {
    async get(id: string): Promise<TRecord | undefined> {
      const result = await executor.query(getSQL, [id]);
      if (result.rows.length === 0) return undefined;
      const row = result.rows[0] as QueryResultRow;
      return parseData(row.data) as TRecord;
    },

    async set(
      id: string,
      value: TRecord,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<TRecord>> {
      const scalarValues = toRow(value);
      const data = JSON.stringify(value);

      if (expectedVersion === "any") {
        await executor.query(upsertSQL, [
          id,
          ...scalarValues,
          value.version,
          value.createdAt,
          value.updatedAt,
          data
        ]);
        return { ok: true, version: value.version };
      }

      // Try the CAS update first — the common case.
      const updateResult = await executor.query(casUpdateSQL, [
        ...scalarValues,
        value.version,
        value.updatedAt,
        data,
        id,
        expectedVersion
      ]);
      if (updateResult.rowCount > 0) {
        return { ok: true, version: value.version };
      }

      // No row matched. expectedVersion=0 may mean "no row yet" — try insert.
      // `DO NOTHING` returns rowCount=0 when a row exists → that's a conflict.
      if (expectedVersion === 0) {
        const insertResult = await executor.query(casInsertSQL, [
          id,
          ...scalarValues,
          value.version,
          value.createdAt,
          value.updatedAt,
          data
        ]);
        if (insertResult.rowCount === 0) {
          return loadConflict(id);
        }
        return { ok: true, version: value.version };
      }

      return loadConflict(id);
    },

    async delete(id: string): Promise<void> {
      await executor.query(deleteSQL, [id]);
    },

    async list(options?: TListOptions): Promise<TRecord[]> {
      const { clause, params } = toWhere(options, 1);

      let sql = `SELECT data FROM ${tableName}`;
      if (clause.length > 0) {
        sql += ` WHERE ${clause}`;
      }
      sql += ` ORDER BY updated_at DESC`;

      const offset = Math.max(0, options?.offset ?? 0);
      const limit = options?.limit;

      if (limit !== undefined) {
        const limitParam = params.length + 1;
        const offsetParam = params.length + 2;
        sql += ` LIMIT $${limitParam} OFFSET $${offsetParam}`;
        params.push(Math.max(0, limit), offset);
      } else if (offset > 0) {
        const offsetParam = params.length + 1;
        sql += ` OFFSET $${offsetParam}`;
        params.push(offset);
      }

      const result = await executor.query(sql, params);
      return result.rows.map((row) => parseData(row.data) as TRecord);
    }
  };
}

/** Parse the data column — handles both string (TEXT) and pre-parsed object (JSONB) */
function parseData(data: unknown): unknown {
  if (typeof data === "string") return JSON.parse(data);
  return data;
}
