/**
 * A real Postgres for a goal that runs more than one process over one
 * database (FIX-2427, shared with the epic closure FIX-2368).
 *
 * PGlite can't stand in: it lives inside one process, and `LISTEN` /
 * `NOTIFY` between processes is what these goals grade. So either the
 * caller's `FSD_DB_URL` (a scratch database is made on it when the role may,
 * dropped on stop), or a throwaway cluster this starts with `initdb` and
 * `pg_ctl` on a free port and removes on stop.
 *
 * And, for a goal that grades a store's reads by the database's own plan,
 * `recordingExecutor` (the statements a store sent, to `EXPLAIN` afterwards)
 * and `flattenPlan` (an `EXPLAIN (FORMAT JSON)` plan as a list of nodes).
 *
 * **Not re-exported from `index.mts`**: it loads `pg`. Import it directly:
 *
 *   import { startPostgres } from "../../lib/postgres.mts";
 */
import { spawnSync } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { QueryExecutor } from "@flow-state-dev/store-postgres/host";
import { freePort } from "./server.mts";

export type RunningPostgres = {
  /** A connection string for the database the goal uses. */
  url: string;
  /** `"initdb"` for a cluster this started, `"FSD_DB_URL"` for the caller's. */
  source: "initdb" | "FSD_DB_URL";
  /**
   * The server's log file, for a cluster this started; `undefined` on
   * `FSD_DB_URL`, whose log is the caller's. With `log_statement` in
   * `settings`, it is where a goal reads what each process asked.
   */
  log?: string;
  /** Run one statement as the database's owner (setup, `pg_terminate_backend`). */
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<R[]>;
  /** Stop the cluster or drop the scratch database. Idempotent. */
  stop(): Promise<void>;
};

export type StartPostgresOptions = {
  /** Names the scratch directory or database. */
  slug: string;
  /**
   * Server settings for a cluster this starts (`-c name=value`), e.g.
   * `{ log_statement: "all" }`. Ignored on `FSD_DB_URL`, whose server is the
   * caller's: a goal that needs one must say it can't tell without it.
   */
  settings?: Record<string, string>;
};

/**
 * Start (or attach to) a Postgres for one goal run.
 *
 * @throws When neither `FSD_DB_URL` is set nor `initdb` and `pg_ctl` can be found.
 */
export async function startPostgres(options: StartPostgresOptions): Promise<RunningPostgres> {
  const given = process.env.FSD_DB_URL;
  if (given !== undefined && given !== "") return attach(given, options.slug);
  return startCluster(options);
}

/** The caller's server: a scratch database on it when the role may make one, else the database as given. */
async function attach(given: string, slug: string): Promise<RunningPostgres> {
  const name = `goal_${slug.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}`.toLowerCase();
  const admin = new pg.Pool({ connectionString: given, max: 1 });
  let url = given;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const parsed = new URL(given);
    parsed.pathname = `/${name}`;
    url = parsed.toString();
    created = true;
  } catch {
    // No CREATEDB: the goal shares the database as given, and keys its rows freshly.
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  let stopped = false;
  return {
    url,
    source: "FSD_DB_URL",
    query: async (text, values) => (await pool.query(text, values)).rows,
    async stop() {
      if (stopped) return;
      stopped = true;
      await pool.end().catch(() => {});
      if (created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  };
}

/** Where `initdb` and `pg_ctl` live: `PATH`, or the newest Debian-style install. */
function binDir(): string {
  const onPath = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (onPath.status === 0 && existsSync(join(onPath.stdout.trim(), "initdb"))) return onPath.stdout.trim();
  const root = "/usr/lib/postgresql";
  if (existsSync(root)) {
    const versions = readdirSync(root)
      .filter((v) => existsSync(join(root, v, "bin", "initdb")))
      .sort((a, b) => Number(b) - Number(a));
    if (versions[0] !== undefined) return join(root, versions[0], "bin");
  }
  const which = spawnSync("sh", ["-c", "command -v initdb"], { encoding: "utf8" });
  if (which.status === 0) return join(which.stdout.trim(), "..");
  throw new Error("no Postgres to start: set FSD_DB_URL, or install Postgres so `initdb` and `pg_ctl` are found");
}

/**
 * `initdb` refuses to run as root, so a root caller (a CI container) runs the
 * cluster as the `postgres` user, which owns the scratch directory.
 */
function runAs(): { uid: number; gid: number } | undefined {
  if (userInfo().uid !== 0) return undefined;
  const id = spawnSync("id", ["-u", "postgres"], { encoding: "utf8" });
  const gid = spawnSync("id", ["-g", "postgres"], { encoding: "utf8" });
  if (id.status !== 0 || gid.status !== 0) throw new Error("running as root with no `postgres` user to run initdb as; set FSD_DB_URL");
  return { uid: Number(id.stdout.trim()), gid: Number(gid.stdout.trim()) };
}

async function startCluster(options: StartPostgresOptions): Promise<RunningPostgres> {
  const bin = binDir();
  const user = runAs();
  const dir = mkdtempSync(join(tmpdir(), `fsd-goal-pg-${options.slug}-`));
  if (user !== undefined) chownSync(dir, user.uid, user.gid);
  const data = join(dir, "data");
  const run = (cmd: string, args: string[]): void => {
    const result = spawnSync(join(bin, cmd), args, { encoding: "utf8", cwd: dir, ...(user ?? {}) });
    if (result.status !== 0) throw new Error(`${cmd} failed (${result.status}): ${result.stderr || result.stdout}`);
  };

  run("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--no-instructions"]);
  const port = await freePort();
  const settings = { listen_addresses: "127.0.0.1", port: String(port), unix_socket_directories: dir, fsync: "off", ...options.settings };
  const serverArgs = Object.entries(settings)
    .map(([name, value]) => `-c ${name}=${value}`)
    .join(" ");
  run("pg_ctl", ["-D", data, "-l", join(dir, "server.log"), "-o", serverArgs, "-w", "-t", "30", "start"]);

  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  let stopped = false;
  return {
    url,
    source: "initdb",
    log: join(dir, "server.log"),
    query: async (text, values) => (await pool.query(text, values)).rows,
    async stop() {
      if (stopped) return;
      stopped = true;
      await pool.end().catch(() => {});
      spawnSync(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { cwd: dir, ...(user ?? {}) });
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** One statement a store sent, as it sent it. */
export type SentStatement = { text: string; values: unknown[] };

/** A store executor over a pool that keeps every statement it sent, oldest first. */
export type RecordingExecutor = QueryExecutor & { sent: SentStatement[] };

/**
 * An executor for a Postgres store that records what the store sent, so a goal
 * can `EXPLAIN` the store's own SQL rather than a copy of it. Clear `sent`
 * before the read under test.
 */
export function recordingExecutor(pool: pg.Pool): RecordingExecutor {
  const sent: SentStatement[] = [];
  return {
    sent,
    async query(text: string, values?: unknown[]) {
      sent.push({ text, values: values ?? [] });
      const result = await pool.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    }
  };
}

/** The fields of an `EXPLAIN (ANALYZE, FORMAT JSON)` plan node a goal grades. */
export type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  Plans?: PlanNode[];
};

/** Every node of a plan, the root first and each child after its parent. */
export function flattenPlan(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node);
  for (const child of node.Plans ?? []) flattenPlan(child, out);
  return out;
}
