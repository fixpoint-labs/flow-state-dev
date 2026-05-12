---
sidebar_position: 5
---

# Schedule index

The schedule index is an opt-in side table that lets a polling cron tick
find due dynamic schedules in one query. Store adapters expose it
through the `ScheduleIndex` interface; `defineScheduleCollection` keeps
it in sync with the resource collection that holds your schedule
records.

If you only run static schedules (declared in flow source), you don't
need this. If you run dynamic schedules and dispatch them from a single
cron beat, you do.

## Why the index exists

Without an index, "find every schedule due right now" is a scan of every
user's schedule collection. A small deployment can get away with that.
A real one can't.

The index trades a small amount of write-side work for a constant-time
read. Each create/update/delete on the schedule collection mirrors a row
into a flat `(user_id, key, cron, timezone, next_fire_at)` table. Each
cron tick claims rows where `next_fire_at <= now`, advances them
in-place using `cron-parser`, and returns them. The contract is
at-most-once: a row that has been advanced and then fails to dispatch
is dropped, not retried.

## Interface

```ts
export interface ScheduleIndexRow {
  userId: string;
  key: string;
  cron: string;
  timezone?: string;
  nextFireAt: number;
}

export interface ScheduleIndex {
  upsert(row: ScheduleIndexRow): Promise<void>;
  /** Atomically claim due rows AND advance them. limit default 100. */
  claimDue(now: number, limit?: number): Promise<ScheduleIndexRow[]>;
  remove(userId: string, key: string): Promise<void>;
}
```

`claimDue` advances internally — in one transaction — so a second
caller at the same `now` will not see the same row.

## Provided implementations

### `createPostgresScheduleIndex`

```ts
import { createPostgresScheduleIndex } from "@flow-state-dev/store-postgres";

const index = createPostgresScheduleIndex(executor);
```

Uses `SELECT ... FOR UPDATE SKIP LOCKED` plus a batched UPDATE inside a
single transaction. Requires the executor to implement `beginTx()` —
the pool-backed executors created by `createPostgresStores` do; custom
executors (e.g. PGlite in tests) must implement it themselves.

### `createSQLiteScheduleIndex`

```ts
import { createSQLiteScheduleIndex } from "@flow-state-dev/store-sqlite";

const index = createSQLiteScheduleIndex(db);
```

Uses `db.transaction` (BEGIN IMMEDIATE) to serialize claim+advance
against writers. better-sqlite3 is synchronous; the interface is async
so deployments can swap in a remote index later without changing call
sites.

## Auto-mirroring

`defineScheduleCollection` is the single auto-mirror path. It wraps
`defineResourceCollection`, installs the schedule state schema, and on
each create/update/delete computes a `nextFireAt` from the row's cron
and upserts/removes the matching index row.

```ts
import { defineScheduleCollection } from "@flow-state-dev/scheduled";
import { createSQLiteScheduleIndex } from "@flow-state-dev/store-sqlite";

const index = createSQLiteScheduleIndex(db);

const schedules = defineScheduleCollection({
  pattern: "schedules/*",
  index
});
```

Omit `index` and the collection still works — no hooks fire, no rows
are mirrored. Useful when you want the schema but plan to populate the
index elsewhere.

Rows with `enabled: false` are removed from the index (or skipped on
create), so toggling a schedule off stops it firing without deleting
the underlying record.

## Custom implementations

Any backend that can provide atomic claim+advance can implement the
interface. The shape is small: three methods, async-shaped. Implement
`claimDue` against your storage's equivalent of `SELECT ... FOR UPDATE
SKIP LOCKED` (or single-writer serialization, as SQLite does) and the
rest follows.

A conformance suite is published at `@flow-state-dev/scheduled/testing`:

```ts
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";

createScheduleIndexConformanceTests("my-backend", {
  createIndex: () => /* ... */,
  cleanup: (idx) => /* ... */
});
```

Drop that inside a vitest file and it will exercise upsert idempotence,
claim+advance, the bad-cron skip path, no-op remove, and the limit
parameter.

## At-most-once contract

The index advances rows before returning them. A dispatch that fails
after the row has been advanced is logged and dropped, not retried.

This is a deliberate tradeoff:

- Implementations are simple. There's no lease, no second phase, no
  outbox.
- Operationally cheap. One transaction per claim, no compensation
  logic.
- Skipped fires are visible. Hook `onDispatch` and you'll see the
  status code (or `0` for transport errors) for every attempt.

If you need at-least-once, the framework's scheduled actions are not
the right tool — use a queue with explicit acks.
