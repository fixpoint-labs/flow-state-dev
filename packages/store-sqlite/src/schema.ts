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
  source            TEXT NOT NULL DEFAULT 'http',
  input             TEXT,
  metadata          TEXT,
  started_at        INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_requests_heartbeat  ON active_requests(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_active_requests_user_id    ON active_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_active_requests_session_id ON active_requests(session_id);
`;

/**
 * Add `source` column to pre-FIX-438 `active_requests` tables. SQLite has
 * no `ADD COLUMN IF NOT EXISTS`, so we probe `pragma_table_info` first.
 * The new column carries a `NOT NULL DEFAULT 'http'` so existing rows
 * read back as the HTTP transport without needing a data backfill.
 */
function migrateAddActiveRequestsSource(db: Database.Database): void {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'active_requests'")
    .get();
  if (tableExists === undefined) return;

  const cols = db
    .prepare("SELECT name FROM pragma_table_info('active_requests')")
    .all() as Array<{ name: string }>;
  const hasSource = cols.some((c) => c.name === "source");
  if (!hasSource) {
    db.exec("ALTER TABLE active_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'http'");
  }
}

const REQUEST_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS request_events (
  request_id      TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_data      TEXT NOT NULL,
  PRIMARY KEY (request_id, sequence_number)
);
CREATE INDEX IF NOT EXISTS idx_request_events_request_id ON request_events(request_id);
`;

// FIX-401: durable sequencer checkpoints. Identity is
// (request_id, block_instance_id); upsert overwrites latest, delete removes
// at terminal completion. `data` carries the full SequencerCheckpoint JSON
// so the schema can evolve without ALTER TABLE — scalar columns are indexed
// access paths only, never the source of truth for record content.
const SEQUENCER_CHECKPOINTS_TABLE = `
CREATE TABLE IF NOT EXISTS sequencer_checkpoints (
  request_id               TEXT NOT NULL,
  block_instance_id        TEXT NOT NULL,
  parent_block_instance_id TEXT,
  step_index               INTEGER NOT NULL,
  version                  INTEGER NOT NULL,
  created_at               INTEGER NOT NULL,
  data                     TEXT NOT NULL,
  PRIMARY KEY (request_id, block_instance_id)
);
CREATE INDEX IF NOT EXISTS idx_sequencer_checkpoints_request_id ON sequencer_checkpoints(request_id);
`;

// FIX-506: per-request trace event log with FIFO retention by request.
// `trace_request_roster` records the insertion timestamp of each retained
// request — retention deletes the oldest roster rows and the foreign-key
// cascade reaps the matching events. `item` carries the BlockOutput /
// RouterDecision / StateSnapshot / BlockDebug item JSON so the schema can
// evolve without ALTER TABLE.
const TRACE_REQUEST_ROSTER_TABLE = `
CREATE TABLE IF NOT EXISTS trace_request_roster (
  request_id  TEXT PRIMARY KEY,
  inserted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_request_roster_inserted_at ON trace_request_roster(inserted_at);
`;

// FIX-402: per-request runOnce result store. Identity is (request_id, key);
// inserts replace any prior row for the same pair. Same retention model as
// `request_events` / `sequencer_checkpoints` — no FK to `requests`; rows
// are pruned by the same request-lifecycle cleanup path the rest of the
// per-request tables use.
const REQUEST_RUNONCE_TABLE = `
CREATE TABLE IF NOT EXISTS request_runonce (
  request_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (request_id, key)
);
CREATE INDEX IF NOT EXISTS idx_request_runonce_request_id ON request_runonce(request_id);
`;

const TRACE_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS trace_events (
  request_id      TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  ts              INTEGER NOT NULL,
  type            TEXT NOT NULL,
  item            TEXT NOT NULL,
  PRIMARY KEY (request_id, sequence_number),
  FOREIGN KEY (request_id) REFERENCES trace_request_roster(request_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trace_events_request_id ON trace_events(request_id);
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
  migrateAddActiveRequestsSource(db);

  // Create tables and indexes
  db.exec(SESSIONS_TABLE);
  db.exec(REQUESTS_TABLE);
  db.exec(USERS_TABLE);
  db.exec(ORGS_TABLE);
  db.exec(ACTIVE_REQUESTS_TABLE);
  db.exec(REQUEST_EVENTS_TABLE);
  db.exec(REQUEST_RUNONCE_TABLE);
  db.exec(SEQUENCER_CHECKPOINTS_TABLE);
  db.exec(TRACE_REQUEST_ROSTER_TABLE);
  db.exec(TRACE_EVENTS_TABLE);
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
