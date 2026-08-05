---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/testing": minor
---

Resource state is now compare-and-swap instead of last-write-wins.

`ResourceStateStore` was built as `ContentStore`'s twin, sharing its
last-write-wins model. That model is right for a document body nothing merges
against a prior read, and wrong for structured state concurrent workers
read-modify-write — which is what resource state became when it started backing
task boards. Two contexts patching different fields of one resource could
silently lose one of the writes.

`set` and `delete` now take an `ExpectedVersion` and return a `SetResult`, and
`get` / `getAll` / `getByPrefix` return the stored state alongside the version it
was read at. `expectedVersion: 0` means "no live row" (create-if-absent);
`"any"` writes unconditionally.

Deletes mark a lifecycle column and retain the version rather than removing the
row, so a worker holding a version from before a delete can never match the
resource that replaces it. Tombstones are retained indefinitely — nothing
reclaims them — which is what makes the guarantee hold without a sweep, and
costs one small row per deleted key.

SQLite and Postgres migrate automatically with `ADD COLUMN` only: no table
rebuild, no backfill, indexes untouched, and rows written before the upgrade
read as live at version 1. The filesystem adapter commits state and metadata as
a single record so the two can never disagree after a crash.

Flow-authoring code is unchanged — nobody writes `expectedVersion` in a flow.
Callers of the store interface directly (including test harnesses) now pass a
posture explicitly; `toState` / `toStates` are exported for readers that only
want the stored value.
