import type Database from "better-sqlite3";

const PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -20000;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
`;

const SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  flow_kind   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  org_id  TEXT,
  version     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_flow_kind   ON sessions(flow_kind);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id     ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_flow_user   ON sessions(flow_kind, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at  ON sessions(updated_at);
`;

const REQUESTS_TABLE = `
CREATE TABLE IF NOT EXISTS requests (
  id          TEXT PRIMARY KEY,
  flow_kind   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  org_id  TEXT,
  status      TEXT NOT NULL,
  version     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_flow_kind       ON requests(flow_kind);
CREATE INDEX IF NOT EXISTS idx_requests_session_id      ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_user_id         ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_org_id      ON requests(org_id);
CREATE INDEX IF NOT EXISTS idx_requests_status          ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_session_status  ON requests(session_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_flow_user       ON requests(flow_kind, user_id);
CREATE INDEX IF NOT EXISTS idx_requests_updated_at      ON requests(updated_at);
`;

const USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);
`;

const ORGS_TABLE = `
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  version     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orgs_user_id    ON orgs(user_id);
CREATE INDEX IF NOT EXISTS idx_orgs_updated_at ON orgs(updated_at);
`;

const ACTIVE_REQUESTS_TABLE = `
CREATE TABLE IF NOT EXISTS active_requests (
  request_id        TEXT PRIMARY KEY,
  flow_kind         TEXT NOT NULL,
  action_name       TEXT NOT NULL,
  session_id        TEXT,
  user_id           TEXT NOT NULL,
  org_id        TEXT,
  input             TEXT,
  metadata          TEXT,
  started_at        INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_requests_heartbeat  ON active_requests(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_active_requests_user_id    ON active_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_active_requests_session_id ON active_requests(session_id);
`;

const REQUEST_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS request_events (
  request_id      TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_data      TEXT NOT NULL,
  PRIMARY KEY (request_id, sequence_number)
);
CREATE INDEX IF NOT EXISTS idx_request_events_request_id ON request_events(request_id);
`;

/**
 * One-shot rename migrations for databases initialised under the pre-FIX-428
 * `project` scope. SQLite (3.25+) supports `ALTER TABLE ... RENAME COLUMN`
 * and `ALTER TABLE ... RENAME TO`, but neither has an `IF EXISTS` form on the
 * column case — so we probe pragma_table_info / sqlite_master first and only
 * issue the ALTER when the old name is present. Idempotent and cheap on
 * subsequent boots.
 */
function migrateProjectToOrg(db: Database.Database): void {
  const projectsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
    .get();
  const orgsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orgs'")
    .get();
  if (projectsTable !== undefined && orgsTable === undefined) {
    db.exec("ALTER TABLE projects RENAME TO orgs");
  }

  for (const tableName of ["sessions", "requests", "active_requests"]) {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(tableName);
    if (tableExists === undefined) continue;

    const cols = db
      .prepare(`SELECT name FROM pragma_table_info(?)`)
      .all(tableName) as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (colNames.has("project_id") && !colNames.has("org_id")) {
      db.exec(`ALTER TABLE ${tableName} RENAME COLUMN project_id TO org_id`);
    }
  }

  // Index renames are best-effort; older deployments may have already dropped
  // them. SQLite has no `ALTER INDEX RENAME`, so we drop+recreate via the
  // standard `CREATE INDEX IF NOT EXISTS` path below. Leftover indexes with
  // the old names are harmless.
  for (const oldName of [
    "idx_requests_project_id",
    "idx_projects_user_id",
    "idx_projects_updated_at"
  ]) {
    db.exec(`DROP INDEX IF EXISTS ${oldName}`);
  }
}

/**
 * Apply per-connection PRAGMAs (busy_timeout, synchronous, cache_size,
 * temp_store, foreign_keys) plus journal_mode (persisted on the database
 * file but cheap to re-issue). Every new better-sqlite3 connection starts
 * with SQLite defaults — notably `busy_timeout = 0`, which fails concurrent
 * writes immediately with SQLITE_BUSY instead of waiting. This MUST run
 * on every fresh connection, including ones constructed with
 * `skipSchemaInit: true`.
 */
export function applyConnectionPragmas(db: Database.Database): void {
  for (const line of PRAGMAS.trim().split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      db.pragma(trimmed.replace("PRAGMA ", "").replace(";", ""));
    }
  }
}

/**
 * Run schema DDL: rename migrations + create-table-if-not-exists +
 * create-index-if-not-exists. Idempotent. Does NOT apply per-connection
 * pragmas — call `applyConnectionPragmas` for that.
 */
export function initializeSchemaDDL(db: Database.Database): void {
  // Run rename migrations BEFORE create-table-if-not-exists so the create
  // sees the renamed columns and the create-index-if-not-exists step finds
  // its target columns.
  migrateProjectToOrg(db);

  // Create tables and indexes
  db.exec(SESSIONS_TABLE);
  db.exec(REQUESTS_TABLE);
  db.exec(USERS_TABLE);
  db.exec(ORGS_TABLE);
  db.exec(ACTIVE_REQUESTS_TABLE);
  db.exec(REQUEST_EVENTS_TABLE);
}

/**
 * Apply per-connection pragmas and run schema DDL. Convenience wrapper for
 * standalone callers that own their own `Database` instance and want both
 * in one call.
 *
 * `createSQLiteStores` does not use this — it calls `applyConnectionPragmas`
 * unconditionally and `initializeSchemaDDL` only when `skipSchemaInit` is
 * not set, so a runtime registry constructed with `skipSchemaInit: true`
 * still gets the pragmas required for safe concurrent access.
 */
export function initializeSchema(db: Database.Database): void {
  applyConnectionPragmas(db);
  initializeSchemaDDL(db);
}
