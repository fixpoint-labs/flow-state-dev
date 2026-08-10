/**
 * FIX-1010 on the Postgres adapter: the list-option widenings, and the cost
 * property the two ordered reads must hold.
 *
 * The behaviour matrix mirrors `packages/engine/test/list-option-widenings.test.ts`
 * case for case. This adapter cannot import the shared predicates (type-only
 * package boundary), so it reproduces them in its `WHERE` and `ORDER BY`
 * builders — an adapter that diverges is the exact failure this coverage
 * exists to catch.
 *
 * **The cost gate is a differential, not a plan artifact.** Measure a shape,
 * add 500 rows of history, measure again, and assert the measurement did not
 * move. That is the property directly; every proxy for it has been wrong.
 * "No `Sort` node" is unsatisfiable for the two legitimately ordered shapes.
 * "`Rows Removed by Filter` = 0" is unmeasurable, because with `LIMIT 1` an
 * ordered scan stops at the first qualifying row and never examines excluded
 * rows that sort later, so the counter reads zero whatever the plan does. And
 * asserting that an index *exists* proves nothing — Postgres is precisely the
 * case where one exists and is declined.
 *
 * Postgres is the production adapter and is gated here. SQLite cannot measure
 * this property at all and says so instead of pretending; see that package's
 * suite.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { RequestRecord, SessionRecord } from "@flow-state-dev/engine";
import { createPostgresStores, initializeSchema, type PostgresStoreRegistry } from "../src";
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

async function freshStores(): Promise<PostgresStoreRegistry> {
  const pglite = new PGlite();
  await initializeSchema(pgliteExecutor(pglite));
  return createPostgresStores({ executor: pgliteExecutor(pglite) });
}

function session(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    journal: [],
    ...overrides
  };
}

function request(id: string, overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id,
    flowKind: "chat",
    actionName: "run",
    userId: "alice",
    sessionId: "sess",
    source: "http",
    status: "completed",
    startedAtMs: 1_000,
    state: {},
    version: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  };
}

describe("Postgres list-option widenings", () => {
  it("session orgId filters exactly, NULL-safely, and only when the key is present", async () => {
    const s = await freshStores();
    await s.session.set("bound", session("bound", { orgId: "acme", parentSessionId: "p" }), "any");
    await s.session.set("other", session("other", { orgId: "globex", parentSessionId: "p" }), "any");
    await s.session.set("unbound", session("unbound", { parentSessionId: "p" }), "any");

    const parentage = { parentOf: "p" } as const;
    expect((await s.session.list({ orgId: "acme", parentage })).map((r) => r.id)).toEqual([
      "bound"
    ]);
    // The NULL half. An equality predicate against an absent value never
    // matches, which would silently drop every unbound record.
    expect(
      (await s.session.list({ orgId: undefined, parentage })).map((r) => r.id)
    ).toEqual(["unbound"]);
    expect((await s.session.list({ parentage })).map((r) => r.id).sort()).toEqual([
      "bound",
      "other",
      "unbound"
    ]);
  });

  it("request orgId filters exactly, with the same present-vs-absent rule", async () => {
    const s = await freshStores();
    await s.request.set("r_acme", request("r_acme", { orgId: "acme" }), "any");
    await s.request.set("r_unbound", request("r_unbound"), "any");

    expect((await s.request.list({ orgId: "acme" })).map((r) => r.id)).toEqual(["r_acme"]);
    expect((await s.request.list({ orgId: undefined })).map((r) => r.id)).toEqual([
      "r_unbound"
    ]);
    expect((await s.request.list({})).length).toBe(2);
  });

  /**
   * The in-process mirror of this matrix asserts that a record encoding
   * "unbound" as `null` is the same record as one omitting the key. This is
   * that case on Postgres — the adapter that was already right, kept honest so
   * the two cannot drift apart again.
   *
   * Org and tenant share one case here, unlike the in-process suite where they
   * are separate predicates: on this adapter both go through
   * `nullSafeEqualsClause`, so splitting them would assert one mechanism twice.
   */
  it("treats a null-encoded org or tenant binding as unbound", async () => {
    const s = await freshStores();
    await s.session.set(
      "nulled",
      session("nulled", {
        parentSessionId: "p",
        ...({ orgId: null, tenantId: null } as Partial<SessionRecord>)
      }),
      "any"
    );
    await s.request.set(
      "r_nulled",
      request("r_nulled", {
        ...({ orgId: null, tenantId: null } as Partial<RequestRecord>)
      }),
      "any"
    );

    const parentage = { parentOf: "p" } as const;
    expect(
      (await s.session.list({ orgId: undefined, parentage })).map((r) => r.id)
    ).toEqual(["nulled"]);
    expect(
      (await s.session.list({ tenantId: undefined, parentage })).map((r) => r.id)
    ).toEqual(["nulled"]);
    expect((await s.request.list({ orgId: undefined })).map((r) => r.id)).toEqual([
      "r_nulled"
    ]);
    expect((await s.request.list({ tenantId: undefined })).map((r) => r.id)).toEqual([
      "r_nulled"
    ]);
  });

  /**
   * The rewritten tenant clause is a *plan* change, not a predicate change.
   * These are the rows that would move if the two forms ever diverged.
   */
  it("the tenant filter still isolates exactly, in both the bound and unbound directions", async () => {
    const s = await freshStores();
    await s.request.set("r_acme", request("r_acme", { tenantId: "acme" }), "any");
    await s.request.set("r_globex", request("r_globex", { tenantId: "globex" }), "any");
    await s.request.set("r_none", request("r_none"), "any");

    expect((await s.request.list({ tenantId: "acme" })).map((r) => r.id)).toEqual([
      "r_acme"
    ]);
    expect((await s.request.list({ tenantId: undefined })).map((r) => r.id)).toEqual([
      "r_none"
    ]);
    // Key absent: no tenant filtering at all, unchanged for admin/debug callers.
    expect((await s.request.list({})).length).toBe(3);
  });

  it("a status array matches set membership; a single status still matches by equality", async () => {
    const s = await freshStores();
    for (const status of ["in_progress", "suspended", "completed", "failed"] as const) {
      await s.request.set(`r_${status}`, request(`r_${status}`, { status }), "any");
    }

    expect(
      (await s.request.list({ status: ["in_progress", "suspended"] }))
        .map((r) => r.id)
        .sort()
    ).toEqual(["r_in_progress", "r_suspended"]);
    expect((await s.request.list({ status: "failed" })).map((r) => r.id)).toEqual([
      "r_failed"
    ]);
    expect(await s.request.list({ status: [] })).toEqual([]);
    expect((await s.request.list({})).length).toBe(4);
  });

  it("orderBy: none returns matching rows, and limit 1 still returns one", async () => {
    const s = await freshStores();
    for (const status of ["in_progress", "suspended"] as const) {
      await s.request.set(`r_${status}`, request(`r_${status}`, { status }), "any");
    }

    const rows = await s.request.list({
      status: ["in_progress", "suspended"],
      orderBy: "none",
      limit: 1
    });
    expect(rows).toHaveLength(1);
  });

  it("session orderBy: createdAt is stable when updatedAt is rewritten; the default still moves", async () => {
    const s = await freshStores();
    for (let i = 0; i < 4; i++) {
      await s.session.set(
        `s_${i}`,
        session(`s_${i}`, { parentSessionId: "p", createdAt: 1_000 + i, updatedAt: 1_000 + i }),
        "any"
      );
    }
    const options = { parentage: { parentOf: "p" } as const, orderBy: "createdAt" as const };
    const before = (await s.session.list(options)).map((r) => r.id);

    const moved = await s.session.get("s_0");
    await s.session.set(
      "s_0",
      { ...(moved as SessionRecord), latestRequestId: "req_x", updatedAt: 9_999 },
      "any"
    );

    expect((await s.session.list(options)).map((r) => r.id)).toEqual(before);
    expect((await s.session.list({ parentage: { parentOf: "p" } }))[0]!.id).toBe("s_0");
  });

  it("request orderBy: startedAtMs breaks an exact tie on id, stably", async () => {
    const s = await freshStores();
    for (const id of ["r_a", "r_d", "r_b", "r_c"]) {
      await s.request.set(id, request(id, { startedAtMs: 5_000, createdAt: 5_000 }), "any");
    }

    const first = await s.request.list({ orderBy: "startedAtMs", limit: 1 });
    const second = await s.request.list({ orderBy: "startedAtMs", limit: 1 });
    // Postgres orders TEXT by its configured collation. Each adapter is
    // internally consistent, which is all the rule requires — cross-adapter
    // identity is explicitly NOT asserted, because request ids are
    // caller-supplied and collations genuinely disagree.
    expect(first[0]!.id).toBe("r_d");
    expect(second[0]!.id).toBe(first[0]!.id);
  });
});

