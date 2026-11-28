/**
 * The app every process of this goal runs: one flow, `digest`, with a static
 * schedule at `* * * * *` and a schedule collection whose rows a run writes
 * (one user's row at `* * * * *`), both firing a block that writes one row to
 * the goal's ledger: which origin, which scheduled time, which process ran it.
 *
 * The ledger is a SQLite file of the goal's own, beside the app's stores. It
 * also takes one `claims` row each time a process's tick claims the flow's
 * schedule index: every tick claims it once, so these rows say which process
 * ticked when, read from a store, never from a log.
 *
 * `scheduler` is passed through: omitted, the engine's local cron (the claim
 * under test). The app passes no `adapters`: the scheduled endpoint the tick
 * sends to is the router's own. A second flow, `plain`, declares no schedules.
 */
import Database from "better-sqlite3";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, ResourceCollectionRef, ScheduleConfig } from "@flow-state-dev/core/types";
import {
  createBearerSecretPrincipalResolver,
  createFlowState,
  runAction,
  type FlowState
} from "@flow-state-dev/engine";
import type { JobQueueAdapter, SchedulerAdapter } from "@flow-state-dev/engine/host";
import {
  createResourceCollectionScheduleResolver,
  defineScheduleCollection,
  type ScheduleIndex
} from "@flow-state-dev/scheduled";
import { createSQLiteScheduleIndex, sqliteStores } from "@flow-state-dev/store-sqlite";
import { createPostgresScheduleIndex, postgresStores } from "@flow-state-dev/store-postgres";
import { createPgPoolTx } from "@flow-state-dev/store-postgres/host";
import pg from "pg";
import { oneOffSessionId } from "@flow-state-dev/core/helpers";

export const ORG = "acme";
export const USER = "alice";
export const SCHEDULE_KEY = "minutely";
export const EVERY_MINUTE = "* * * * *";
/** A flow the app registers with no `schedules`. */
export const PLAIN_FLOW = "plain";
/** The bearer the tick sends and the scheduled endpoint admits. */
export const CRON_SECRET = "fires-with-no-outside-cron";

/** One fire the action wrote. */
export interface FireRow {
  origin: "static" | "dynamic";
  nominal: number;
  process: string;
  ranAt: number;
}

/** One claim of the index: one tick, by one process. */
export interface ClaimRow {
  process: string;
  at: number;
}

/** Open (and lay out) the ledger. Many processes write it at once. */
export function openLedger(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");
  db.exec(`CREATE TABLE IF NOT EXISTS fires (origin TEXT NOT NULL, nominal INTEGER NOT NULL, process TEXT NOT NULL, ran_at INTEGER NOT NULL);
           CREATE TABLE IF NOT EXISTS claims (process TEXT NOT NULL, at INTEGER NOT NULL);`);
  return db;
}

export function readLedger(file: string): { fires: FireRow[]; claims: ClaimRow[] } {
  const db = openLedger(file);
  try {
    const fires = db.prepare("SELECT origin, nominal, process, ran_at AS ranAt FROM fires ORDER BY nominal").all() as FireRow[];
    const claims = db.prepare("SELECT process, at FROM claims ORDER BY at").all() as ClaimRow[];
    return { fires, claims };
  } finally {
    db.close();
  }
}

export interface GoalAppOptions {
  /** This process's name, written on each row. */
  process: string;
  /** The goal's ledger file. */
  ledger: string;
  /** The app's stores: a SQLite file, or a Postgres URL. */
  store: { sqlite: string } | { postgres: string };
  scheduler?: SchedulerAdapter | false;
  jobQueue?: JobQueueAdapter;
}

