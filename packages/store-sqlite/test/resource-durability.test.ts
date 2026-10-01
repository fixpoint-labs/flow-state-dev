/**
 * FIX-687 regression coverage for the SQLite resource stores.
 *
 * Two concerns:
 *  - Conformance: the SQLite-backed `ContentStore` and `ResourceStateStore`
 *    satisfy the shared keyed-resource-store contract (run against `:memory:`).
 *  - Durability: content and state survive a process restart. The original bug
 *    was that both stores were backed by an in-memory `Map`, so a "persistent"
 *    SQLite registry silently dropped them on restart. This is reproduced by
 *    writing through a file-backed registry, closing it, reopening the same
 *    file, and asserting the values are still readable. Before the fix this
 *    test fails (the reopened registry sees nothing); after it, it passes.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  createContentStoreConformanceTests,
  createResourceStateStoreConformanceTests
} from "@flow-state-dev/engine/testing";
import { createSQLiteStores } from "../src";
import { createSQLiteContentStore } from "../src/content-store";
import { createSQLiteResourceStateStore } from "../src/resource-state-store";
import { initializeSchema } from "../src/schema";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initializeSchema(db);
  return db;
}

createContentStoreConformanceTests({
  name: "SQLiteContentStore",
  createStore: () => {
    const db = freshDb();
    const store = createSQLiteContentStore(db);
    (store as unknown as { __db: Database.Database }).__db = db;
    return store;
  },
  cleanup: (store) => {
    (store as unknown as { __db: Database.Database }).__db.close();
  }
});

createResourceStateStoreConformanceTests({
  name: "SQLiteResourceStateStore",
  createStore: () => {
    const db = freshDb();
    const store = createSQLiteResourceStateStore(db);
    (store as unknown as { __db: Database.Database }).__db = db;
    return store;
  },
  cleanup: (store) => {
    (store as unknown as { __db: Database.Database }).__db.close();
  }
});

describe("SQLite resource durability across restart", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `fsd-resource-durability-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
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

  it("resource content survives close and reopen", async () => {
    const first = createSQLiteStores({ filename: tmpFile });
    await first.content.set("session", "sess_1", "artifacts/doc", "hello world");
    await first.content.set("user", "user_1", "profile", "bio text");
    first.close();

    const second = createSQLiteStores({ filename: tmpFile, skipSchemaInit: true });
    expect(await second.content.get("session", "sess_1", "artifacts/doc")).toBe("hello world");
    expect(await second.content.get("user", "user_1", "profile")).toBe("bio text");
    second.close();
  });

  it("resource state survives close and reopen", async () => {
    const first = createSQLiteStores({ filename: tmpFile });
    await first.resourceState.set("session", "sess_1", "counter", { count: 42 }, 0);
    await first.resourceState.set(
      "session",
      "sess_1",
      "items/a",
      { label: "a", nested: { ok: true } },
      0
    );
    first.close();

    const second = createSQLiteStores({ filename: tmpFile, skipSchemaInit: true });
    expect(await second.resourceState.get("session", "sess_1", "counter")).toEqual({
      state: { count: 42 },
      version: 1
    });
    expect(await second.resourceState.get("session", "sess_1", "items/a")).toEqual({
      state: { label: "a", nested: { ok: true } },
      version: 1
    });
    second.close();
  });
});

/**
 * Migration and retention behaviour specific to the SQL adapter: the columns
 * are added to an existing table rather than rebuilt into a new one, and the
 * retained tombstone survives a real close/reopen — which is the only place
 * "retention is the guarantee" can actually be observed durably.
 */
