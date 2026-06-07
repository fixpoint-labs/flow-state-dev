import Database from "better-sqlite3";
import type { StoreAdapter, StoreRegistry } from "@flow-state-dev/server";
import { InMemoryContentStore } from "./content-store";
import { InMemoryResourceStateStore } from "./resource-state-store";
import { applyConnectionPragmas, initializeSchemaDDL } from "./schema";
import { createSQLiteSessionStore } from "./session-store";
import {
  createSQLiteRequestStore,
  type CreateSQLiteRequestStoreOptions
} from "./request-store";
import { createSQLiteUserStore } from "./user-store";
import { createSQLiteOrgStore } from "./org-store";
import { createSQLiteActiveRequestRegistry } from "./active-request-registry";
import { createSQLiteCheckpointStore } from "./checkpoint-store";
import { createSQLiteTraceStore, type SQLiteTraceStoreOptions } from "./trace-store";
import { createSQLiteSuspensionStore } from "./suspension-store";
import { createSQLiteLeaseStore } from "./lease-store";

// Inlined to avoid a value import from `@flow-state-dev/server` — the
// store-sqlite package boundary forbids value imports from server, and the
// shared helper in server is the same three lines. Drift risk is low: the
// constants are documented in the trace-channel reference doc.
function resolveTraceMaxRequests(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  return process.env.NODE_ENV === "development" ? 1000 : 50;
}

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
  /** Request store live-tail subscription options. */
  requestStore?: CreateSQLiteRequestStoreOptions;
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
    request: createSQLiteRequestStore(db, options.requestStore),
    user: createSQLiteUserStore(db),
    org: createSQLiteOrgStore(db),
    activeRequests: createSQLiteActiveRequestRegistry(db),
    content: new InMemoryContentStore(),
    resourceState: new InMemoryResourceStateStore(),
    checkpoints: createSQLiteCheckpointStore(db),
    traces: createSQLiteTraceStore(db, {
      ...options.traceStore,
      maxRequests: resolveTraceMaxRequests(options.traceStore?.maxRequests)
    }),
    suspensions: createSQLiteSuspensionStore(db),
    leases: createSQLiteLeaseStore(db),
    close() {
      db.close();
    }
  };
}

/**
 * SQLite store adapter for `createFlowState`. Backs the `primary` capability
 * slot. Wraps `createSQLiteStores` (synchronous), memoizing the registry so
 * the connection opens once, and disposes it via `close()`.
 */
export function sqliteStores(options: SQLiteStoreOptions): StoreAdapter {
  let registry: SQLiteStoreRegistry | undefined;
  return {
    capabilities: ["primary"],
    resolve() {
      registry ??= createSQLiteStores(options);
      return Promise.resolve(registry);
    },
    dispose() {
      registry?.close();
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
  createSQLiteTraceStore,
  createSQLiteSuspensionStore,
  createSQLiteLeaseStore
};

export { createSQLiteScheduleIndex } from "./schedule-index";

export type { SQLiteTraceStoreOptions };
export type { CreateSQLiteRequestStoreOptions } from "./request-store";

export { initializeSchema, initializeSchemaDDL, applyConnectionPragmas } from "./schema";