/** The app, and a way to write the user's schedule row through a run. */
export function goalApp(options: GoalAppOptions): { app: FlowState; seed(): Promise<void> } {
  const ledger = openLedger(options.ledger);
  const insertFire = ledger.prepare("INSERT INTO fires (origin, nominal, process, ran_at) VALUES (?, ?, ?, ?)");
  const insertClaim = ledger.prepare("INSERT INTO claims (process, at) VALUES (?, ?)");

  const { stores, index: realIndex } = storesAndIndex(options.store);
  // Every tick claims this flow's index once: record which process did, then claim.
  const index: ScheduleIndex = {
    upsert: (entry) => realIndex().upsert(entry),
    ensure: (entry) => realIndex().ensure(entry),
    remove: (entry) => realIndex().remove(entry),
    claimDue: (now, limit) => {
      insertClaim.run(options.process, Date.now());
      return realIndex().claimDue(now, limit);
    }
  };

  const fireInput = z.object({ nominalFireTime: z.string() });
  const record = (origin: FireRow["origin"]) =>
    handler({
      name: `record-${origin}`,
      inputSchema: fireInput,
      execute: (input) => {
        insertFire.run(origin, Date.parse(input.nominalFireTime), options.process, Date.now());
        return { ok: true };
      }
    });
  // The scheduled time a fire is for, handed to the action as its input.
  const atScheduledTime = ({ nominalFireTime }: { nominalFireTime: string }) => ({ nominalFireTime });

  const schedules = defineScheduleCollection({ pattern: "schedules/*", index });
  const fromRows = createResourceCollectionScheduleResolver({ collection: schedules, blocks: { record: record("dynamic") } });
  const plan = handler({
    name: "plan",
    inputSchema: z.object({}),
    resources: { schedules },
    execute: async (_input, ctx) => {
      await (ctx.resources.schedules as unknown as ResourceCollectionRef).create(SCHEDULE_KEY, {
        cron: EVERY_MINUTE,
        kind: "record",
        enabled: true
      });
      return { ok: true };
    }
  });
  const wait = handler({
    name: "wait",
    inputSchema: z.object({ ms: z.number() }),
    execute: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, input.ms));
      return { waited: input.ms };
    }
  });

  const flow = defineFlow({
    kind: "digest",
    resources: { schedules },
    authentication: {
      resolvePrincipal: createBearerSecretPrincipalResolver({ secret: CRON_SECRET, principal: { userId: "scheduler", orgId: ORG } })
    },
    schedules: {
      static: { [SCHEDULE_KEY]: { cron: EVERY_MINUTE, block: record("static"), input: atScheduledTime } },
      resolve: async (id, ctx) => {
        const found = await fromRows(id, ctx);
        return found === null ? null : ({ ...found, input: atScheduledTime } as ScheduleConfig);
      },
      index
    },
    actions: {
      plan: { inputSchema: z.object({}), block: plan },
      wait: { inputSchema: z.object({ ms: z.number() }), block: wait }
    }
  })() as unknown as FlowInstance;

  // A registered flow with no schedules: its schedule routes must answer as an unknown flow's.
  const plain = defineFlow({
    kind: PLAIN_FLOW,
    authentication: {
      resolvePrincipal: createBearerSecretPrincipalResolver({ secret: CRON_SECRET, principal: { userId: "scheduler", orgId: ORG } })
    },
    actions: { wait: { inputSchema: z.object({ ms: z.number() }), block: wait } }
  })() as unknown as FlowInstance;

  // No `adapters`: the scheduled endpoint is the router's own.
  const app = createFlowState({
    flows: [flow, plain],
    stores,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.jobQueue === undefined ? {} : { jobQueue: options.jobQueue })
  });

  const seed = async () => {
    const { stores: resolved, runtimeConfig } = await app.getRuntime();
    const run = await runAction({ sessionId: oneOffSessionId(), flow, actionName: "plan", input: {}, userId: USER, orgId: ORG, stores: resolved, runtimeConfig });
    if ((run as { success?: boolean }).success === false) throw new Error(`seed: the plan run failed: ${JSON.stringify(run)}`);
  };
  return { app, seed };
}

/** The app's stores and its schedule index, opened on first use (after the stores lay out its table). */
function storesAndIndex(store: GoalAppOptions["store"]) {
  if ("sqlite" in store) {
    let opened: ScheduleIndex | undefined;
    return {
      stores: sqliteStores({ filename: store.sqlite }),
      index: () => (opened ??= createSQLiteScheduleIndex(new Database(store.sqlite)))
    };
  }
  const pool = new pg.Pool({ connectionString: store.postgres, max: 4 });
  pool.on("error", () => undefined);
  const index = createPostgresScheduleIndex({
    async query(text, values) {
      const result = await pool.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    },
    beginTx: () => createPgPoolTx(pool)
  });
  return { stores: postgresStores({ connectionString: store.postgres }), index: () => index };
}