describe("SQLite resource_state versioning migration", () => {
  let tmpFile: string;
  beforeEach(() => {
    tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "fsd-sqlite-migrate-")),
      "store.db"
    );
  });
  afterEach(() => {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  });

  /** Create the table exactly as it existed before versioning. */
  function seedPreMigrationTable(db: Database.Database): void {
    db.exec(`
      CREATE TABLE resource_state (
        scope_type    TEXT NOT NULL,
        scope_id      TEXT NOT NULL,
        resource_key  TEXT NOT NULL,
        state         TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id, resource_key)
      );
    `);
    db.prepare(
      "INSERT INTO resource_state (scope_type, scope_id, resource_key, state) VALUES (?,?,?,?)"
    ).run("session", "s1", "legacy", JSON.stringify({ hello: "world" }));
  }

  it("adds the columns to the existing table without rebuilding it, and a legacy row reads live at version 1", async () => {
    const raw = new Database(tmpFile);
    seedPreMigrationTable(raw);
    raw.close();

    const stores = createSQLiteStores({ filename: tmpFile });
    // An existing row must never read as absence.
    expect(await stores.resourceState.get("session", "s1", "legacy")).toEqual({
      state: { hello: "world" },
      version: 1
    });
    // …so create-if-absent against it conflicts.
    const created = await stores.resourceState.set(
      "session",
      "s1",
      "legacy",
      { x: 1 },
      0
    );
    expect(created.ok).toBe(false);
    stores.close();

    // `state` is still NOT NULL and the table was never rebuilt — that is what
    // makes this migration purely additive, and it is what a `{}` tombstone
    // payload buys instead of a nullable state column.
    const check = new Database(tmpFile);
    const cols = check
      .prepare("SELECT name, [notnull] FROM pragma_table_info('resource_state')")
      .all() as Array<{ name: string; notnull: number }>;
    const state = cols.find((c) => c.name === "state");
    expect(state?.notnull).toBe(1);
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["state", "version", "lifecycle"])
    );
    check.close();
  });

  it("is idempotent across two boots", async () => {
    const raw = new Database(tmpFile);
    seedPreMigrationTable(raw);
    raw.close();

    const first = createSQLiteStores({ filename: tmpFile });
    await first.resourceState.set("session", "s1", "legacy", { hello: "again" }, 1);
    first.close();

    // Second boot re-runs the same DDL — the column probes make it a no-op
    // rather than an error, and no data is disturbed.
    const second = createSQLiteStores({ filename: tmpFile });
    expect(await second.resourceState.get("session", "s1", "legacy")).toEqual({
      state: { hello: "again" },
      version: 2
    });
    second.close();
  });

  it("retains a tombstone across a close and reopen, so a pre-delete version still conflicts", async () => {
    const first = createSQLiteStores({ filename: tmpFile });
    await first.resourceState.set("session", "s1", "k", { v: 1 }, 0); // version 1
    await first.resourceState.delete("session", "s1", "k", 1);
    first.close();

    const second = createSQLiteStores({ filename: tmpFile, skipSchemaInit: true });
    // The tombstone reads as absent…
    expect(await second.resourceState.get("session", "s1", "k")).toBeUndefined();
    // …but its version survived the restart, so a recreate does not reuse it
    const recreated = await second.resourceState.set("session", "s1", "k", { v: 2 }, 0);
    expect(recreated).toEqual({ ok: true, version: 2 });
    // …and a straggler holding the pre-delete version still conflicts.
    const straggler = await second.resourceState.set("session", "s1", "k", { v: 9 }, 1);
    expect(straggler.ok).toBe(false);
    second.close();
  });

  it("stores a tombstone as an empty object rather than the last value", async () => {
    const stores = createSQLiteStores({ filename: tmpFile });
    await stores.resourceState.set("session", "s1", "k", { secret: "value" }, 0);
    await stores.resourceState.delete("session", "s1", "k", 1);
    stores.close();

    const check = new Database(tmpFile);
    const row = check
      .prepare(
        "SELECT state, version, lifecycle FROM resource_state WHERE resource_key = 'k'"
      )
      .get() as { state: string; version: number; lifecycle: string };
    expect(row.lifecycle).toBe("deleted");
    expect(row.version).toBe(1); // retained
    expect(JSON.parse(row.state)).toEqual({}); // payload dropped
    check.close();
  });
});
