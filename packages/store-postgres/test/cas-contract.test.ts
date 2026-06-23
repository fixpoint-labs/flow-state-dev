/**
 * Postgres adapter compliance with the Store CAS contract (FIX-400).
 *
 * Mirrors the sqlite `cas-contract.test.ts` matrix: happy path, unconditional
 * "any", version-mismatch conflict, missing-record conflict, and cross-
 * registry race on a shared backing database.
 */

import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { SessionRecord } from "@flow-state-dev/engine";
import { createPostgresStores, type PostgresStoreRegistry } from "../src";
import type { QueryExecutor } from "../src";

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

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

describe("Postgres adapter — Store CAS contract", () => {
  let stores: PostgresStoreRegistry;
  let pglite: PGlite;

  afterEach(async () => {
    await stores?.close();
    await pglite?.close();
  });

  async function freshStores(): Promise<PostgresStoreRegistry> {
    pglite = new PGlite();
    const executor = pgliteExecutor(pglite);
    stores = await createPostgresStores({ executor });
    return stores;
  }

  it("writes a new record when expectedVersion is 0", async () => {
    const s = await freshStores();
    const result = await s.session.set("s1", makeSession("s1", 0, { initial: true }), 0);
    expect(result).toEqual({ ok: true, version: 0 });
    expect((await s.session.get("s1"))?.state).toEqual({ initial: true });
  });

  it("updates when expectedVersion matches stored version", async () => {
    const s = await freshStores();
    await s.session.set("s2", makeSession("s2", 0), "any");
    const bumped = await s.session.set(
      "s2",
      makeSession("s2", 1, { bumped: true }),
      0
    );
    expect(bumped).toEqual({ ok: true, version: 1 });
    const fetched = await s.session.get("s2");
    expect(fetched?.version).toBe(1);
    expect(fetched?.state).toEqual({ bumped: true });
  });

  it("reports conflict with current value/version on version mismatch", async () => {
    const s = await freshStores();
    await s.session.set("s3", makeSession("s3", 0), "any");
    await s.session.set("s3", makeSession("s3", 1, { v: 1 }), 0);

    const stale = await s.session.set(
      "s3",
      makeSession("s3", 2, { stale: true }),
      0
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("unreachable");
    expect(stale.conflict.currentVersion).toBe(1);
    expect(stale.conflict.currentValue?.state).toEqual({ v: 1 });
    expect((await s.session.get("s3"))?.state).toEqual({ v: 1 });
  });

  it("conflict surfaces when expectedVersion exceeds a missing record's version", async () => {
    const s = await freshStores();
    const missing = await s.session.set("s4", makeSession("s4", 6), 5);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.conflict.currentVersion).toBe(0);
    expect(missing.conflict.currentValue).toBeUndefined();
    expect(await s.session.get("s4")).toBeUndefined();
  });

  it("'any' unconditionally overwrites", async () => {
    const s = await freshStores();
    await s.session.set("s5", makeSession("s5", 0), "any");
    await s.session.set("s5", makeSession("s5", 42, { overwrite: true }), "any");
    const fetched = await s.session.get("s5");
    expect(fetched?.version).toBe(42);
    expect(fetched?.state).toEqual({ overwrite: true });
  });

  it("cross-registry conflict: two registries sharing the DB detect the race", async () => {
    // Single PGlite backing both registries — simulates two nodes.
    pglite = new PGlite();
    const executor = pgliteExecutor(pglite);
    const registryA = await createPostgresStores({ executor });
    const registryB = await createPostgresStores({ executor });
    stores = registryA;

    await registryA.session.set("shared", makeSession("shared", 0), "any");

    // B wins the race first.
    const bWrite = await registryB.session.set(
      "shared",
      makeSession("shared", 1, { from: "B" }),
      0
    );
    expect(bWrite.ok).toBe(true);

    // A holds a stale view and writes with expectedVersion=0.
    const aWrite = await registryA.session.set(
      "shared",
      makeSession("shared", 1, { from: "A" }),
      0
    );
    expect(aWrite.ok).toBe(false);
    if (aWrite.ok) throw new Error("unreachable");
    expect(aWrite.conflict.currentVersion).toBe(1);
    expect(aWrite.conflict.currentValue?.state).toEqual({ from: "B" });

    const aRetry = await registryA.session.set(
      "shared",
      makeSession("shared", 2, { from: "A-retry" }),
      1
    );
    expect(aRetry).toEqual({ ok: true, version: 2 });

    // Don't close registryB twice (afterEach closes registryA via `stores`).
    await registryB.close();
  });
});
