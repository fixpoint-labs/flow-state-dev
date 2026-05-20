# @flow-state-dev/store-postgres

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-16 — Idempotency primitives on handler context (FIX-402)

New `request_runonce(request_id, key, value)` table backs `getRunOnceResult` / `setRunOnceResult` on the Postgres `RequestStore`.

### 2026-05-14 — Delta store verbs (FIX-405)

Postgres ships the optional `patchField`, `incField`, and `pushToArray` verbs natively via `jsonb_set` and `||` wrapped in `UPDATE ... WHERE version = ?` so the row-level CAS contract from FIX-400 still holds for delta paths. A 100-op `patchField` benchmark against PGlite passes within 2× the cost of 100 `set` calls.

### 2026-05-11 — Scheduled actions: schedule index (FIX-581)

New `createPostgresScheduleIndex` factory ships a `ScheduleIndex` implementation supporting `upsert`, `remove`, and atomic `claimDue`.

### 2026-05-07 — Live tail on Vercel + Neon

`liveTailPool` now spreads the caller's `poolOptions` so driver-level overrides (Neon's WebSocket `Client`, custom `connectionTimeoutMillis`, etc.) carry over. `max` and `allowExitOnIdle` remain tail-specific. A new conformance run against `createPostgresRequestStore` configured with `liveTailPool: null` locks in the polling path so future regressions get caught by package tests.

### 2026-05-07 — Store-driven live tail (FIX-569)

Postgres `RequestStore` implements `subscribeToEvents` two ways. With `liveTailPool` it uses `LISTEN flow_events` on a dedicated client with a signal-only payload, single global channel, and dirty-bit burst coalescing. Without it falls back to polling (correct for serverless deployments where listener sessions don't survive function recycles). PGlite always polls. `createPostgresStores` accepts `liveTailPool` separately; when omitted it auto-creates a fresh `Pool({ max: LIVE_TAIL_POOL_MAX ?? 10 })`. New liveness timeout (`LIVE_TAIL_LIVENESS_MS`, default 30s).

### 2026-05-02 — Resource content moved out of scope records (FIX-347)

Dedicated `resource_content` table; content no longer rides inline on the scope record.

### 2026-04-28 — Durable sequencer checkpoint schema (FIX-401)

Postgres `CheckpointStore` implementation ships alongside memory, filesystem, and SQLite.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Postgres scope tables renamed `project` → `org`.
