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
    await first.resourceState.set("session", "sess_1", "counter", { count: 42 });
    await first.resourceState.set("session", "sess_1", "items/a", { label: "a", nested: { ok: true } });
    first.close();

    const second = createSQLiteStores({ filename: tmpFile, skipSchemaInit: true });
    expect(await second.resourceState.get("session", "sess_1", "counter")).toEqual({ count: 42 });
    expect(await second.resourceState.get("session", "sess_1", "items/a")).toEqual({
      label: "a",
      nested: { ok: true }
    });
    second.close();
  });
});
