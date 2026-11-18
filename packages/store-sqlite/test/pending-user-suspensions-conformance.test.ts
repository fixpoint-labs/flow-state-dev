// FIX-2770.
/**
 * The pending-asks read's conformance on SQLite. The connection logs every
 * statement it runs, so the suite can check the read is one statement that
 * joins `requests`, not a list read back and filtered.
 */
import Database from "better-sqlite3";
import { afterAll } from "vitest";
import { createPendingUserSuspensionsConformanceTests } from "@flow-state-dev/engine/testing";
import { applyConnectionPragmas, createSQLiteRequestStore, createSQLiteSuspensionStore, initializeSchemaDDL } from "../src/host";

const open: Database.Database[] = [];

createPendingUserSuspensionsConformanceTests({
  name: "SQLite",
  createStore: () => {
    const statements: string[] = [];
    const db = new Database(":memory:", { verbose: (sql) => statements.push(String(sql)) });
    open.push(db);
    applyConnectionPragmas(db);
    initializeSchemaDDL(db);
    return { requests: createSQLiteRequestStore(db), suspensions: createSQLiteSuspensionStore(db), statements };
  }
});

afterAll(() => {
  for (const db of open.splice(0)) db.close();
});
