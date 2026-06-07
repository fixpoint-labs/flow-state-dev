/**
 * PostgreSQL schema initialization for the store adapter.
 * Creates tables and indexes idempotently using IF NOT EXISTS.
 */

import type { QueryExecutor } from "./types";

const SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  flow_kind   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  org_id  TEXT,
  version     INTEGER NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  data        JSONB NOT NULL
);
`;

const SESSIONS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_sessions_flow_kind   ON sessions(flow_kind)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user_id     ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_flow_user   ON sessions(flow_kind, user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_updated_at  ON sessions(updated_at)"
];

const REQUESTS_TABLE = `
CREATE TABLE IF NOT EXISTS requests (
  id          TEXT PRIMARY KEY,
  flow_kind   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  org_id  TEXT,
  status      TEXT NOT NULL,
  version     INTEGER NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  data        JSONB NOT NULL
);
`;

const REQUESTS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_requests_flow_kind       ON requests(flow_kind)",
  "CREATE INDEX IF NOT EXISTS idx_requests_session_id      ON requests(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_requests_user_id         ON requests(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_requests_org_id      ON requests(org_id)",
  "CREATE INDEX IF NOT EXISTS idx_requests_status          ON requests(status)",
  "CREATE INDEX IF NOT EXISTS idx_requests_session_status  ON requests(session_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_requests_flow_user       ON requests(flow_kind, user_id)",
  "CREATE INDEX IF NOT EXISTS idx_requests_updated_at      ON requests(updated_at)"
];

const USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  data        JSONB NOT NULL
);
`;

const USERS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at)"
];

const ORGS_TABLE = `
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  version     INTEGER NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  data        JSONB NOT NULL
);
`;

const ORGS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_orgs_user_id    ON orgs(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_orgs_updated_at ON orgs(updated_at)"
];

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
  started_at        BIGINT NOT NULL,
  last_heartbeat_at BIGINT NOT NULL
);
`;

/**
 * Add `source` column to pre-FIX-438 `active_requests` tables.
 * Idempotent — wrapped in a DO block so absence of the column on a fresh
 * database is a no-op.
 */
const ADD_ACTIVE_REQUESTS_SOURCE_MIGRATION = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'active_requests'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'active_requests' AND column_name = 'source'
  ) THEN
    EXECUTE 'ALTER TABLE active_requests ADD COLUMN source TEXT NOT NULL DEFAULT ''http''';
  END IF;
END $$;
`;

const ACTIVE_REQUESTS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_active_requests_heartbeat  ON active_requests(last_heartbeat_at)",
  "CREATE INDEX IF NOT EXISTS idx_active_requests_user_id    ON active_requests(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_active_requests_session_id ON active_requests(session_id)"
];

const RESOURCE_CONTENT_TABLE = `
CREATE TABLE IF NOT EXISTS resource_content (
  scope_type    TEXT NOT NULL,
  scope_id      TEXT NOT NULL,
  resource_key  TEXT NOT NULL,
  content       TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id, resource_key)
);
`;

const RESOURCE_CONTENT_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_resource_content_scope ON resource_content(scope_type, scope_id)"
];

const RESOURCE_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS resource_state (
  scope_type    TEXT NOT NULL,
  scope_id      TEXT NOT NULL,
  resource_key  TEXT NOT NULL,
  state         JSONB NOT NULL,
  PRIMARY KEY (scope_type, scope_id, resource_key)
);
`;

const RESOURCE_STATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_resource_state_scope ON resource_state(scope_type, scope_id)"
];

const REQUEST_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS request_events (
  request_id      TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_data      TEXT NOT NULL,
  PRIMARY KEY (request_id, sequence_number)
);
`;

const REQUEST_EVENTS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_request_events_request_id ON request_events(request_id)"
];

// Request items: one row per item produced by a request. PK
// `(request_id, item_id)` so keyed-component re-emissions UPSERT in place.
// Per-row storage keeps unchanged rows out of every flush's TOAST rewrite.
const REQUEST_ITEMS_TABLE = `
CREATE TABLE IF NOT EXISTS request_items (
  request_id  TEXT   NOT NULL,
  item_id     TEXT   NOT NULL,
  sequence    BIGINT NOT NULL,
  item_type   TEXT   NOT NULL,
  data        JSONB  NOT NULL,
  PRIMARY KEY (request_id, item_id)
);
`;

const REQUEST_ITEMS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_request_items_request_sequence ON request_items(request_id, sequence)"
];

