/**
 * Generic SQLite record store abstraction.
 *
 * All four record stores (session, request, user, org) build on this base
 * with store-specific column mappings and filter builders. It also implements
 * the FIX-405 delta verbs (`patchField` / `incField` / `pushToArray`): each
 * verb mutates only the targeted `state.<field>` inside a `db.transaction`,
 * keeping `version` / `updatedAt` in lockstep with their mirrored top-level
 * entries in `data`. Unlike the Postgres adapter (JSONB operators), SQLite
 * parses the blob, mutates it in JS, and rewrites it — correct and simple for
 * the depth-1 paths the contract allows in v1.
 */
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
  /**
   * Resolve the ORDER BY clause (column + direction) from list options.
   * Defaults to `updated_at DESC`. Must return a trusted, non-parameterized
   * SQL fragment.
   */
  resolveOrderBy?: (options?: TListOptions) => string;
};

export type SQLiteRecordStore<TRecord, TListOptions> = {
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
  deleteField(
    id: string,
    path: string[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
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
  const { tableName, columns, toRow, toWhere, resolveOrderBy } = config;

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

  // Delta-verb statements: read the blob + version together (so the CAS check
  // and the JS-side mutation see the same row), then rewrite only `data`,
  // `version`, and `updated_at`. Indexed scalar columns are not touched —
  // delta verbs mutate state fields, never the indexed access paths.
  const selectDeltaStmt = db.prepare(
    `SELECT data, version FROM ${tableName} WHERE id = ?`
  );
  const updateDeltaStmt = db.prepare(
    `UPDATE ${tableName} SET data = ?, version = ?, updated_at = ? WHERE id = ?`
  );

  /** Internal shape the delta mutators read/write inside the parsed blob. */
  type DeltaRecord = {
    state: Record<string, unknown>;
    version: number;
    updatedAt: number;
    [k: string]: unknown;
  };

  /**
   * Shared CAS-predicated delta mutation. Reads the row, enforces the
   * expected version, applies `mutate` to the targeted state field, and
   * rewrites the blob with the bumped version + updatedAt — all inside one
   * synchronous transaction. Returns a conflict (with the current value/
   * version) on a stale expectedVersion or a missing record.
   */
  function runDelta(
    id: string,
    path: string[],
    expectedVersion: ExpectedVersion,
    updatedAt: number,
    mutate: (current: unknown, record: DeltaRecord, path: string[]) => void
  ): SetResult<TRecord> {
    if (path.length < 1 || path.length > 2) {
      throw new Error(
        `sqlite delta verbs support depth-1 or depth-2 paths; got [${path.join(", ")}]`
      );
    }
    return db.transaction((): SetResult<TRecord> => {
      const row = selectDeltaStmt.get(id) as
        | { data: string; version: number }
        | undefined;
      if (row === undefined) {
        return {
          ok: false,
          conflict: { currentValue: undefined, currentVersion: 0 }
        };
      }
      if (expectedVersion !== "any" && row.version !== expectedVersion) {
        return {
          ok: false,
          conflict: {
            currentValue: JSON.parse(row.data) as TRecord,
            currentVersion: row.version
          }
        };
      }
      const newVersion = (expectedVersion === "any" ? row.version : expectedVersion) + 1;
      const record = JSON.parse(row.data) as DeltaRecord;
      if (record.state == null) record.state = {};
      mutate(undefined, record, path);
      record.version = newVersion;
      record.updatedAt = updatedAt;
      updateDeltaStmt.run(JSON.stringify(record), newVersion, updatedAt, id);
      return { ok: true, version: newVersion, record: record as unknown as TRecord };
    })();
  }

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

    async patchField(
      id: string,
      path: string[],
      value: unknown,
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<TRecord>> {
      return runDelta(id, path, expectedVersion, updatedAt, (_current, record, p) => {
        if (p.length === 2) {
          if (record.state[p[0]] == null || typeof record.state[p[0]] !== "object") {
            record.state[p[0]] = {};
          }
          (record.state[p[0]] as Record<string, unknown>)[p[1]] = value;
        } else {
          record.state[p[0]] = value;
        }
      });
    },

    async incField(
      id: string,
      path: string[],
      delta: number,
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<TRecord>> {
      return runDelta(id, path, expectedVersion, updatedAt, (_current, record, p) => {
        const existing = record.state[p[0]];
        record.state[p[0]] = (typeof existing === "number" ? existing : 0) + delta;
      });
    },

    async pushToArray(
      id: string,
      path: string[],
      values: unknown[],
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<TRecord>> {
      return runDelta(id, path, expectedVersion, updatedAt, (_current, record, p) => {
        const existing = record.state[p[0]];
        record.state[p[0]] = Array.isArray(existing) ? [...existing, ...values] : [...values];
      });
    },

    async deleteField(
      id: string,
      path: string[],
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<TRecord>> {
      return runDelta(id, path, expectedVersion, updatedAt, (_current, record, p) => {
        if (p.length === 2) {
          const parent = record.state[p[0]];
          if (parent != null && typeof parent === "object") {
            delete (parent as Record<string, unknown>)[p[1]];
          }
        } else {
          delete record.state[p[0]];
        }
      });
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
      sql += ` ORDER BY ${resolveOrderBy?.(options) ?? "updated_at DESC"}`;

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
