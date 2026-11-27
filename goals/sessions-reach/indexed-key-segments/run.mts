/**
 * Goal check: every prefix read in both SQL stores is answered from an index
 * range on the key, on the same rows it returned before.
 *
 * Model-free. Seeds one scope with many rows across many collection prefixes
 * in a real Postgres (on a database with a language collation, as production
 * runs, when the server can make one) and in SQLite, then calls each store's
 * own `getByPrefix` and reads two things back:
 *
 * - the database's own plan for the statement that call sent (`EXPLAIN
 *   ANALYZE` in Postgres, `EXPLAIN QUERY PLAN` in SQLite), never the SQL
 *   text: a query that names no function can still scan;
 * - the rows it returned, against the seed's own `startsWith`, and, for a
 *   corpus of awkward keys, against the filesystem store's rows.
 *
 * Run: pnpm tsx goals/sessions-reach/indexed-key-segments/run.mts
 *      GOAL_FIXTURE=alternate.json pnpm tsx goals/sessions-reach/indexed-key-segments/run.mts
 */
import { join } from "node:path";
import Database from "better-sqlite3";
import pg from "pg";
import type { ContentStore, ResourceStateStore } from "@flow-state-dev/engine/host";
import {
  createFilesystemContentStore,
  createFilesystemResourceStateStore
} from "@flow-state-dev/engine/host";
import {
  createPostgresContentStore,
  createPostgresResourceStateStore,
  initializeSchema,
  type QueryExecutor
} from "@flow-state-dev/store-postgres/host";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite/host";
import { goalTmpDir, loadFixture, runGoal, type Tell } from "../../lib/index.mts";
import { startPostgres } from "../../lib/postgres.mts";

type Fixture = {
  rows: number;
  collections: number;
  /** A collection's prefix, `{n}` the collection's number. */
  collectionPrefix: string;
  /** A row's key under its prefix, `{i}` the row's number. */
  keyLeaf: string;
  specialKeys: string[];
  specialPrefixes: string[];
};

const fixture = loadFixture<Fixture>(import.meta.url, process.env.GOAL_FIXTURE ?? "default.json");
const OWNER = "goal-owner";
const SPECIALS = "goal-specials";
const TABLES = ["resource_state", "resource_content"] as const;
type Table = (typeof TABLES)[number];

const [prefixHead, prefixTail] = splitAt(fixture.collectionPrefix, "{n}");
const [leafHead, leafTail] = splitAt(fixture.keyLeaf, "{i}");
const collectionPrefix = (n: number): string => `${prefixHead}${n}${prefixTail}`;
const keyOf = (i: number): string => `${collectionPrefix(i % fixture.collections)}${leafHead}${i}${leafTail}`;

function splitAt(template: string, slot: string): [string, string] {
  const at = template.indexOf(slot);
  if (at < 0) throw new Error(`fixture template ${JSON.stringify(template)} has no ${slot}`);
  return [template.slice(0, at), template.slice(at + slot.length)];
}

/** How many seeded rows sit under collection `n`. */
function seededUnder(n: number): number {
  let count = 0;
  for (let i = 0; i < fixture.rows; i++) if (i % fixture.collections === n) count++;
  return count;
}

const expectedSpecials = (prefix: string): string[] =>
  fixture.specialKeys.filter((k) => k.startsWith(prefix)).sort();

/** Both stores of one backend, and how to read the plan of the read it last sent. */
type Backend = {
  name: string;
  state: ResourceStateStore;
  content: ContentStore;
  /** Grade the plan of the one statement the last `getByPrefix` sent; returns failures. */
  planOfLastRead(table: Table, returned: number): Promise<string[]>;
  /** Backend-specific checks on the schema the stores built. */
  schemaChecks(failures: string[], tell: Tell): Promise<void>;
  close(): Promise<void>;
};

// --- Postgres --------------------------------------------------------------

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  Plans?: PlanNode[];
};

function flatten(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node);
  for (const child of node.Plans ?? []) flatten(child, out);
  return out;
}

