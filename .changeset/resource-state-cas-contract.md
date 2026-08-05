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
costs one small row per deleted key. Delete is idempotent at the terminal
state: deleting an absent or already-tombstoned key succeeds, including when
two deletes of the same live key race each other. A conflict means a version
mismatch against a row that is still live, and nothing else.

SQLite and Postgres migrate automatically with `ADD COLUMN` only: no table
rebuild, no backfill, indexes untouched, and rows written before the upgrade
read as live at version 1. The filesystem adapter commits state and metadata as
a single record so the two can never disagree after a crash.

Flow-authoring code is unchanged — nobody writes `expectedVersion` in a flow,
and the runtime still writes resource state unconditionally, so resource
mutations from flow code remain last-write-wins until that path passes the
version it observed.

Callers of the store interface directly (including test harnesses) now pass a
posture explicitly. `VersionedResourceState` is branded so it is not assignable
to `JsonObject`: a read handed on without unwrapping is a compile error, and
`toState` / `toStates` are the way down. The brand is phantom and optional, so
constructing one is still a plain object literal.
