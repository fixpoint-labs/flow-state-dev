# @flow-state-dev/store-sqlite

## 0.2.0

### Minor Changes

- b48158a: Organization identity is now required on every request (FIX-1442).

  A session, request, dispatched child and scheduled job each carry an
  organization, and the server checks it on reads and execution alongside the
  user. It comes from a configured `resolvePrincipal`, or — when an app
  configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
  `@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

  **What you need to change**

  - A resolver must return a verified `orgId`. Returning none, a blank one, or
    `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
    `{ orgId }` alone and let `defaultUserId` name its system user.
  - Direct `runAction` calls must pass `orgId` — your verified organization, or
    `DEFAULT_ORG_ID` for single-organization development.
  - `authentication.requireOrg` and a block's `requireOrg` are removed.
    Organization is unconditional, so the declaration had nothing left to say;
    a config that still carries either is rejected at definition time rather
    than ignored.
  - Client and React session APIs no longer take an `orgId` — the server owns
    it. `SessionDetail.orgId` is now required on the way back.
  - `openChannels` no longer takes an `orgId`; the server binds the channel.
  - A queued BullMQ job that carries no organization now fails terminally
    instead of being retried: a worker runs below principal resolution, so no
    later attempt could supply one. Subscribers receive an error terminal rather
    than waiting for a job that never completes.

  **The schedule index stores the organization.** `schedule_index` gains a
  nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
  organization a schedule fires into survives a round trip through the database.
  The column is added for you on the next schema init — there is no manual DDL
  step. Existing rows read back with no organization and are quarantined rather
  than dispatched, so a schedule written before this upgrade does not fire until
  it is attributed; rewriting it stamps the organization of the execution that
  writes it.

  **Upgrading a store with existing data.** Records written before this carry no
  organization. They are preserved and refused (`409 migration-required`) rather
  than guessed at, and listings and scheduler scans skip them. Attribute them
  offline first — the procedure, including dynamic schedules, index rebuild and
  the reserved-id collision check, is in the persistence guide under "Which
  organization a record belongs to".

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
- Updated dependencies [e4b6576]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/engine@0.2.0
  - @flow-state-dev/scheduled@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/engine@0.1.2
  - @flow-state-dev/scheduled@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/engine@0.1.1
  - @flow-state-dev/scheduled@0.1.1

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
