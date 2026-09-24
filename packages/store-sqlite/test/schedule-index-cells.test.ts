/**
 * One schedule, one index row — through the real collection into a real
 * SQLite schedule index.
 *
 * A hired seat stores a person's data in one cell per (org, person), so the
 * same person can hold a schedule named `weekly` in several cells at once.
 * The index mirrors each schedule under the cell it is stored in, so turning
 * one of them off leaves the others due, each carrying its own organization.
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, InstanceOwnerPin, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowRegistry, createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineScheduleCollection } from "@flow-state-dev/scheduled";
import { createSQLiteScheduleIndex } from "../src/schedule-index";
import { initializeSchema } from "../src/schema";

/** Every due row, far in the future so every schedule written here is due. */
const FAR_FUTURE = Date.UTC(2100, 0, 1);

let db: Database.Database | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

/**
 * `seed` runs against the empty database before schema init, so a test can
 * lay down a table in the shape an older release wrote.
 */
function boot(seed?: (db: Database.Database) => void) {
  db = new Database(":memory:");
  seed?.(db);
  initializeSchema(db);
  const index = createSQLiteScheduleIndex(db);
  const schedules = defineScheduleCollection({ pattern: "schedules/*", index });

  const create = handler({
    name: "create",
    inputSchema: z.object({ key: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    resources: { schedules },
    execute: async (input, ctx) => {
      await (ctx.resources.schedules as unknown as ResourceCollectionRef).create(input.key, {
        cron: "0 9 * * MON",
        kind: "ping",
        enabled: true,
      });
      return { ok: true };
    },
  });
  const disable = handler({
    name: "disable",
    inputSchema: z.object({ key: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    resources: { schedules },
    execute: async (input, ctx) => {
      const row = await (ctx.resources.schedules as unknown as ResourceCollectionRef).get(input.key);
      await row.setState({ cron: "0 9 * * MON", kind: "ping", enabled: false });
      return { ok: true };
    },
  });
  const remove = handler({
    name: "remove",
    inputSchema: z.object({ key: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    resources: { schedules },
    execute: async (input, ctx) => {
      await (ctx.resources.schedules as unknown as ResourceCollectionRef).delete(input.key);
      return { ok: true };
    },
  });

  const kind = (name: string, cardinality: "collection" | "singleton") =>
    defineFlow({
      kind: name,
      cardinality,
      resources: { schedules },
      actions: {
        create: { inputSchema: z.object({ key: z.string() }), block: create },
        disable: { inputSchema: z.object({ key: z.string() }), block: disable },
        remove: { inputSchema: z.object({ key: z.string() }), block: remove },
      },
    });
  const seatKind = kind("research", "collection");
  const appKind = kind("reminders", "singleton");

  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const register = (flow: unknown, pin?: InstanceOwnerPin) => {
    registry.register(flow as FlowInstance, pin === undefined ? undefined : { pin });
    return flow as FlowInstance;
  };
  /** A seat hired for `userId` in `orgId`. */
  const seat = (orgId: string, userId = "alice") =>
    register(seatKind({ id: `${orgId}.~${userId}.research` }), { orgId, userId });
  const app = () => register(appKind());
  /** `userId` runs `actionName` on `flow` while admitted under `orgId`. */
  const run = async (
    flow: FlowInstance,
    actionName: "create" | "disable" | "remove",
    orgId: string,
    key = "weekly",
    userId = "alice"
  ) => {
    const result = await runAction({ flow, actionName, input: { key }, userId, orgId, stores, runtimeConfig: {} });
    expect(result.error).toBeUndefined();
  };
  const due = () => index.claimDue(FAR_FUTURE, 100);

  return { stores, seat, app, run, due, db: db! };
}

describe("schedule index rows are one per storage cell", () => {
  it("keeps two seats' same-named schedules apart, and disabling one leaves the other due", async () => {
    const h = boot();
    const acme = h.seat("acme");
    const globex = h.seat("globex");

    await h.run(acme, "create", "acme");
    await h.run(globex, "create", "globex");
    await h.run(acme, "disable", "acme");

    const rows = await h.due();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cell: "alice:~org:globex",
      userId: "alice",
      orgId: "globex",
      key: "weekly",
    });
  });

  it("deleting in one seat leaves the other seat's row due", async () => {
    const h = boot();
    const acme = h.seat("acme");
    const globex = h.seat("globex");

    await h.run(acme, "create", "acme");
    await h.run(globex, "create", "globex");
    await h.run(globex, "remove", "globex");

    const rows = await h.due();
    expect(rows.map((r) => [r.cell, r.orgId])).toEqual([["alice:~org:acme", "acme"]]);
  });

  it("keeps an app-wide schedule and a seat schedule in one org apart", async () => {
    const h = boot();
    const app = h.app();
    const acme = h.seat("acme");

    await h.run(app, "create", "acme");
    await h.run(acme, "create", "acme");

    const both = await h.due();
    expect(both.map((r) => r.cell).sort()).toEqual(["alice", "alice:~org:acme"]);

    // Turning the seat's copy off leaves the app-wide one due.
    const h2 = boot();
    await h2.run(h2.app(), "create", "acme");
    const seat2 = h2.seat("acme");
    await h2.run(seat2, "create", "acme");
    await h2.run(seat2, "disable", "acme");
    const left = await h2.due();
    expect(left.map((r) => [r.cell, r.orgId])).toEqual([["alice", "acme"]]);
  });

  it("files a row under the cell its schedule is stored in", async () => {
    const h = boot();
    const acme = h.seat("acme", "a:b");
    await h.run(acme, "create", "acme", "weekly", "a:b");

    const [row] = await h.due();
    expect(row.cell).toBe("a\\:b:~org:acme");
    // The schedule itself lives at exactly that cell.
    expect(await h.stores.resourceState.get("user", row.cell, "schedules/weekly")).toBeDefined();
  });
});

/** The table as releases before the cell existed created it. */
const LEGACY_TABLE = `
CREATE TABLE schedule_index (
  user_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  org_id       TEXT,
  cron         TEXT NOT NULL,
  timezone     TEXT,
  next_fire_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
) WITHOUT ROWID;
CREATE INDEX idx_schedule_index_next_fire_at ON schedule_index (next_fire_at);
`;

function seedLegacy(db: Database.Database, withOrgId = true) {
  db.exec(withOrgId ? LEGACY_TABLE : LEGACY_TABLE.replace("  org_id       TEXT,\n", ""));
  const insert = db.prepare(
    withOrgId
      ? "INSERT INTO schedule_index (user_id, key, org_id, cron, timezone, next_fire_at) VALUES (?, 'weekly', 'acme', '0 9 * * MON', NULL, 1000)"
      : "INSERT INTO schedule_index (user_id, key, cron, timezone, next_fire_at) VALUES (?, 'weekly', '0 9 * * MON', NULL, 1000)"
  );
  for (const userId of ["alice", "a:b", "c\\d"]) insert.run(userId);
}

describe("upgrading a schedule index written before rows carried a cell", () => {
  it("adopts every old row as its person's own cell, escaped the way the engine keys it (BR-12, BR-13)", async () => {
    const h = boot((db) => seedLegacy(db));
    const rows = await h.due();
    expect(rows.map((r) => [r.cell, r.userId, r.orgId, r.key]).sort()).toEqual([
      ["a\\:b", "a:b", "acme", "weekly"],
      ["alice", "alice", "acme", "weekly"],
      ["c\\\\d", "c\\d", "acme", "weekly"],
    ]);
    // The rebuilt table is keyed on (cell, key), and the due-scan index survives.
    const pk = h.db
      .prepare("SELECT name FROM pragma_table_info('schedule_index') WHERE pk > 0 ORDER BY pk")
      .all() as Array<{ name: string }>;
    expect(pk.map((c) => c.name)).toEqual(["cell", "key"]);
    expect(
      h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_schedule_index_next_fire_at'").get()
    ).toBeDefined();
    expect(h.db.prepare("SELECT name FROM sqlite_master WHERE name = 'schedule_index_pre_cell'").get()).toBeUndefined();
  });

  it("adopts a table old enough to have no organization column", async () => {
    const h = boot((db) => seedLegacy(db, false));
    const rows = await h.due();
    expect(rows.map((r) => [r.cell, r.orgId]).sort()).toEqual([
      ["a\\:b", undefined],
      ["alice", undefined],
      ["c\\\\d", undefined],
    ]);
  });

  it("is a no-op on a second init", async () => {
    const h = boot((db) => seedLegacy(db));
    const before = h.db.prepare("SELECT * FROM schedule_index ORDER BY cell").all();
    initializeSchema(h.db);
    expect(h.db.prepare("SELECT * FROM schedule_index ORDER BY cell").all()).toEqual(before);
  });

  it("updates an adopted row in place when its app-wide flow next writes it (BR-14)", async () => {
    const h = boot((db) => seedLegacy(db));
    const app = h.app();
    // Each person's app-wide flow rewrites `weekly` — for `a:b` that only
    // lands on the adopted row if the migration escaped the id exactly as the
    // engine does.
    for (const userId of ["alice", "a:b", "c\\d"]) {
      await h.run(app, "create", "acme", "weekly", userId);
    }
    const rows = h.db
      .prepare("SELECT cell, user_id, next_fire_at FROM schedule_index ORDER BY cell")
      .all() as Array<{ cell: string; user_id: string; next_fire_at: number }>;
    expect(rows.map((r) => r.cell)).toEqual(["a\\:b", "alice", "c\\\\d"]);
    // Rewritten, not duplicated: every row now carries a fresh fire time.
    expect(rows.every((r) => r.next_fire_at > 1000)).toBe(true);
  });
});

/**
 * Two processes starting against one legacy database file both look for the
 * `cell` column before either takes the write lock. The one that loses the
 * race must see the finished migration once it holds the lock — rebuilding an
 * already re-keyed table would recompute every cell from `user_id`, moving a
 * seat row the winner has since written into the person's app-wide cell (or
 * colliding with the app-wide row and failing startup).
 */
describe("two connections upgrading one legacy database at once", () => {
  it("the second leaves the first's migration, and rows written since, alone", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "fsd-sched-cell-"));
    const file = join(dir, "db.sqlite");
    const seed = new Database(file);
    seedLegacy(seed);
    seed.close();

    const first = new Database(file);
    const second = new Database(file);
    try {
      // Let `second` get as far as the rebuild's transaction — past any check
      // made before the lock — then let `first` migrate and write a seat row.
      const originalTransaction = second.transaction.bind(second);
      let interleaved = false;
      second.transaction = ((fn: (...args: unknown[]) => unknown) => {
        if (!interleaved) {
          interleaved = true;
          initializeSchema(first);
          first
            .prepare(
              "INSERT INTO schedule_index (cell, key, user_id, org_id, cron, timezone, next_fire_at) VALUES ('alice:~org:acme', 'weekly', 'alice', 'acme', '0 9 * * MON', NULL, 2000)"
            )
            .run();
        }
        return originalTransaction(fn);
      }) as typeof second.transaction;

      initializeSchema(second);

      const rows = second
        .prepare("SELECT cell, user_id, next_fire_at FROM schedule_index ORDER BY cell")
        .all() as Array<{ cell: string; user_id: string; next_fire_at: number }>;
      expect(rows.map((r) => [r.cell, r.user_id])).toEqual([
        ["a\\:b", "a:b"],
        ["alice", "alice"],
        ["alice:~org:acme", "alice"],
        ["c\\\\d", "c\\d"],
      ]);
    } finally {
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
