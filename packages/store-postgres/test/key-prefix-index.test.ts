/**
 * A prefix read (`getByPrefix`) walks an index range on the key to the
 * collection's rows and stops after its last, instead of comparing a function
 * of every key in the scope. And a database written before that change
 * upgrades in place: the byte-order key indexes are built, the scope indexes
 * they replace are dropped, and the rows already there are read by the range.
 *
 * The plan is read from the database (`EXPLAIN ANALYZE` on the statement the
 * store sent), not from the SQL text: a query that names no function can
 * still scan. PGlite's database compares in `C`, so this guards the shape of
 * the read; the language-collation case, where only the byte-order index can
 * answer the range, is the goal check under `goals/sessions-reach/`.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";
import {
  createPostgresContentStore,
  createPostgresResourceStateStore,
  initializeSchema,
  type QueryExecutor
} from "../src/host";

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Actual Rows"?: number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
};

function flatten(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node);
  for (const child of node.Plans ?? []) flatten(child, out);
  return out;
}

/** An executor that keeps the statements it sent, so a test can plan them. */
function recordingExecutor(pglite: PGlite): QueryExecutor & { sent: Array<{ text: string; values: unknown[] }> } {
  const sent: Array<{ text: string; values: unknown[] }> = [];
  return {
    sent,
    async query(text: string, values?: unknown[]) {
      sent.push({ text, values: values ?? [] });
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

const COLLECTIONS = 40;
const ROWS = 20_000;

async function seed(pglite: PGlite): Promise<void> {
  await pglite.exec(`
    INSERT INTO resource_state (scope_type, scope_id, resource_key, state)
      SELECT 'user', 'u1', 'tasks/c' || (g % ${COLLECTIONS}) || '/row-' || g, '{}'::jsonb
      FROM generate_series(0, ${ROWS - 1}) g;
    INSERT INTO resource_content (scope_type, scope_id, resource_key, content)
      SELECT 'user', 'u1', 'tasks/c' || (g % ${COLLECTIONS}) || '/row-' || g, 'body'
      FROM generate_series(0, ${ROWS - 1}) g;
    ANALYZE resource_state;
    ANALYZE resource_content;
  `);
}

async function indexNames(pglite: PGlite): Promise<string[]> {
  const result = await pglite.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE tablename IN ('resource_state', 'resource_content') ORDER BY indexname"
  );
  return result.rows.map((r) => r.indexname);
}

describe("Postgres prefix reads", () => {
  it.each(["resource_state", "resource_content"] as const)(
    "%s: walks an index range on the key to the collection's rows, discarding none of the scope's",
    async (table) => {
      const pglite = await freshPglite();
      const executor = recordingExecutor(pglite);
      await initializeSchema(executor);
      await seed(pglite);
      const store =
        table === "resource_state" ? createPostgresResourceStateStore(executor) : createPostgresContentStore(executor);

      executor.sent.length = 0;
      // `tasks/c1/` sits beside `tasks/c10/`…`tasks/c19/` in key order; none of them may come back.
      const rows = await store.getByPrefix("user", "u1", "tasks/c1/");
      expect(Object.keys(rows)).toHaveLength(ROWS / COLLECTIONS);
      expect(Object.keys(rows).every((k) => k.startsWith("tasks/c1/"))).toBe(true);

      const [read] = executor.sent;
      const explained = await pglite.query<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${read!.text}`,
        read!.values
      );
      const nodes = flatten(explained.rows[0]!["QUERY PLAN"][0]!.Plan);
      expect(nodes.map((n) => n["Node Type"])).not.toContain("Seq Scan");
      const range = nodes.find((n) => (n["Index Cond"] ?? "").includes("resource_key"));
      expect(range, JSON.stringify(nodes)).toBeDefined();
      expect(range!["Actual Rows"]).toBe(ROWS / COLLECTIONS);
      expect(nodes.reduce((sum, n) => sum + (n["Rows Removed by Filter"] ?? 0), 0)).toBe(0);
    }
  );

  it("upgrades a database written with the scope indexes: builds the key indexes, drops the scope ones, keeps the rows", async () => {
    const pglite = await freshPglite();
    const executor = recordingExecutor(pglite);
    // The schema as it stood before the range read: no key index, a scope index on each table.
    await initializeSchema(executor);
    await pglite.exec(`
      DROP INDEX idx_resource_state_key;
      DROP INDEX idx_resource_content_key;
      CREATE INDEX idx_resource_state_scope ON resource_state(scope_type, scope_id);
      CREATE INDEX idx_resource_content_scope ON resource_content(scope_type, scope_id);
    `);
    await seed(pglite);
    expect(await indexNames(pglite)).toEqual([
      "idx_resource_content_scope",
      "idx_resource_state_scope",
      "resource_content_pkey",
      "resource_state_pkey"
    ]);

    await initializeSchema(executor);

    expect(await indexNames(pglite)).toEqual([
      "idx_resource_content_key",
      "idx_resource_state_key",
      "resource_content_pkey",
      "resource_state_pkey"
    ]);
    const state = await createPostgresResourceStateStore(executor).getByPrefix("user", "u1", "tasks/c7/");
    const content = await createPostgresContentStore(executor).getByPrefix("user", "u1", "tasks/c7/");
    expect(Object.keys(state)).toHaveLength(ROWS / COLLECTIONS);
    expect(Object.keys(content)).toHaveLength(ROWS / COLLECTIONS);
  });
});