// ---------------------------------------------------------------------------
// The cost property — a differential on three axes
// ---------------------------------------------------------------------------

type PlanNode = {
  "Node Type": string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
};

type Measurement = { rows: number; removed: number; plan: string };

function walk(node: PlanNode, acc: Measurement): Measurement {
  const loops = node["Actual Loops"] ?? 1;
  // `loops` multiplied in — a node executed many times examines many times.
  acc.rows += (node["Actual Rows"] ?? 0) * loops;
  acc.removed += (node["Rows Removed by Filter"] ?? 0) * loops;
  acc.plan = `${acc.plan} ${node["Node Type"]}`;
  for (const child of node.Plans ?? []) walk(child, acc);
  return acc;
}

/**
 * The identity the route conjoins on every read, exactly as the handler builds
 * it from the loaded parent record.
 */
const IDENTITY = {
  userId: "alice",
  flowKind: "chat",
  orgId: undefined,
  tenantId: undefined
} as const;

/**
 * The three list calls the route makes. The gate runs these **through the
 * store** and measures the SQL the store emitted, never SQL written here —
 * otherwise the differential proves a property of the test file. The store's
 * `WHERE` builder is the thing under test.
 */
const SHAPES = {
  read1: (store: PostgresStoreRegistry) =>
    store.request.list({
      sessionId: "target",
      status: ["in_progress", "suspended"],
      orderBy: "none",
      limit: 1,
      ...IDENTITY
    }),
  read2: (store: PostgresStoreRegistry) =>
    store.request.list({
      sessionId: "target",
      orderBy: "startedAtMs",
      limit: 1,
      ...IDENTITY
    }),
  listing: (store: PostgresStoreRegistry) =>
    store.session.list({
      parentage: { parentOf: "p_target" },
      orderBy: "createdAt",
      limit: 25,
      offset: 0,
      ...IDENTITY
    }),
  /**
   * The same listing for a **tenant-bound** caller. Every other shape here is
   * unbound, which is what left the cross-tenant axis unreachable: with no
   * tenant on the caller there is no foreign tenant to be crowded out by, so a
   * single-tenant fixture cannot express the failure.
   */
  listingBound: (store: PostgresStoreRegistry) =>
    store.session.list({
      parentage: { parentOf: "p_bound" },
      orderBy: "createdAt",
      limit: 25,
      offset: 0,
      ...IDENTITY,
      tenantId: "acme"
    })
} as const;

