/**
 * The read across an owner's sessions, store half, on SQLite. The connection
 * logs every statement it runs, so the suite can check a page is one
 * statement that joins `sessions`, not one read per session.
 */
import Database from "better-sqlite3";
import { afterAll } from "vitest";
import { createAcrossSessionsConformanceTests } from "@flow-state-dev/engine/testing";
import { applyConnectionPragmas, createSQLiteSessionStore, initializeSchemaDDL } from "../src/host";
import { createSQLiteResourceStateStore } from "../src/resource-state-store";

const open: Database.Database[] = [];

createAcrossSessionsConformanceTests({
  name: "SQLite",
  createStore: () => {
    const statements: string[] = [];
    const db = new Database(":memory:", { verbose: (sql) => statements.push(String(sql)) });
    open.push(db);
    applyConnectionPragmas(db);
    initializeSchemaDDL(db);
    return { sessions: createSQLiteSessionStore(db), resourceState: createSQLiteResourceStateStore(db), statements };
  }
});

afterAll(() => {
  for (const db of open.splice(0)) db.close();
});
