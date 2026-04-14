/**
 * Minimal query interface that both `pg.Pool` and `@electric-sql/pglite` can satisfy.
 * Allows the adapter to work with a real PostgreSQL server or an embedded PGlite instance.
 */

export type QueryResultRow = Record<string, unknown>;

export type QueryResult = {
  rows: QueryResultRow[];
  rowCount: number;
};

export interface QueryExecutor {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export type PostgresStoreOptions =
  | {
      /** Pre-configured pg Pool instance */
      pool: import("pg").Pool;
    }
  | {
      /** PostgreSQL connection string (e.g. "postgres://user:pass@host:5432/db").
       *  When omitted, reads from env: FSD_DB_URL → DATABASE_URL. */
      connectionString?: string;
      /** Maximum number of connections in the pool (default: 10) */
      max?: number;
    }
  | {
      /** A QueryExecutor-compatible client (e.g. PGlite for testing) */
      executor: QueryExecutor;
    };