type ShapeName = keyof typeof SHAPES;
const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

describe("Postgres cost property — examined work does not grow with history", () => {
  async function harness(): Promise<{
    db: PGlite;
    addRequest: (o: Record<string, unknown>) => Promise<void>;
    addSession: (o: Record<string, unknown>) => Promise<void>;
    measure: (shape: ShapeName) => Promise<Measurement>;
  }> {
    const db = new PGlite();
    await initializeSchema(pgliteExecutor(db));

    // Record what the store sends so the gate explains the store's own SQL.
    const sent: Array<{ sql: string; params: unknown[] }> = [];
    const recording: QueryExecutor = {
      async query(text: string, values?: unknown[]) {
        sent.push({ sql: text, params: values ?? [] });
        const result = await db.query(text, values);
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.affectedRows ?? 0
        };
      }
    };
    const stores = await createPostgresStores({
      executor: recording,
      skipSchemaInit: true
    });

    let seq = 0;
    const addRequest = async (o: Record<string, unknown>): Promise<void> => {
      await db.query(
        `INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, tenant_id, status, version, created_at, updated_at, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$8,'{}'::jsonb)`,
        [
          `r_${String(seq++).padStart(7, "0")}`,
          o.flow ?? "chat",
          o.user ?? "alice",
          o.sessionId,
          o.org ?? null,
          o.tenant ?? null,
          o.status,
          o.createdAt ?? 1_000 + seq
        ]
      );
    };
    const addSession = async (o: Record<string, unknown>): Promise<void> => {
      await db.query(
        `INSERT INTO sessions (id, flow_kind, user_id, org_id, tenant_id, parent_session_id, version, created_at, updated_at, data)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$7,'{}'::jsonb)`,
        [
          o.id ?? `s_${String(seq++).padStart(7, "0")}`,
          o.flow ?? "chat",
          o.user ?? "alice",
          o.org ?? null,
          o.tenant ?? null,
          o.parent ?? null,
          o.createdAt ?? 1_000 + seq
        ]
      );
    };
    const measure = async (shape: ShapeName): Promise<Measurement> => {
      // Re-ANALYZE before each measurement: a stale estimate is the planner
      // choosing on last epoch's data, which would make the differential a
      // measurement of the fixture rather than of the plan.
      await db.query("ANALYZE");
      sent.length = 0;
      await SHAPES[shape](stores);
      const issued = sent.filter((s) => s.sql.trimStart().toUpperCase().startsWith("SELECT"));
      // Exactly one SELECT per list call — a second would mean the gate is
      // measuring only half of what the route pays for.
      expect(issued).toHaveLength(1);
      const { sql, params } = issued[0]!;
      const result = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
      const plan = (result.rows[0] as { "QUERY PLAN": Array<{ Plan: PlanNode }> })[
        "QUERY PLAN"
      ][0]!.Plan;
      return walk(plan, { rows: 0, removed: 0, plan: "" });
    };

    // Baseline. Deliberately large enough that the planner is already choosing
    // its steady-state plan — a fixture of three rows measures nothing, and a
    // plan flip between the two measurements would read as a differential.
    await addSession({ id: "p_target", parent: null });
    for (let i = 0; i < 200; i++) {
      await addSession({ id: `c_${i}`, parent: "p_target", createdAt: 1_000 + i });
    }
    await addRequest({ sessionId: "target", status: "suspended", createdAt: 500 });
    for (let i = 0; i < 200; i++) {
      await addRequest({ sessionId: "target", status: "completed", createdAt: 600 + i });
    }
    // A handful of boundary rows at baseline, so axis 2 measures growth in a
    // set that is already non-empty rather than a step off zero.
    for (let i = 0; i < 5; i++) {
      await addRequest({
        sessionId: "target",
        status: "in_progress",
        tenant: "other",
        createdAt: 650 + i
      });
    }
    // Unrelated volume, so the planner is not choosing on a toy table.
    for (let i = 0; i < 3_000; i++) {
      await addRequest({ sessionId: `noise_${i % 50}`, status: "completed", createdAt: 100 + i });
    }
    for (let i = 0; i < 2_000; i++) {
      await addSession({ parent: `pnoise_${i % 50}`, createdAt: 100 + i });
    }

    return { db, addRequest, addSession, measure };
  }

  /**
   * Axis 1 — the caller's own terminal history. The runaway the whole design
   * exists to prevent: a job accumulates runs over its life, and a parent
   * accumulates children.
   */
  it("axis 1: 500 further terminal runs and 500 further children move nothing", async () => {
    const h = await harness();
    const before: Record<string, Measurement> = {};
    for (const shape of SHAPE_NAMES) before[shape] = await h.measure(shape);

    for (let i = 0; i < 500; i++) {
      await h.addRequest({ sessionId: "target", status: "completed", createdAt: 2_000 + i });
      await h.addSession({ parent: "p_target", createdAt: 2_000 + i });
    }

    for (const shape of SHAPE_NAMES) {
      expect({ shape, ...(await h.measure(shape)) }).toEqual({
        shape,
        ...before[shape]
      });
    }
    await h.db.close();
  });

  /**
   * Axis 3 — the child's own *non-terminal* accumulation, which axis 1 is
   * blind to by construction: it adds terminal runs, while these are exactly
   * the rows the existence check selects. An expired approval gate leaves a
   * request `suspended` forever, so this set genuinely grows in production.
   *
   * This is the axis that makes the unordered mode measurable. With a trailing
   * `ORDER BY` on a column the index does not cover, read 1 sorts the whole
   * growing set before the limit applies and this differential moves.
   */
  it("axis 3: 500 further suspended runs on the same child move read 1 not at all", async () => {
    const h = await harness();
    const before = await h.measure("read1");

    for (let i = 0; i < 500; i++) {
      await h.addRequest({ sessionId: "target", status: "suspended", createdAt: 3_000 + i });
    }

    expect(await h.measure("read1")).toEqual(before);
    await h.db.close();
  });

  /**
   * Axis 2 — the boundary: non-terminal records carrying the **same bare
   * session id** under a different tenant, owner, flow kind and org. The
   * shipped `(session_id, status)` index does not separate any of them, so a
   * plan can be flat on axis 1 and linear here, and this is the axis nobody
   * looks at.
   *
   * **This is where the cost claim is revised rather than the gate
   * strengthened**, because strengthening it here is not open to a correct
   * implementation. The rows are examined and discarded by filters that a
   * plain btree cannot serve as index conditions, and an index over the
   * boundary predicates would not change that. So the honest bound is stated
   * and asserted: examined work grows *at most* one row per boundary record,
   * and — the part that actually matters — it does not multiply by the child's
   * own history. A regression that made it worse than linear fails here.
   */
  /**
   * Axis 4 — the **cross-tenant** boundary on the child listing, which axis 2
   * does not reach: axis 2 measures `read1` and adds only request records, so
   * nothing in this gate ever put another tenant's rows under the target
   * parent.
   *
   * `parent_session_id` stores the **bare** session id — the route queries it
   * with the id straight off the URL path — so two tenants that reuse a
   * predictable parent id produce rows sharing an index prefix. Without
   * `tenant_id`/`org_id` in the index, those rows sit ahead of the caller's
   * own in `created_at DESC` order and are walked and discarded, which makes
   * one tenant's history grow another tenant's nominally bounded read. That is
   * a stronger failure than axis 2's accepted linear bound: the rows belong to
   * a different customer, so the caller cannot cap them by their own
   * behaviour.
   *
   * Asserted **flat**, not linear-bounded, because unlike axis 2 this one *is*
   * open to a correct implementation — the boundary keys are equality and
   * `IS NULL` predicates a btree can serve as index conditions when they sit
   * between the parent and the ordering columns. Both dimensions are added
   * together because the route supplies both keys and fixing one would leave
   * the other amplifying.
   */
  it("axis 4: a foreign tenant's children under the same parent id move nothing", async () => {
    const h = await harness();
    // The bound caller's own children. Seeded here rather than in the shared
    // baseline so the other axes keep measuring exactly what they measured.
    await h.addSession({ id: "p_bound", parent: null, tenant: "acme" });
    for (let i = 0; i < 200; i++) {
      await h.addSession({ parent: "p_bound", tenant: "acme", createdAt: 1_000 + i });
    }
    const before = await h.measure("listingBound");

    // Newer than every child the caller owns, so a scan that cannot exclude
    // them by index condition meets them *first* — the realistic shape, a
    // different customer actively starting work now.
    const added = 400;
    for (let i = 0; i < added / 2; i++) {
      await h.addSession({ parent: "p_bound", tenant: "other", createdAt: 5_000 + i });
      await h.addSession({ parent: "p_bound", tenant: "acme", org: "globex", createdAt: 6_000 + i });
    }

    const after = await h.measure("listingBound");
    expect(after.rows + after.removed).toBe(before.rows + before.removed);
    await h.db.close();
  }, 60_000);

  it("axis 2: the boundary costs at most one examined row each, never more", async () => {
    const h = await harness();
    const before = await h.measure("read1");

    const added = 400;
    for (let i = 0; i < added / 4; i++) {
      await h.addRequest({ sessionId: "target", status: "in_progress", tenant: "other" });
      await h.addRequest({ sessionId: "target", status: "in_progress", user: "bob" });
      await h.addRequest({ sessionId: "target", status: "in_progress", flow: "other" });
      await h.addRequest({ sessionId: "target", status: "in_progress", org: "globex" });
    }

    const after = await h.measure("read1");
    const examinedBefore = before.rows + before.removed;
    const examinedAfter = after.rows + after.removed;

    expect(examinedAfter).toBeGreaterThanOrEqual(examinedBefore);
    expect(examinedAfter - examinedBefore).toBeLessThanOrEqual(added);
    await h.db.close();
  }, 60_000);
});
