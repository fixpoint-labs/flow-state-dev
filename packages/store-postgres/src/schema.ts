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
  project_id  TEXT,
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
  project_id  TEXT,
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
  "CREATE INDEX IF NOT EXISTS idx_requests_project_id      ON requests(project_id)",
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

const PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  version     INTEGER NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  data        JSONB NOT NULL
);
`;

const PROJECTS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_projects_user_id    ON projects(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at)"
];

const ACTIVE_REQUESTS_TABLE = `
CREATE TABLE IF NOT EXISTS active_requests (
  request_id        TEXT PRIMARY KEY,
  flow_kind         TEXT NOT NULL,
  action_name       TEXT NOT NULL,
  session_id        TEXT,
  user_id           TEXT NOT NULL,
  project_id        TEXT,
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

export async function initializeSchema(executor: QueryExecutor): Promise<void> {
  const tables = [
    SESSIONS_TABLE,
    REQUESTS_TABLE,
    USERS_TABLE,
    PROJECTS_TABLE,
    ACTIVE_REQUESTS_TABLE,
    RESOURCE_CONTENT_TABLE,
    REQUEST_EVENTS_TABLE
  ];

  const indexes = [
    ...SESSIONS_INDEXES,
    ...REQUESTS_INDEXES,
    ...USERS_INDEXES,
    ...PROJECTS_INDEXES,
    ...ACTIVE_REQUESTS_INDEXES,
    ...RESOURCE_CONTENT_INDEXES,
    ...REQUEST_EVENTS_INDEXES
  ];

  for (const ddl of tables) {
    await executor.query(ddl);
  }

  for (const ddl of indexes) {
    await executor.query(ddl);
  }
}
