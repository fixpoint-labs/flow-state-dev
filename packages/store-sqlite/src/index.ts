import Database from "better-sqlite3";
import type { StoreRegistry } from "@flow-state-dev/server";
import { InMemoryContentStore } from "./content-store";
import { initializeSchema } from "./schema";
import { createSQLiteSessionStore } from "./session-store";
import { createSQLiteRequestStore } from "./request-store";
import { createSQLiteUserStore } from "./user-store";
import { createSQLiteOrgStore } from "./org-store";
import { createSQLiteActiveRequestRegistry } from "./active-request-registry";

export type SQLiteStoreOptions = {
  /** File path to the SQLite database, or ":memory:" for in-memory */
  filename: string;
  /** Skip schema initialization on construction. Default `false`.
   *  Set to `true` when migrations are run out-of-band (e.g. as a deploy step). */
  skipSchemaInit?: boolean;
};

export type SQLiteStoreRegistry = StoreRegistry & {
  /** Close the underlying SQLite connection */
  close(): void;
};

/**
 * Create a StoreRegistry backed by SQLite.
 * Schema auto-initializes on first call unless `skipSchemaInit: true`.
 */
export function createSQLiteStores(options: SQLiteStoreOptions): SQLiteStoreRegistry {
  const db = new Database(options.filename);
  if (options.skipSchemaInit !== true) {
    initializeSchema(db);
  }

  return {
    session: createSQLiteSessionStore(db),
    request: createSQLiteRequestStore(db),
    user: createSQLiteUserStore(db),
    org: createSQLiteOrgStore(db),
    activeRequests: createSQLiteActiveRequestRegistry(db),
    content: new InMemoryContentStore(),
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
  createSQLiteActiveRequestRegistry
};

export { initializeSchema } from "./schema";
