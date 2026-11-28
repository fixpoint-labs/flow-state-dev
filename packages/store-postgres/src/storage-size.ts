/**
 * The Postgres store's size: the sum of `pg_total_relation_size` (table, its
 * indexes and TOAST) over the tables this store creates, as the connection's
 * `search_path` resolves them. Only the store's own tables, never the whole
 * database, which may hold an app's tables too. Read on demand by
 * `StoreRegistry.storageSize`.
 */
import type { StorageSize } from "@flow-state-dev/engine/host";
import { storeTableNames } from "./schema";
import type { QueryExecutor } from "./types";

/**
 * Measure the store's tables. A table not created yet (skipped schema init)
 * counts 0. `location` is the database name, never the connection string.
 */
export async function postgresStorageSize(executor: QueryExecutor): Promise<StorageSize> {
  const { rows } = await executor.query(
    `SELECT current_database() AS database,
            COALESCE(SUM(pg_total_relation_size(rel)), 0)::text AS bytes
       FROM unnest($1::text[]) AS t(name)
       CROSS JOIN LATERAL to_regclass(t.name) AS rel
      WHERE rel IS NOT NULL`,
    [storeTableNames()]
  );
  const row = rows[0] ?? {};
  return {
    kind: "postgres",
    bytes: Number(row.bytes ?? 0),
    ...(typeof row.database === "string" ? { location: row.database } : {})
  };
}
