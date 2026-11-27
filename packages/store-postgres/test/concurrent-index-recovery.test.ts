/**
 * Recovery from an interrupted concurrent index build.
 *
 * `CREATE INDEX CONCURRENTLY` exists so an upgrade never blocks reads or
 * writes on a populated table. An interrupted build leaves the index behind
 * marked invalid, and `IF NOT EXISTS` would then skip it forever, so schema
 * init drops it and builds it again. That drop must be concurrent too: a plain
 * `DROP INDEX` takes an ACCESS EXCLUSIVE lock on the table, which blocks every
 * read and write on exactly the large tables the concurrent build was there to
 * spare.
 *
 * PGlite is the Postgres engine, so `UPDATE pg_index SET indisvalid = false`
 * leaves a real invalid index for init to find.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";
import { initializeSchema, type QueryExecutor } from "../src/host";

function recordingExecutor(pglite: PGlite): QueryExecutor & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async query(text: string, values?: unknown[]) {
      sent.push(text);
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

async function markInvalid(pglite: PGlite, index: string): Promise<void> {
  await pglite.query("UPDATE pg_index SET indisvalid = false WHERE indexrelid = $1::regclass", [index]);
}

async function validity(pglite: PGlite, index: string): Promise<boolean | undefined> {
  const result = await pglite.query<{ indisvalid: boolean }>(
    `SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
     WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace`,
    [index]
  );
  return result.rows[0]?.indisvalid;
}

/** Every statement that drops an index, whether or not it is concurrent. */
function drops(sent: string[]): string[] {
  return sent.filter((text) => /DROP\s+INDEX/i.test(text));
}

describe("schema init: an index left invalid by an interrupted concurrent build", () => {
  it("drops it concurrently, never with a plain DROP INDEX, and builds it again", async () => {
    const pglite = await freshPglite();
    await initializeSchema(recordingExecutor(pglite));
    // One of the resource-key indexes and one of the older session indexes.
    await markInvalid(pglite, "idx_resource_state_key");
    await markInvalid(pglite, "idx_sessions_parent_created");
    expect(await validity(pglite, "idx_resource_state_key")).toBe(false);

    const executor = recordingExecutor(pglite);
    await initializeSchema(executor);

    expect(drops(executor.sent)).toContain('DROP INDEX CONCURRENTLY IF EXISTS "idx_resource_state_key"');
    expect(drops(executor.sent)).toContain('DROP INDEX CONCURRENTLY IF EXISTS "idx_sessions_parent_created"');
    // A plain drop locks the whole table against reads and writes.
    expect(drops(executor.sent).filter((text) => !/DROP\s+INDEX\s+CONCURRENTLY/i.test(text))).toEqual([]);
    expect(await validity(pglite, "idx_resource_state_key")).toBe(true);
    expect(await validity(pglite, "idx_sessions_parent_created")).toBe(true);
  });

  it("drops nothing on a healthy database beyond the retired scope indexes", async () => {
    const pglite = await freshPglite();
    await initializeSchema(recordingExecutor(pglite));

    const executor = recordingExecutor(pglite);
    await initializeSchema(executor);

    expect(drops(executor.sent)).toEqual([
      "DROP INDEX CONCURRENTLY IF EXISTS idx_resource_state_scope",
      "DROP INDEX CONCURRENTLY IF EXISTS idx_resource_content_scope"
    ]);
  });
});