// FIX-401: durable sequencer checkpoints. Identity is
// (request_id, block_instance_id); upsert overwrites the latest record,
// delete removes it at terminal completion. `data` is JSONB so the schema
// can evolve without ALTER TABLE — scalar columns are indexed access paths
// only, never the source of truth for record content.
const SEQUENCER_CHECKPOINTS_TABLE = `
CREATE TABLE IF NOT EXISTS sequencer_checkpoints (
  request_id               TEXT NOT NULL,
  block_instance_id        TEXT NOT NULL,
  parent_block_instance_id TEXT,
  step_index               INTEGER NOT NULL,
  version                  INTEGER NOT NULL,
  created_at               BIGINT NOT NULL,
  data                     JSONB NOT NULL,
  PRIMARY KEY (request_id, block_instance_id)
);
`;

const SEQUENCER_CHECKPOINTS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_sequencer_checkpoints_request_id ON sequencer_checkpoints(request_id)"
];

// Optional schedule index for `createPostgresScheduleIndex`. Keyed by
// (user_id, key) — a derived read-model of per-user schedule resource
// collections. `next_fire_at` is ms since epoch and is scanned/advanced
// inside one transaction by claimDue (SELECT ... FOR UPDATE SKIP LOCKED).
const SCHEDULE_INDEX_TABLE = `
CREATE TABLE IF NOT EXISTS schedule_index (
  user_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  cron         TEXT NOT NULL,
  timezone     TEXT,
  next_fire_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, key)
);
`;

const SCHEDULE_INDEX_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_schedule_index_next_fire_at ON schedule_index (next_fire_at)"
];

// Per-request runOnce result store. Identity is (request_id, key); inserts
// upsert on the primary key. `value` is JSONB so adapters can roundtrip
// arbitrary JSON-serializable results without ALTER TABLE.
const REQUEST_RUNONCE_TABLE = `
CREATE TABLE IF NOT EXISTS request_runonce (
  request_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  PRIMARY KEY (request_id, key)
);
`;

const REQUEST_RUNONCE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_request_runonce_request_id ON request_runonce(request_id)"
];

// FIX-140: suspension records for durable execution. Identity is
// (request_id, suspension_id); `data` is JSONB storing the full
// SuspensionRecord. Scalar columns enable indexed queries.
const SUSPENSION_RECORDS_TABLE = `
CREATE TABLE IF NOT EXISTS suspension_records (
  request_id    TEXT NOT NULL,
  suspension_id TEXT NOT NULL,
  data          JSONB NOT NULL,
  created_at    BIGINT NOT NULL,
  PRIMARY KEY (request_id, suspension_id)
);
`;

const SUSPENSION_RECORDS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_suspension_records_request_id ON suspension_records(request_id)",
  "CREATE INDEX IF NOT EXISTS idx_suspension_records_created_at ON suspension_records(created_at)"
];

// FIX-140: lease records for preventing concurrent resume. One active
// lease per request at a time.
const LEASES_TABLE = `
CREATE TABLE IF NOT EXISTS leases (
  request_id  TEXT PRIMARY KEY,
  lease_id    TEXT NOT NULL,
  holder      TEXT NOT NULL,
  acquired_at BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL
);
`;

const LEASES_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_leases_expires_at ON leases(expires_at)"
];

/**
 * One-shot rename migrations for deployments that ran the pre-FIX-428 schema
 * (project scope). Idempotent: each statement no-ops once the new name is in
 * place, so subsequent boots are cheap. Must run BEFORE the CREATE TABLE / INDEX
 * DDL so the create steps see the renamed columns and don't try to add an
 * `org_id` index to a table that still has `project_id`.
 */
const PROJECT_TO_ORG_MIGRATIONS = [
  // Rename the `projects` table to `orgs` only when `projects` exists and
  // `orgs` does not — a fresh database skips both branches.
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'projects')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'orgs') THEN
      EXECUTE 'ALTER TABLE projects RENAME TO orgs';
    END IF;
  END $$;`,

  // Rename `project_id` columns on each table that carries one. Wrapped in a
  // DO block so the absence of the old column on a fresh database is a no-op
  // rather than a hard error.
  `DO $$
  DECLARE
    t TEXT;
  BEGIN
    FOREACH t IN ARRAY ARRAY['sessions', 'requests', 'active_requests']
    LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = t AND column_name = 'project_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = t AND column_name = 'org_id'
      ) THEN
        EXECUTE format('ALTER TABLE %I RENAME COLUMN project_id TO org_id', t);
      END IF;
    END LOOP;
  END $$;`,

  // Rename indexes whose names referenced the old column. `ALTER INDEX IF
  // EXISTS` is a no-op on a fresh database (where the new name is created
  // directly by the CREATE INDEX block below).
  "ALTER INDEX IF EXISTS idx_requests_project_id RENAME TO idx_requests_org_id",
  "ALTER INDEX IF EXISTS idx_projects_user_id RENAME TO idx_orgs_user_id",
  "ALTER INDEX IF EXISTS idx_projects_updated_at RENAME TO idx_orgs_updated_at",

  // FIX-438: ensure `active_requests.source` exists on pre-FIX-438 schemas.
  // Idempotent on fresh databases.
  ADD_ACTIVE_REQUESTS_SOURCE_MIGRATION
];