async function postgresBackend(collationNote: string[]): Promise<Backend> {
  const server = await startPostgres({ slug: "indexed-key-segments" });
  // A database in a language collation, as production runs: there the primary
  // key on `resource_key` cannot answer a byte-order range, so only the
  // byte-order index can. When the server can't make one, run on its default
  // and say so in the evidence.
  let url = server.url;
  const dbName = `goal_keys_${Date.now()}`;
  try {
    await server.query(
      `CREATE DATABASE ${dbName} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C.UTF-8'`
    );
    const parsed = new URL(server.url);
    parsed.pathname = `/${dbName}`;
    url = parsed.toString();
  } catch (err) {
    collationNote.push(`no ICU database (${(err as Error).message}); ran on the server default`);
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const sent: Array<{ text: string; values: unknown[] }> = [];
  const executor: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      sent.push({ text, values: values ?? [] });
      const result = await pool.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    }
  };
  await initializeSchema(executor);
  const collation = await pool.query<{ datcollate: string; datlocprovider: string; daticulocale: string | null }>(
    "SELECT datcollate, datlocprovider, daticulocale FROM pg_database WHERE datname = current_database()"
  );
  const db = collation.rows[0];
  collationNote.push(
    `postgres database collation: ${db?.datlocprovider === "i" ? `icu ${db.daticulocale}` : db?.datcollate}`
  );

  for (const table of TABLES) {
    const payload = table === "resource_state" ? "state" : "content";
    const value = table === "resource_state" ? `'{"n":1}'::jsonb` : `'body'`;
    await pool.query(
      `INSERT INTO ${table} (scope_type, scope_id, resource_key, ${payload})
       SELECT 'user', $1, $2 || (g % $3) || $4 || $5 || g || $6, ${value}
       FROM generate_series(0, $7 - 1) g`,
      [OWNER, prefixHead, fixture.collections, prefixTail, leafHead, leafTail, fixture.rows]
    );
    await pool.query(`ANALYZE ${table}`);
  }

  return {
    name: "postgres",
    state: createPostgresResourceStateStore(executor),
    content: createPostgresContentStore(executor),
    async planOfLastRead(table, returned) {
      const read = [...sent].reverse().find((q) => q.text.includes(`FROM ${table}`) && q.text.startsWith("SELECT"));
      if (read === undefined) return ["no prefix read reached Postgres"];
      sent.length = 0;
      const explained = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${read.text}`, read.values);
      const root = (explained.rows[0]?.["QUERY PLAN"] as Array<{ Plan: PlanNode }>)[0]!.Plan;
      const nodes = flatten(root);
      const shape = nodes.map((n) => `${n["Node Type"]}${n["Index Name"] ? `(${n["Index Name"]})` : ""}`).join(" > ");
      const failures: string[] = [];
      if (nodes.some((n) => n["Node Type"] === "Seq Scan")) failures.push(`scans the table: ${shape}`);
      const ranges = nodes.filter((n) => n["Index Name"] !== undefined && (n["Index Cond"] ?? "").includes("resource_key"));
      if (ranges.length === 0) failures.push(`no index range on the key: ${shape}`);
      const removed = nodes.reduce(
        (sum, n) => sum + ((n["Rows Removed by Filter"] ?? 0) + (n["Rows Removed by Index Recheck"] ?? 0)) * (n["Actual Loops"] ?? 1),
        0
      );
      if (removed > 0) failures.push(`read and discarded ${removed} rows of the scope: ${shape}`);
      const walked = Math.max(0, ...ranges.map((n) => (n["Actual Rows"] ?? 0) * (n["Actual Loops"] ?? 1)));
      if (ranges.length > 0 && walked !== returned) failures.push(`the index walked ${walked} rows for ${returned} returned: ${shape}`);
      return failures;
    },
    async schemaChecks(failures, tell) {
      // (d) The key column keeps the database's collation on every resource
      // table, so no `ORDER BY resource_key` and no join on the key changes;
      // the byte-order indexes are built and valid; the scope indexes are gone.
      const columns = await pool.query<{ table: string; collation: string }>(
        `SELECT c.relname AS table, coalesce(co.collname, '') AS collation
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         LEFT JOIN pg_collation co ON co.oid = a.attcollation
         WHERE c.relname IN ('resource_state', 'resource_content', 'resource_index') AND a.attname = 'resource_key'`
      );
      for (const col of tell.over("collation · resource_key columns", columns.rows)) {
        if (col.collation !== "default") failures.push(`collation:${col.table}: resource_key is ${col.collation}, want the database default`);
      }
      const indexes = await pool.query<{ name: string; valid: boolean }>(
        `SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname IN ('idx_resource_state_key', 'idx_resource_content_key', 'idx_resource_state_scope', 'idx_resource_content_scope')`
      );
      const byName = new Map(indexes.rows.map((r) => [r.name, r.valid]));
      for (const name of ["idx_resource_state_key", "idx_resource_content_key"]) {
        if (byName.get(name) !== true) failures.push(`index:${name}: ${byName.has(name) ? "invalid" : "missing"}`);
      }
      for (const name of ["idx_resource_state_scope", "idx_resource_content_scope"]) {
        if (byName.has(name)) failures.push(`index:${name}: still present`);
      }
    },
    async close() {
      await pool.end();
      await server.stop();
    }
  };
}

// --- SQLite ----------------------------------------------------------------

async function sqliteBackend(dir: string): Promise<Backend> {
  const file = join(dir, "keys.sqlite");
  const stores = createSQLiteStores({ filename: file });
  const db = new Database(file);

  // The statement each read ran, as SQLite was handed it: recorded off every
  // statement's `all`, so the plan graded is of the store's own SQL.
  const ran: Array<{ source: string; args: unknown[] }> = [];
  const statementProto = Object.getPrototypeOf(db.prepare("SELECT 1")) as {
    all: (...args: unknown[]) => unknown[];
  };
  const all = statementProto.all;
  statementProto.all = function (this: { source: string }, ...args: unknown[]) {
    ran.push({ source: this.source, args });
    return all.apply(this, args);
  };

  const insertState = db.prepare(
    "INSERT INTO resource_state (scope_type, scope_id, resource_key, state) VALUES ('user', ?, ?, '{\"n\":1}')"
  );
  const insertContent = db.prepare(
    "INSERT INTO resource_content (scope_type, scope_id, resource_key, content) VALUES ('user', ?, ?, 'body')"
  );
  db.transaction(() => {
    for (let i = 0; i < fixture.rows; i++) {
      insertState.run(OWNER, keyOf(i));
      insertContent.run(OWNER, keyOf(i));
    }
  })();

  return {
    name: "sqlite",
    state: stores.resourceState,
    content: stores.content,
    async planOfLastRead(table) {
      const read = [...ran].reverse().find((q) => q.source.includes(`FROM ${table}`) && q.source.includes("resource_key"));
      if (read === undefined) return ["no prefix read reached SQLite"];
      ran.length = 0;
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${read.source}`).all(...read.args) as Array<{ detail: string }>;
      const shape = plan.map((p) => p.detail).join(" | ");
      const failures: string[] = [];
      if (plan.some((p) => /^SCAN /.test(p.detail))) failures.push(`scans the table: ${shape}`);
      if (!plan.some((p) => /^SEARCH .*\(.*resource_key>/.test(p.detail))) {
        failures.push(`no index range on the key: ${shape}`);
      }
      return failures;
    },
    async schemaChecks() {
      // SQLite compares text in BINARY order already: nothing in its schema changes.
    },
    async close() {
      statementProto.all = all;
      db.close();
      stores.close();
    }
  };
}

