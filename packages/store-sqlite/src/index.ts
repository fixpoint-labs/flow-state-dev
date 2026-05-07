import Database from "better-sqlite3";
import type { StoreRegistry } from "@flow-state-dev/server";
import { resolveTraceMaxRequests } from "@flow-state-dev/server";
import { InMemoryContentStore } from "./content-store";
import { applyConnectionPragmas, initializeSchemaDDL } from "./schema";
import { createSQLiteSessionStore } from "./session-store";
import { createSQLiteRequestStore } from "./request-store";
import { createSQLiteUserStore } from "./user-store";
import { createSQLiteOrgStore } from "./org-store";
import { createSQLiteActiveRequestRegistry } from "./active-request-registry";
import { createSQLiteCheckpointStore } from "./checkpoint-store";
import { createSQLiteTraceStore, type SQLiteTraceStoreOptions } from "./trace-store";

export type SQLiteStoreOptions = {
  /** File path to the SQLite database, or ":memory:" for in-memory */
  filename: string;
  /** Skip schema DDL (CREATE TABLE/INDEX + project→org rename migrations) on
   *  construction. Default `false`. Set to `true` when migrations are run
   *  out-of-band (e.g. as a deploy step). Per-connection PRAGMAs (busy_timeout,
   *  synchronous, foreign_keys, etc.) are always applied — they are required
   *  for safe concurrent access on every fresh better-sqlite3 connection. */
  skipSchemaInit?: boolean;
  /** Trace store retention options. Defaults to `maxRequests: 50`. */
  traceStore?: SQLiteTraceStoreOptions;
};

export type SQLiteStoreRegistry = StoreRegistry & {
  /** Close the underlying SQLite connection */
  close(): void;
};

/**
 * Create a StoreRegistry backed by SQLite. Per-connection PRAGMAs are
 * always applied. Schema DDL auto-initializes on first call unless
 * `skipSchemaInit: true`.
 */
export function createSQLiteStores(options: SQLiteStoreOptions): SQLiteStoreRegistry {
  const db = new Database(options.filename);
  // PRAGMAs are per-connection; SQLite defaults (busy_timeout = 0, etc.) are
  // unsafe for concurrent writes. Always apply, even when skipping DDL.
  applyConnectionPragmas(db);
  if (options.skipSchemaInit !== true) {
    initializeSchemaDDL(db);
  }

  return {
    session: createSQLiteSessionStore(db),
    request: createSQLiteRequestStore(db),
    user: createSQLiteUserStore(db),
    org: createSQLiteOrgStore(db),
    activeRequests: createSQLiteActiveRequestRegistry(db),
    content: new InMemoryContentStore(),
    checkpoints: createSQLiteCheckpointStore(db),
    traces: createSQLiteTraceStore(db, {
      ...options.traceStore,
      maxRequests: resolveTraceMaxRequests(options.traceStore?.maxRequests)
    }),
    close() {
      db.close();
    }
  };
}

export {
  createSQLiteSessionStore,
  createSQLiteRequestStore,
  createSQLiteUserStore,
  createSQLiteOrgStore,
  createSQLiteActiveRequestRegistry,
  createSQLiteCheckpointStore,
  createSQLiteTraceStore
};

export type { SQLiteTraceStoreOptions };

export { initializeSchema, initializeSchemaDDL, applyConnectionPragmas } from "./schema";