/**
 * Stable advisory lock key for schema initialization.
 * Prevents concurrent `CREATE TABLE IF NOT EXISTS` races in serverless
 * environments where multiple cold starts hit initializeSchema simultaneously.
 * (Postgres `IF NOT EXISTS` checks and type catalog inserts are not atomic —
 * two concurrent CREATE TABLE statements can both pass the existence check
 * and then collide on the pg_type unique constraint.)
 */
const SCHEMA_LOCK_KEY = 819297; // arbitrary stable integer

function getSchemaDDL(): { migrations: string[]; tables: string[]; indexes: string[] } {
  return {
    migrations: PROJECT_TO_ORG_MIGRATIONS,
    tables: [
      SESSIONS_TABLE,
      REQUESTS_TABLE,
      USERS_TABLE,
      ORGS_TABLE,
      ACTIVE_REQUESTS_TABLE,
      RESOURCE_CONTENT_TABLE,
      RESOURCE_STATE_TABLE,
      REQUEST_EVENTS_TABLE,
      REQUEST_ITEMS_TABLE,
      REQUEST_RUNONCE_TABLE,
      SEQUENCER_CHECKPOINTS_TABLE,
      SCHEDULE_INDEX_TABLE,
      SUSPENSION_RECORDS_TABLE,
      LEASES_TABLE
    ],
    indexes: [
      ...SESSIONS_INDEXES,
      ...REQUESTS_INDEXES,
      ...USERS_INDEXES,
      ...ORGS_INDEXES,
      ...ACTIVE_REQUESTS_INDEXES,
      ...RESOURCE_CONTENT_INDEXES,
      ...RESOURCE_STATE_INDEXES,
      ...REQUEST_EVENTS_INDEXES,
      ...REQUEST_ITEMS_INDEXES,
      ...REQUEST_RUNONCE_INDEXES,
      ...SEQUENCER_CHECKPOINTS_INDEXES,
      ...SCHEDULE_INDEX_INDEXES,
      ...SUSPENSION_RECORDS_INDEXES,
      ...LEASES_INDEXES
    ]
  };
}

/**
 * Initialize the schema using a QueryExecutor. Each query may run on a
 * different pool connection, so the advisory lock may leak onto an
 * unknown connection. Prefer `initializeSchemaWithDedicatedClient` when
 * you have direct pg.Pool access.
 */
export async function initializeSchema(executor: QueryExecutor): Promise<void> {
  const { migrations, tables, indexes } = getSchemaDDL();

  await executor.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
  try {
    for (const ddl of migrations) {
      await executor.query(ddl);
    }
    for (const ddl of tables) {
      await executor.query(ddl);
    }
    for (const ddl of indexes) {
      await executor.query(ddl);
    }
  } finally {
    await executor.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
  }
}

/**
 * Initialize the schema using a dedicated pool client so the advisory lock
 * and all DDL run on the same connection. This is critical for serverless —
 * a leaked lock (from lock/unlock on different connections) blocks other
 * function instances from initializing schema and causes indefinite hangs.
 *
 * Uses `pg_try_advisory_lock` with a retry loop rather than blocking
 * `pg_advisory_lock`, so a stuck lock from a prior instance doesn't hang
 * the current function.
 */
export async function initializeSchemaWithDedicatedClient(
  pool: import("pg").Pool
): Promise<void> {
  const { migrations, tables, indexes } = getSchemaDDL();
  const client = await pool.connect();

  try {
    // Try the lock up to 20 times with 500ms between attempts (10s total).
    // If we never get it, skip schema init — another instance is presumably
    // running it, or the schema is already initialized.
    let locked = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await client.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [SCHEMA_LOCK_KEY]
      );
      if (result.rows[0]?.locked === true) {
        locked = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!locked) {
      // Could not acquire lock — assume schema is being initialized elsewhere
      // or already exists. Our DDL uses IF NOT EXISTS so this is safe.
      console.warn(
        "[flow-state/store-postgres] could not acquire schema advisory lock; skipping init"
      );
      return;
    }

    try {
      for (const ddl of migrations) {
        await client.query(ddl);
      }
      for (const ddl of tables) {
        await client.query(ddl);
      }
      for (const ddl of indexes) {
        await client.query(ddl);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