// --- the check -------------------------------------------------------------

async function readKeys(backend: Backend, table: Table, scope: string, prefix: string): Promise<string[]> {
  const rows =
    table === "resource_state"
      ? await backend.state.getByPrefix("user", scope, prefix)
      : await backend.content.getByPrefix("user", scope, prefix);
  return Object.keys(rows).sort();
}

async function seedSpecials(state: ResourceStateStore, content: ContentStore): Promise<void> {
  for (const [i, key] of fixture.specialKeys.entries()) {
    const written = await state.set("user", SPECIALS, key, { n: i }, 0);
    if (!written.ok) throw new Error(`seed of ${key} conflicted`);
    await content.set("user", SPECIALS, key, `body-${i}`);
  }
}

async function gradeBackend(backend: Backend, failures: string[], tell: Tell): Promise<number> {
  let reads = 0;
  // (a) every collection's read is an index range on the key, on its own rows.
  for (const table of TABLES) {
    const graded = tell.over(
      `plan:${backend.name}:${table} · collections read`,
      Array.from({ length: fixture.collections }, (_, n) => n)
    );
    for (const n of graded) {
      const prefix = collectionPrefix(n);
      const keys = await readKeys(backend, table, OWNER, prefix);
      reads++;
      const want = seededUnder(n);
      if (keys.length !== want || keys.some((k) => !k.startsWith(prefix))) {
        failures.push(`rows:${backend.name}:${table}:${prefix}: ${keys.length} rows, want ${want} all under the prefix`);
      }
      for (const f of await backend.planOfLastRead(table, keys.length)) {
        failures.push(`plan:${backend.name}:${table}:${prefix}: ${f}`);
      }
    }
  }
  // (b) awkward keys: the rows a prefix returns are exactly the keys starting with it.
  await seedSpecials(backend.state, backend.content);
  for (const table of TABLES) {
    for (const prefix of tell.over(`rows:${backend.name}:${table} · awkward prefixes`, fixture.specialPrefixes)) {
      const keys = await readKeys(backend, table, SPECIALS, prefix);
      const want = expectedSpecials(prefix);
      if (JSON.stringify(keys) !== JSON.stringify(want)) {
        failures.push(`rows:${backend.name}:${table}:${JSON.stringify(prefix)}: got ${JSON.stringify(keys)}, want ${JSON.stringify(want)}`);
      }
    }
  }
  return reads;
}

