/**
 * Tests for `createSQLiteScheduleIndex` against `:memory:`. Exercises
 * the shared conformance suite from `@flow-state-dev/scheduled/testing`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";
import { createSQLiteScheduleIndex, sqliteScheduleIndex } from "../src/schedule-index";
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

// A host's index on a file of its own: the schema is made on open, and what one index holds is
// still there when the same file is opened again, as after a restart.
createScheduleIndexConformanceTests("sqlite (a file of its own)", {
  createIndex() {
    return sqliteScheduleIndex({ filename: join(mkdtempSync(join(tmpdir(), "fsd-schedule-index-")), "clock.db") });
  },
});

describe("sqliteScheduleIndex", () => {
  it("keeps what it holds across a reopen of the same file", async () => {
    const filename = join(mkdtempSync(join(tmpdir(), "fsd-schedule-index-")), "clock.db");
    const entry = { cell: "c1", key: "k1", userId: "u", orgId: "o", cron: "0 9 * * 1", timezone: "UTC", nextFireAt: 1_000 };
    await sqliteScheduleIndex({ filename }).upsert(entry);
    expect(await sqliteScheduleIndex({ filename }).claimDue(2_000, 10)).toEqual([expect.objectContaining({ cell: "c1", key: "k1" })]);
  });
});
