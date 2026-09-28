/**
 * The cost of the two ordered reads the session stream repeats about once a
 * second per open view: a page of one session's requests, and a page of one
 * parent's runs, each newest-updated first.
 *
 * The stream promises each read costs what changed, not the session's
 * history. That holds only if the database walks the followed session's own
 * rows in update order and stops at the page limit. Otherwise it either sorts
 * the session's whole history, or walks the global update-time index through
 * every other session's newer rows. So the check is a differential: give the
 * session a long history and the database a burst of activity elsewhere, and
 * neither read may examine or discard more rows than before.
 *
 * The followed session is a small share of a large table, as in production.
 * On a toy table the planner rightly prefers the global walk, and the check
 * would measure the fixture rather than the schema.
 *
 * A caller bound to a tenant is measured too, as `list-option-widenings.test.ts`
 * measures the child listing's (its axis 4): a session id comes off the URL, so
 * two tenants can reuse one, and one tenant's activity must not grow the other's
 * reads. So is another owner's activity under the followed session's ids: a
 * session id can be deleted and used again, and a request under it that its
 * owner never made is refused but kept, so rows under the id that the reads
 * exclude can be many, and newer than every row they return.
 *
 * Measured through the store, on the SQL it emits for the options the stream
 * itself sends (`sessionStreamReads`), as `list-option-widenings.test.ts`
 * measures the child listing.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SessionRecord } from "@flow-state-dev/engine";
import { sessionStreamReads } from "@flow-state-dev/engine/testing";
import { freshPglite } from "./shared-pglite";
import { createPostgresStores, initializeSchema, type PostgresStoreRegistry } from "../src";
import type { QueryExecutor } from "../src";

type PlanNode = {
  "Node Type": string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

type Measurement = { rows: number; removed: number; plan: string };

function walk(node: PlanNode, acc: Measurement): Measurement {
  const loops = node["Actual Loops"] ?? 1;
  acc.rows += (node["Actual Rows"] ?? 0) * loops;
  acc.removed += (node["Rows Removed by Filter"] ?? 0) * loops;
  const index = node["Index Name"] === undefined ? "" : `(${node["Index Name"]})`;
  acc.plan = `${acc.plan} ${node["Node Type"]}${index}`;
  for (const child of node.Plans ?? []) walk(child, acc);
  return acc;
}

/** A session the stream follows, as the route read it: alice's, in org `org_a`. */
function followed(id: string, tenantId: string | undefined): SessionRecord {
  return {
    id: tenantId === undefined ? id : `${tenantId}:${id}`,
    flowKind: "chat",
    userId: "alice",
    orgId: "org_a",
    tenantId,
    state: {},
    version: 0,
    createdAt: 0,
    updatedAt: 0,
    journal: []
  };
}

/**
 * The two reads, as the stream sends them: for `target`, followed by a caller
 * bound to no tenant, and for `bound`, followed by a caller bound to `acme`.
 * The route refuses a session without an org before streaming, so both name
 * one.
 */
const SHAPES = {
  recentRequests: (store: PostgresStoreRegistry) =>
    store.request.list(sessionStreamReads.recentRequests("target", followed("target", undefined), undefined, 20)),
  recentRuns: (store: PostgresStoreRegistry) =>
    store.session.list(sessionStreamReads.recentRuns("target", followed("target", undefined), undefined, 20)),
  recentRequestsBound: (store: PostgresStoreRegistry) =>
    store.request.list(sessionStreamReads.recentRequests("bound", followed("bound", "acme"), "acme", 20)),
  recentRunsBound: (store: PostgresStoreRegistry) =>
    store.session.list(sessionStreamReads.recentRuns("bound", followed("bound", "acme"), "acme", 20))
} as const;

type ShapeName = keyof typeof SHAPES;

/** The owner, tenant and org a batch of rows is kept under: alice's, in no tenant or org by default. */
type Scope = { user?: string; tenant?: string; org?: string };

interface Harness {
  /** Add `count` requests to `session`, and as many runs under `parent`, updated from `from` on. */
  add: (
    session: (i: string) => string,
    parent: (i: string) => string,
    from: number,
    count: number,
    scope?: Scope
  ) => Promise<void>;
  measure: (shape: ShapeName) => Promise<Measurement>;
}

