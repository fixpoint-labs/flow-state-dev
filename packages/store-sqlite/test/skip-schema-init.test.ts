/**
 * Regression guards for SQLite skipSchemaInit:
 *
 * - When skipSchemaInit is true, schema DDL (rename migrations + CREATE
 *   TABLE) is skipped — only relevant when the schema is already in place
 *   (e.g. migrations ran out-of-band as a deploy step). The SQLite store
 *   constructors prepare statements eagerly at construction time, so
 *   passing skipSchemaInit: true against an empty database file would
 *   fail with `no such table` — that's expected, not a bug.
 *
 * - Per-connection PRAGMAs MUST be applied even when skipSchemaInit is
 *   true. Every fresh better-sqlite3 connection starts with SQLite
 *   defaults (busy_timeout = 0, foreign_keys OFF, etc.). Skipping pragma
 *   application along with DDL would silently make concurrent writes
 *   fail immediately with SQLITE_BUSY instead of the documented 5s wait.
 *   Caught by Cursor Bugbot on PR #187.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { applyConnectionPragmas } from "../src/schema";
import { createSQLiteStores } from "../src";

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(
    os.tmpdir(),
    `fsd-skip-schema-init-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
});

afterEach(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(tmpFile + suffix);
    } catch {
      // ignore — file may not exist
    }
  }
});

describe("createSQLiteStores — skipSchemaInit", () => {
  it("works when DDL has been pre-applied (the supported usage)", () => {
    createSQLiteStores({ filename: tmpFile }).close();
    const stores = createSQLiteStores({ filename: tmpFile, skipSchemaInit: true });
    expect(stores).toBeDefined();
    stores.close();
  });

  it("applies per-connection pragmas even when skipSchemaInit is true", () => {
    createSQLiteStores({ filename: tmpFile }).close();

    const stores = createSQLiteStores({ filename: tmpFile, skipSchemaInit: true });
    stores.close();

    // journal_mode is persisted on the file, so a second read-only
    // connection sees it. Proves the pragma application ran — if
    // skipSchemaInit had bypassed pragmas (the bug Bugbot caught),
    // a fresh connection on a non-WAL file wouldn't observe wal here.
    const probe = new Database(tmpFile, { readonly: true });
    const journalMode = (probe.pragma("journal_mode") as Array<{ journal_mode: string }>)[0]
      ?.journal_mode;
    expect(journalMode).toBe("wal");
    probe.close();
  });

});

describe("applyConnectionPragmas — sets safe per-connection defaults", () => {
  it("applies all expected pragmas on a fresh connection", () => {
    const db = new Database(":memory:");
    applyConnectionPragmas(db);

    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("synchronous", { simple: true })).toBe(1); // NORMAL = 1
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("cache_size", { simple: true })).toBe(-20000);
    expect(db.pragma("temp_store", { simple: true })).toBe(2); // MEMORY = 2

    db.close();
  });
});
