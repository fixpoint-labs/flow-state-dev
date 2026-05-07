import Database from "better-sqlite3";
import { createSQLiteRequestStore } from "../src/request-store";
import { initializeSchemaDDL, applyConnectionPragmas } from "../src/schema";
import { createRequestStoreConformanceTests } from "@flow-state-dev/server/testing";

const POLL_INTERVAL_MS = 25;

createRequestStoreConformanceTests({
  name: "SQLiteRequestStore",
  pollIntervalMs: POLL_INTERVAL_MS,
  createStore: () => {
    const db = new Database(":memory:");
    applyConnectionPragmas(db);
    initializeSchemaDDL(db);
    const store = createSQLiteRequestStore(db, {
      subscribePollIntervalMs: POLL_INTERVAL_MS
    });
    // Stash the db on the store so cleanup can close it.
    (store as unknown as { __db: Database.Database }).__db = db;
    return store;
  },
  cleanup: (store) => {
    const db = (store as unknown as { __db: Database.Database }).__db;
    db.close();
  }
});