async function harness(): Promise<Harness> {
  const db: PGlite = await freshPglite();
  const direct: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      const result = await db.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
  await initializeSchema(direct);

  // Record what the store sends so the measurement explains the store's own SQL.
  const sent: Array<{ sql: string; params: unknown[] }> = [];
  const recording: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      sent.push({ sql: text, params: values ?? [] });
      return direct.query(text, values);
    }
  };
  const stores = await createPostgresStores({ executor: recording, skipSchemaInit: true });

  let batch = 0;
  const add: Harness["add"] = async (session, parent, from, count, scope = {}) => {
    const tag = `b${batch++}`;
    const user = `'${scope.user ?? "alice"}'`;
    const tenant = scope.tenant === undefined ? "NULL" : `'${scope.tenant}'`;
    const org = scope.org === undefined ? "NULL" : `'${scope.org}'`;
    // `g` is the row's number in this batch; the callers turn it into ids.
    await db.query(
      `INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, tenant_id, status, version, created_at, updated_at, data)
       SELECT '${tag}_r_' || g, 'chat', ${user}, ${session("g")}, ${org}, ${tenant}, 'completed', 0, ${from} + g, ${from} + g, '{}'::jsonb
       FROM generate_series(0, ${count - 1}) AS g`
    );
    await db.query(
      `INSERT INTO sessions (id, flow_kind, user_id, org_id, tenant_id, parent_session_id, version, created_at, updated_at, data)
       SELECT '${tag}_s_' || g, 'chat', ${user}, ${org}, ${tenant}, ${parent("g")}, 0, ${from} + g, ${from} + g, '{}'::jsonb
       FROM generate_series(0, ${count - 1}) AS g`
    );
  };
  const measure = async (shape: ShapeName): Promise<Measurement> => {
    await db.query("ANALYZE");
    sent.length = 0;
    await SHAPES[shape](stores);
    const issued = sent.filter((s) => s.sql.trimStart().toUpperCase().startsWith("SELECT"));
    expect(issued).toHaveLength(1);
    const { sql, params } = issued[0]!;
    const result = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
    const plan = (result.rows[0] as { "QUERY PLAN": Array<{ Plan: PlanNode }> })["QUERY PLAN"][0]!.Plan;
    return walk(plan, { rows: 0, removed: 0, plan: "" });
  };

  // The followed session holds more than a page of recent rows, so every read
  // returns a full page before and after and only the work behind it can move.
  await add(() => "'target'", () => "'target'", 50_000, 30, { org: "org_a" });
  // The same for the caller bound to `acme`.
  await add(() => "'bound'", () => "'bound'", 50_000, 30, { tenant: "acme", org: "org_a" });
  // Everyone else: 5,000 sessions and parents, 200,000 rows each table,
  // interleaved in time with the followed session's. Under the same owner
  // and org, half in no tenant and half in `acme`, as one org's sessions are:
  // so the session or parent id is what picks the followed rows out, and an
  // index on the owner or org alone does not.
  await add((g) => `'noise_' || (${g} % 5000)`, (g) => `'pnoise_' || (${g} % 5000)`, -50_000, 100_000, { org: "org_a" });
  await add((g) => `'noise_' || (${g} % 5000)`, (g) => `'pnoise_' || (${g} % 5000)`, -50_000, 100_000, {
    tenant: "acme",
    org: "org_a"
  });
  return { add, measure };
}

/** Assert each read examines and discards no more rows now than `before`. */
async function expectNoGrowth(h: Harness, before: Map<ShapeName, Measurement>): Promise<void> {
  for (const [shape, was] of before) {
    const now = await h.measure(shape);
    const seen = `${shape}: before ${JSON.stringify(was)}, after ${JSON.stringify(now)}`;
    // Not equality: on the baseline the planner may sort a handful of rows
    // rather than walk an index, and a cheaper plan afterwards is not the
    // failure this looks for.
    expect.soft(now.rows, seen).toBeLessThanOrEqual(was.rows);
    expect.soft(now.removed, seen).toBeLessThanOrEqual(was.removed);
  }
}

describe("Postgres cost of the session stream's reads", () => {
  it("a caller bound to a tenant: its own long history, and another tenant's newer rows under the same ids, move neither read", async () => {
    const h = await harness();
    const shapes: ShapeName[] = ["recentRequestsBound", "recentRunsBound"];
    const before = new Map<ShapeName, Measurement>();
    for (const shape of shapes) before.set(shape, await h.measure(shape));

    // The caller's own history: older than every row the reads return.
    await h.add(() => "'bound'", () => "'bound'", 10_000, 500, { tenant: "acme", org: "org_a" });
    // Another customer reusing the same ids, busy now: newer than everything
    // above, so a walk that cannot skip them by index meets them first.
    await h.add(() => "'bound'", () => "'bound'", 100_500, 250, { tenant: "other", org: "org_a" });

    await expectNoGrowth(h, before);
  }, 60_000);

  it("a long history in the followed session, and a burst of activity elsewhere, move neither read", async () => {
    const h = await harness();
    const shapes: ShapeName[] = ["recentRequests", "recentRuns"];
    const before = new Map<ShapeName, Measurement>();
    for (const shape of shapes) before.set(shape, await h.measure(shape));

    // History the reads must not pay for: older than every row they return.
    await h.add(() => "'target'", () => "'target'", 10_000, 500, { org: "org_a" });
    // Activity elsewhere, newer than the followed session's.
    await h.add((g) => `'busy_' || (${g} % 25)`, (g) => `'pbusy_' || (${g} % 25)`, 100_000, 500, { org: "org_a" });

    await expectNoGrowth(h, before);
  }, 60_000);

  // Rows under the followed ids that another owner, or its own owner acting
  // for another org, keeps: newer than every row the reads return, so a walk
  // that cannot skip them by index meets them first.
  it.each([
    ["no tenant", "recentRequests", "recentRuns", "target", undefined],
    ["a tenant", "recentRequestsBound", "recentRunsBound", "bound", "acme"]
  ] as const)(
    "a caller bound to %s: another owner's newer rows under the followed ids move neither read",
    async (_bound, requests, runs, id, tenant) => {
      const h = await harness();
      const before = new Map<ShapeName, Measurement>();
      for (const shape of [requests, runs]) before.set(shape, await h.measure(shape));

      await h.add(() => `'${id}'`, () => `'${id}'`, 100_000, 250, { user: "mallory", tenant, org: "org_a" });
      await h.add(() => `'${id}'`, () => `'${id}'`, 100_250, 250, { tenant, org: "globex" });

      await expectNoGrowth(h, before);
    },
    60_000
  );
});
