---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/testing": minor
"@flow-state-dev/orchestration": patch
"@flow-state-dev/patterns": patch
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

A numeric `expectedVersion` must be a non-negative integer. `0` means "no live
row" and real versions start at `1`, so a negative, fractional, `NaN` or
infinite version names nothing the store can hold — it throws rather than
reporting a conflict, because it is a programming error at the call site and
not a lost race.

A state you read is a snapshot, not a live handle into the store. Mutating what
`get` / `getAll` / `getByPrefix` returned does not change what is stored, the
object you passed to `set` stays yours to mutate afterwards, and the
`currentValue` a conflict reports is a copy too. This is what makes the version
mean anything: if a caller could change the stored value without going through
`set`, the value would move while the version stood still, and a later write at
the old version would commit against data that had already changed.

The snapshot is taken before `set` yields, not merely somewhere inside it.
Serializing eventually is not enough. An adapter that copies only after an
`await` has already handed control back to the caller, so whatever the caller
does to the object while the write is in flight becomes the value that lands.
The in-memory adapter copies on the way in and on the way out; the SQL adapters
serialize on the synchronous run-up to their first query; the filesystem adapter
now snapshots before taking its per-key lock rather than inside the guarded
body. The shared conformance suite pins both the copy and its timing for all
four.

`delete` distinguishes what the caller asserted when it finds nothing to remove
and a live row turns up before it can report why. `"any"` asserted nothing about
versions, so "no live row existed" already answers it: idempotent success at
`version: 0`, with a recreate that raced in belonging to a later story. A
positive `expectedVersion` asserted something that did not hold, so it still
conflicts.

SQLite and Postgres migrate automatically with `ADD COLUMN` only: no table
rebuild, no backfill, indexes untouched, and rows written before the upgrade
read as live at version 1. The filesystem adapter commits state and metadata as
a single record so the two can never disagree after a crash.

Flow-authoring code is unchanged — nobody writes `expectedVersion` in a flow,
and the runtime still writes resource state unconditionally, so resource
mutations from flow code remain last-write-wins until that path passes the
version it observed. The adapter, engine, orchestration and patterns READMEs
now scope their concurrency claims to match: the store-level compare-and-swap
is real, the flow path does not use it yet, and a task board on the resource
backing keeps claims exclusive within one process rather than across two.

Callers of the store interface directly (including test harnesses) now pass a
posture explicitly. `VersionedResourceState` is branded so it is not assignable
to `JsonObject`: a read handed on without unwrapping is a compile error, and
`toBareState` / `toBareStates` are the way down. The brand is phantom and optional, so
constructing one is still a plain object literal.

`toBareState` and `toBareStates` are generic in the state shape — `toBareStates<InboxRecord>(rows)`
hands back `Record<string, InboxRecord>` — and default to `JsonObject`, so callers
that only want bare state are unchanged. The shape is asserted, not validated, but
the `JsonObject` bound rejects any shape the store could not have held, including
`VersionedResourceState` itself, so the projection cannot be used to launder the
versioned shape back in.
