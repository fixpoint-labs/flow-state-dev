# @flow-state-dev/store-sqlite

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-16 — Idempotency primitives on handler context (FIX-402)

New `request_runonce(request_id, key, value)` table backs the `getRunOnceResult` / `setRunOnceResult` methods on the SQLite `RequestStore`.

### 2026-05-14 — Delta store verbs (FIX-405)

SQLite continues to work via the `set` fallback in `createScopePersist` since it does not advertise the optional `patchField` / `incField` / `pushToArray` verbs.

### 2026-05-11 — Scheduled actions: schedule index (FIX-581)

New `createSQLiteScheduleIndex` factory ships a `ScheduleIndex` implementation that plugs into `defineScheduleCollection` for store-backed schedule fan-out.

### 2026-05-07 — Store-driven live tail (FIX-569)

SQLite `RequestStore` implements the new `subscribeToEvents(requestId, options)` method via polling on a fixed interval. The shared conformance harness exercises it.

### 2026-05-07 — Filesystem trace store + dev defaults (FIX-558)

SQLite trace store picks `traceStore.maxRequests` from the environment (1000 in development, 50 otherwise). Runs against the new `createTraceStoreConformanceTests` shared suite.

### 2026-05-02 — Resource content moved out of scope records (FIX-347)

Dedicated `resource_content` table; content no longer rides inline on the scope record.

### 2026-04-29 — Inbound transport adapter contract (FIX-438)

SQLite migration adds the `source` column on the request-record table with `DEFAULT 'http'`.

### 2026-04-28 — Durable sequencer checkpoint schema (FIX-401)

SQLite `CheckpointStore` implementation ships alongside memory, filesystem, and Postgres.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

SQLite scope tables renamed `project` → `org`. No data migration; pre-1.0 dev/test data under `project-store/` should be recreated.
