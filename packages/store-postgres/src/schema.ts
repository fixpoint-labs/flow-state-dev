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
  input             TEXT,
  metadata          TEXT,
  started_at        BIGINT NOT NULL,
  last_heartbeat_at BIGINT NOT NULL
);
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

/**
 * Stable advisory lock key for schema initialization.
 * Prevents concurrent `CREATE TABLE IF NOT EXISTS` races in serverless
 * environments where multiple cold starts hit initializeSchema simultaneously.
 * (Postgres `IF NOT EXISTS` checks and type catalog inserts are not atomic —
 * two concurrent CREATE TABLE statements can both pass the existence check
 * and then collide on the pg_type unique constraint.)
 */
const SCHEMA_LOCK_KEY = 819297; // arbitrary stable integer

function getSchemaDDL(): { tables: string[]; indexes: string[] } {
  return {
    tables: [
      SESSIONS_TABLE,
      REQUESTS_TABLE,
      USERS_TABLE,
      ORGS_TABLE,
      ACTIVE_REQUESTS_TABLE,
      RESOURCE_CONTENT_TABLE,
      REQUEST_EVENTS_TABLE
    ],
    indexes: [
      ...SESSIONS_INDEXES,
      ...REQUESTS_INDEXES,
      ...USERS_INDEXES,
      ...ORGS_INDEXES,
      ...ACTIVE_REQUESTS_INDEXES,
      ...RESOURCE_CONTENT_INDEXES,
      ...REQUEST_EVENTS_INDEXES
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
  const { tables, indexes } = getSchemaDDL();

  await executor.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
  try {
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
  const { tables, indexes } = getSchemaDDL();
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
