/**
 * SQLite adapter compliance with the Store CAS contract (FIX-400).
 *
 * The contract is also exercised at the in-memory/filesystem layer in
 * @flow-state-dev/engine. These tests verify the SQLite adapter enforces
 * the same semantics: version predicate, insert-or-update on expectedVersion=0,
 * "any" writes unconditionally, and cross-registry conflict detection when
 * two store instances share the same database file.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { SessionRecord } from "@flow-state-dev/engine";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";

function makeSession(id: string, version: number, state: Record<string, unknown> = {}): SessionRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "flow-a",
    userId: "user_1",
    state,
    version,
    createdAt: ts,
    updatedAt: ts,
    journal: []
  };
}

describe("SQLite adapter — Store CAS contract", () => {
  let stores: SQLiteStoreRegistry;

  beforeEach(() => {
    stores = createSQLiteStores({ filename: ":memory:" });
  });

  afterEach(() => {
    stores.close();
  });

  it("writes a new record when expectedVersion is 0", async () => {
    const result = await stores.session.set(
      "s1",
      makeSession("s1", 0, { initial: true }),
      0
    );
    expect(result).toEqual({ ok: true, version: 0 });
    expect((await stores.session.get("s1"))?.state).toEqual({ initial: true });
  });

  it("updates when expectedVersion matches stored version", async () => {
    await stores.session.set("s2", makeSession("s2", 0), "any");
    const bumped = await stores.session.set(
      "s2",
      makeSession("s2", 1, { bumped: true }),
      0
    );
    expect(bumped).toEqual({ ok: true, version: 1 });
    const fetched = await stores.session.get("s2");
    expect(fetched?.version).toBe(1);
    expect(fetched?.state).toEqual({ bumped: true });
  });

  it("reports conflict with current value/version on version mismatch", async () => {
    await stores.session.set("s3", makeSession("s3", 0), "any");
    await stores.session.set("s3", makeSession("s3", 1, { v: 1 }), 0);

    const stale = await stores.session.set(
      "s3",
      makeSession("s3", 2, { stale: true }),
      0
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("unreachable");
    expect(stale.conflict.currentVersion).toBe(1);
    expect(stale.conflict.currentValue?.state).toEqual({ v: 1 });
    // Unchanged in the database.
    expect((await stores.session.get("s3"))?.state).toEqual({ v: 1 });
  });

  it("conflict surfaces when expectedVersion exceeds a missing record's version", async () => {
    const missing = await stores.session.set("s4", makeSession("s4", 6), 5);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.conflict.currentVersion).toBe(0);
    expect(missing.conflict.currentValue).toBeUndefined();
    expect(await stores.session.get("s4")).toBeUndefined();
  });

  it("'any' unconditionally overwrites", async () => {
    await stores.session.set("s5", makeSession("s5", 0), "any");
    await stores.session.set(
      "s5",
      makeSession("s5", 42, { overwrite: true }),
      "any"
    );
    const fetched = await stores.session.get("s5");
    expect(fetched?.version).toBe(42);
    expect(fetched?.state).toEqual({ overwrite: true });
  });

  it("cross-registry conflict: two SQLiteStoreRegistry instances sharing a DB file detect the race", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "fsd-sqlite-cas-"));
    const filename = join(dir, "test.db");
    // Close the :memory: registry from beforeEach — this test uses its own.
    stores.close();
    const registryA = createSQLiteStores({ filename });
    const registryB = createSQLiteStores({ filename });
    // Reassign so the afterEach close() targets a live registry.
    stores = registryA;

    try {
      await registryA.session.set("shared", makeSession("shared", 0), "any");

      const snapshot = await registryA.session.get("shared");
      expect(snapshot?.version).toBe(0);

      // Both see version 0; B wins the race by writing first.
      const bWrite = await registryB.session.set(
        "shared",
        makeSession("shared", 1, { from: "B" }),
        0
      );
      expect(bWrite.ok).toBe(true);

      // A still holds the stale view and tries to write with expectedVersion=0.
      const aWrite = await registryA.session.set(
        "shared",
        makeSession("shared", 1, { from: "A" }),
        0
      );
      expect(aWrite.ok).toBe(false);
      if (aWrite.ok) throw new Error("unreachable");
      expect(aWrite.conflict.currentVersion).toBe(1);
      expect(aWrite.conflict.currentValue?.state).toEqual({ from: "B" });

      // Retry with the correct expectedVersion succeeds.
      const aRetry = await registryA.session.set(
        "shared",
        makeSession("shared", 2, { from: "A-retry" }),
        1
      );
      expect(aRetry).toEqual({ ok: true, version: 2 });
    } finally {
      registryB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