await runGoal(async (failures, tell) => {
  const dir = goalTmpDir("indexed-key-segments");
  const notes: string[] = [];

  // (c) the filesystem store's rows for the awkward corpus: what the SQL stores must match.
  const fsState = createFilesystemResourceStateStore(join(dir, "fs"));
  const fsContent = createFilesystemContentStore(join(dir, "fs"));
  await seedSpecials(fsState, fsContent);
  const filesystem: Record<string, string[]> = {};
  for (const prefix of fixture.specialPrefixes) {
    filesystem[`resource_state:${prefix}`] = Object.keys(await fsState.getByPrefix("user", SPECIALS, prefix)).sort();
    filesystem[`resource_content:${prefix}`] = Object.keys(await fsContent.getByPrefix("user", SPECIALS, prefix)).sort();
  }

  let reads = 0;
  for (const make of [() => postgresBackend(notes), () => sqliteBackend(dir)]) {
    const backend = await make();
    try {
      reads += await gradeBackend(backend, failures, tell);
      for (const table of TABLES) {
        for (const prefix of fixture.specialPrefixes) {
          const keys = await readKeys(backend, table, SPECIALS, prefix);
          if (JSON.stringify(keys) !== JSON.stringify(filesystem[`${table}:${prefix}`])) {
            failures.push(`same-as-filesystem:${backend.name}:${table}:${JSON.stringify(prefix)}: got ${JSON.stringify(keys)}, filesystem ${JSON.stringify(filesystem[`${table}:${prefix}`])}`);
          }
        }
      }
      await backend.schemaChecks(failures, tell);
    } finally {
      await backend.close();
    }
  }

  return {
    failures,
    evidence: `${reads} collection reads over ${fixture.rows} rows × ${fixture.collections} prefixes per table, each an index range on the key with no row of the scope discarded; awkward prefixes match the filesystem store on both SQL stores; ${notes.join("; ")}`
  };
});
