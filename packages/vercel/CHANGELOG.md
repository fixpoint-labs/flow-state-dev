# @flow-state-dev/vercel

## 0.2.0

### Minor Changes

- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.

### Patch Changes

- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [b75c1ed]
- Updated dependencies [1355483]
- Updated dependencies [211679a]
- Updated dependencies [8a55e23]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [c57890d]
- Updated dependencies [7d4c413]
- Updated dependencies [a64132b]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [8b8ba8d]
- Updated dependencies [64b3ed7]
  - @flow-state-dev/engine@0.3.0
  - @flow-state-dev/scheduled@0.3.0
  - @flow-state-dev/store-postgres@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [e4c443e]
- Updated dependencies [e4b6576]
  - @flow-state-dev/engine@0.2.0
  - @flow-state-dev/scheduled@0.2.0
  - @flow-state-dev/store-postgres@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/engine@0.1.2
  - @flow-state-dev/scheduled@0.1.2
  - @flow-state-dev/store-postgres@0.1.2

## 0.1.1

### Patch Changes

- @flow-state-dev/engine@0.1.1
- @flow-state-dev/scheduled@0.1.1
- @flow-state-dev/store-postgres@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [5fa52aa]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/engine@0.1.0
  - @flow-state-dev/store-postgres@0.1.0
  - @flow-state-dev/scheduled@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Bash tool: working bash on Vercel without operator setup (FIX-587)

The Vercel sandbox adapter's `enrichVercelError` now recognizes `VercelOidcContextError` and `LocalOidcContextError` (thrown before any HTTP call when no OIDC token is available) and wraps every adapter method, not just `Sandbox.create()` / `get()`. Default `destination` is now `/vercel/sandbox/workspace` (the only writable home under the Vercel Sandbox runtime user). New "Using the bash tool on Vercel" deployment guide.

### 2026-05-11 — Scheduled actions: schedule index (FIX-581)

`@flow-state-dev/vercel/schedules` ships `createGetToPostCronShim` and `createScheduleTickHandler`. Vercel hosts no longer need to hand-roll the GET-to-POST adapter or the polling tick; both helpers authenticate with constant-time bearer comparison and forward the same secret to the dispatch endpoint.

### 2026-05-10 — Scheduled actions: declarative cron (FIX-440)

Vercel Cron integration guide ships alongside the new `@flow-state-dev/scheduled` package and the framework's `defineFlow({ schedules })` block.

### 2026-05-07 — Live tail on Vercel + Neon

The Vercel deployment example explicitly passes `liveTailPool: null` to force the polling fallback. Polling is correct for serverless deployments where listener sessions don't survive function recycles, and the ~250ms tail latency is invisible behind model generation. Local-with-Postgres deployments keep LISTEN/NOTIFY.

### 2026-04-30 — Connection resilience (FIX-476)

Vercel adapter no longer injects heartbeats itself — the core handles it. `VercelHandlerOptions.heartbeatMs` is now a deprecated no-op; configure via `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })` instead.
