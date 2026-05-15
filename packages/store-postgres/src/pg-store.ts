/**
 * Generic PostgreSQL record store abstraction.
 * All 4 record stores (session, request, user, org) use this base
 * with store-specific column mappings and filter builders.
 *
 * Implements FIX-405 delta verbs (`patchField` / `incField` / `pushToArray`)
 * using JSONB native ops (`jsonb_set`, `||`) wrapped in CAS-predicated
 * UPDATEs. Each verb mutates only the targeted path inside `data->state`
 * while keeping the `version` and `updated_at` columns and their mirrored
 * top-level entries in `data` in lockstep.
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
  patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;
  incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;
  pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
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

  function statePath(path: string[]): string[] {
    if (path.length !== 1) {
      throw new Error(
        `pg delta verbs only support depth-1 paths in v1; received path of length ${path.length}`
      );
    }
    return ["state", path[0]];
  }

  /**
   * Common shape for all three delta UPDATEs. The new `data` JSONB is built
   * by applying `valueExpr` at the targeted path, then merging the new
   * `version` / `updatedAt` at the top level via `||` (shallow merge,
   * RHS-wins) so the JSONB and column views stay in lockstep:
   *
   *   data = jsonb_set(data, $path, <value-expr>, true)
   *          || jsonb_build_object('version', $newV, 'updatedAt', $now),
   *   version = $newV, updated_at = $now
   *
   * For numeric `expectedVersion` the UPDATE is CAS-predicated and the
   * caller pre-computes `newVersion = expectedVersion + 1`. For `"any"` we
   * use `version + 1` and `RETURNING version` so the update is atomic
   * against concurrent writers (no SELECT-then-UPDATE race).
   *
   * `valueExpr` is the SQL fragment that produces the new JSONB value for
   * the targeted path. It may reference `$1` (the path text[]) and any
   * additional operand parameters that follow.
   */
  async function runDeltaUpdate(
    id: string,
    pgPath: string[],
    valueExpr: string,
    operandParams: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>> {
    // Param layout: $1 = path text[]; $2..$M = operand params; then
    // updatedAt, id; and either (newVersion, expectedVersion) for CAS or
    // nothing for "any" (the SQL computes version + 1 in-place).
    const opOffset = 1 + operandParams.length;
    const updatedAtParam = `$${opOffset + 1}`;
    const idParam = `$${opOffset + 2}`;

    if (expectedVersion === "any") {
      // Single atomic UPDATE — no SELECT first, no race. Missing record
      // returns rowCount=0, which we surface as a conflict so the CAS layer
      // can fall back to `set` with a full record on retry.
      const sql = `UPDATE ${tableName}
        SET
          data = jsonb_set(data, $1::text[], ${valueExpr}, true)
                 || jsonb_build_object(
                      'version', version + 1,
                      'updatedAt', ${updatedAtParam}::bigint
                    ),
          version = version + 1,
          updated_at = ${updatedAtParam}::bigint
        WHERE id = ${idParam}
        RETURNING version`;
      const params = [pgPath, ...operandParams, updatedAt, id];
      const result = await executor.query(sql, params);
      if (result.rowCount > 0) {
        const row = result.rows[0] as QueryResultRow;
        return { ok: true, version: Number(row.version) };
      }
      return loadConflict(id);
    }

    const newVersion = expectedVersion + 1;
    const newVersionParam = `$${opOffset + 3}`;
    const expectedParam = `$${opOffset + 4}`;
    const sql = `UPDATE ${tableName}
      SET
        data = jsonb_set(data, $1::text[], ${valueExpr}, true)
               || jsonb_build_object(
                    'version', ${newVersionParam}::int,
                    'updatedAt', ${updatedAtParam}::bigint
                  ),
        version = ${newVersionParam}::int,
        updated_at = ${updatedAtParam}::bigint
      WHERE id = ${idParam} AND version = ${expectedParam}`;

    const params = [
      pgPath,
      ...operandParams,
      updatedAt,
      id,
      newVersion,
      expectedVersion
    ];
    const result = await executor.query(sql, params);
    if (result.rowCount > 0) {
      return { ok: true, version: newVersion };
    }
    return loadConflict(id);
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

    async patchField(
      id: string,
      path: string[],
      value: unknown,
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<TRecord>> {
      return runDeltaUpdate(
        id,
        statePath(path),
        "$2::jsonb",
        [JSON.stringify(value ?? null)],
        expectedVersion,
        updatedAt
      );
    },

    async incField(
      id: string,
      path: string[],
      delta: number,
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<TRecord>> {
      // Treat the existing value as 0 when it's missing OR when its JSONB
      // type is anything other than 'number'. Mirrors the in-memory
      // adapter's `typeof === "number"` baseline; without the typeof guard
      // Postgres would happily cast JSON strings like "5" to numeric 5 and
      // diverge from memory.
      return runDeltaUpdate(
        id,
        statePath(path),
        "to_jsonb(CASE WHEN jsonb_typeof(data #> $1::text[]) = 'number' THEN (data #>> $1::text[])::numeric ELSE 0 END + $2::numeric)",
        [delta],
        expectedVersion,
        updatedAt
      );
    },

    async pushToArray(
      id: string,
      path: string[],
      values: unknown[],
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<TRecord>> {
      // COALESCE treats a missing field as `[]`. If the existing value is a
      // JSONB non-array (e.g. an object), Postgres raises a `||` operator
      // error — caller should know they're pushing to an array slot.
      return runDeltaUpdate(
        id,
        statePath(path),
        "COALESCE(data #> $1::text[], '[]'::jsonb) || $2::jsonb",
        [JSON.stringify(values)],
        expectedVersion,
        updatedAt
      );
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
