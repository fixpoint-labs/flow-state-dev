/**
 * Tests for `createSQLiteScheduleIndex` against `:memory:`. Exercises
 * the shared conformance suite from `@flow-state-dev/scheduled/testing`.
 */
import Database from "better-sqlite3";
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";
import { createSQLiteScheduleIndex } from "../src/schedule-index";
import { initializeSchema } from "../src/schema";

// Retain each test's Database handle so cleanup can close it.
const handles = new WeakMap<object, Database.Database>();

createScheduleIndexConformanceTests("sqlite (memory)", {
  createIndex() {
    const db = new Database(":memory:");
    initializeSchema(db);
    const idx = createSQLiteScheduleIndex(db);
    handles.set(idx as object, db);
    return idx;
  },
  cleanup(idx) {
    const db = handles.get(idx as object);
    if (db) db.close();
  }
});
