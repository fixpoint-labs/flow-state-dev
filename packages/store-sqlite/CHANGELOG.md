# @flow-state-dev/store-sqlite

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/engine@0.1.0
  - @flow-state-dev/scheduled@0.1.0

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
