/**
 * Tests for `createPostgresScheduleIndex` against a PGlite-backed
 * executor. Verifies the contract through the shared conformance suite.
 */
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";
import { describe, expect, it } from "vitest";
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";
import { createPostgresScheduleIndex } from "../src/schedule-index";
import { initializeSchema } from "../src/schema";
import type { QueryExecutor, TxClient } from "../src/types";

function pgliteExecutor(pg: PGlite): QueryExecutor {
  async function query(text: string, values?: unknown[]) {
    const result = await pg.query(text, values);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.affectedRows ?? 0
    };
  }
  return {
    query,
    async beginTx(): Promise<TxClient> {
      await query("BEGIN");
      let settled = false;
      return {
        query,
        async commit() {
          if (settled) return;
          settled = true;
          await query("COMMIT");
        },
        async rollback() {
          if (settled) return;
          settled = true;
          await query("ROLLBACK");
        }
      };
    }
  };
}

// Each conformance test gets this file's PGlite with an empty schema.
createScheduleIndexConformanceTests("postgres (pglite)", {
  async createIndex() {
    const pg = await freshPglite();
    const executor = pgliteExecutor(pg);
    await initializeSchema(executor);
    return createPostgresScheduleIndex(executor);
  }
});

/** The table as releases before the cell existed created it. */
async function seedLegacy(pg: PGlite, withOrgId = true): Promise<void> {
  await pg.exec(`
    CREATE TABLE schedule_index (
      user_id      TEXT NOT NULL,
      key          TEXT NOT NULL,
      ${withOrgId ? "org_id TEXT," : ""}
      cron         TEXT NOT NULL,
      timezone     TEXT,
      next_fire_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE INDEX idx_schedule_index_next_fire_at ON schedule_index (next_fire_at);
  `);
  for (const userId of ["alice", "a:b", "c\\d"]) {
    await pg.query(
      withOrgId
        ? "INSERT INTO schedule_index (user_id, key, org_id, cron, next_fire_at) VALUES ($1, 'weekly', 'acme', '0 9 * * MON', 1000)"
        : "INSERT INTO schedule_index (user_id, key, cron, next_fire_at) VALUES ($1, 'weekly', '0 9 * * MON', 1000)",
      [userId]
    );
  }
}

const FAR_FUTURE = Date.UTC(2100, 0, 1);

describe("upgrading a schedule index written before rows carried a cell (postgres)", () => {
  it("adopts every old row as its person's own cell, escaped the way the engine keys it", async () => {
    const pg = await freshPglite();
    await seedLegacy(pg);
    const executor = pgliteExecutor(pg);
    await initializeSchema(executor);

    const rows = await createPostgresScheduleIndex(executor).claimDue(FAR_FUTURE, 100);
    expect(rows.map((r) => [r.cell, r.userId, r.orgId, r.key]).sort()).toEqual([
      ["a\\:b", "a:b", "acme", "weekly"],
      ["alice", "alice", "acme", "weekly"],
      ["c\\\\d", "c\\d", "acme", "weekly"],
    ]);
    const pk = await pg.query<{ attname: string }>(
      `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'schedule_index'::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)`
    );
    expect(pk.rows.map((r) => r.attname)).toEqual(["cell", "key"]);
  });

  it("adopts a table old enough to have no organization column", async () => {
    const pg = await freshPglite();
    await seedLegacy(pg, false);
    const executor = pgliteExecutor(pg);
    await initializeSchema(executor);
    const rows = await createPostgresScheduleIndex(executor).claimDue(FAR_FUTURE, 100);
    expect(rows.map((r) => [r.cell, r.orgId]).sort()).toEqual([
      ["a\\:b", undefined],
      ["alice", undefined],
      ["c\\\\d", undefined],
    ]);
  });

  it("is a no-op on a second init, and an app-wide write updates the adopted row in place", async () => {
    const pg = await freshPglite();
    await seedLegacy(pg);
    const executor = pgliteExecutor(pg);
    await initializeSchema(executor);
    const snapshot = async () =>
      (await pg.query("SELECT * FROM schedule_index ORDER BY cell")).rows;
    const before = await snapshot();
    await initializeSchema(executor);
    expect(await snapshot()).toEqual(before);

    // The engine keys `a:b`'s own cell as `a\:b`; its next write lands on the
    // adopted row rather than beside it.
    await createPostgresScheduleIndex(executor).upsert({
      cell: "a\\:b",
      userId: "a:b",
      orgId: "acme",
      key: "weekly",
      cron: "0 9 * * MON",
      nextFireAt: 2000,
    });
    const after = (await pg.query<{ cell: string; next_fire_at: string }>(
      "SELECT cell, next_fire_at FROM schedule_index ORDER BY cell"
    )).rows;
    expect(after.map((r) => [r.cell, Number(r.next_fire_at)])).toEqual([
      ["a\\:b", 2000],
      ["alice", 1000],
      ["c\\\\d", 1000],
    ]);
  });
});
