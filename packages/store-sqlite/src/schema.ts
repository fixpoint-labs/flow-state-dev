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

export function initializeSchema(db: Database.Database): void {
  // Apply pragmas (each must be a separate statement)
  for (const line of PRAGMAS.trim().split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      db.pragma(trimmed.replace("PRAGMA ", "").replace(";", ""));
    }
  }

  // Create tables and indexes
  db.exec(SESSIONS_TABLE);
  db.exec(REQUESTS_TABLE);
  db.exec(USERS_TABLE);
  db.exec(ORGS_TABLE);
  db.exec(ACTIVE_REQUESTS_TABLE);
  db.exec(REQUEST_EVENTS_TABLE);
}
