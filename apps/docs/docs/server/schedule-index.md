---
sidebar_position: 5
---

# Schedule index

A polling cron tick has to find every schedule that's due right now
across every user, then fan out one POST per due schedule. Without an
index, every tick scans every user's schedules. The schedule index is a
flat side table that turns that lookup into a single indexed range
query.

What you get: one row per active schedule, automatic write-side
maintenance via `defineScheduleCollection`, and an atomic
claim-and-advance primitive (`claimDue`) that's safe under multi-worker
contention on Postgres and serialized on SQLite. The contract is
at-most-once. If you only run static schedules declared in flow source,
you don't need the index. If you run dynamic schedules and dispatch them
from a single cron beat, you do.

## When to use it

| Setup | Needs index? |
|-------|--------------|
| Static schedules only (declared in flow source) | No. Each schedule gets its own cron row. |
| Dynamic schedules, dispatched from a polling tick | Yes. The tick uses `claimDue` to fan out. |
| Dynamic schedules, custom resolver (no polling tick) | No, if your resolver already knows what's due. |
| One managed-scheduler row per dynamic schedule (Cloud Scheduler, EventBridge) | No. The scheduler is the index. |

## How it works

The index trades a small amount of write-side work for a constant-time
read. Each create/update/delete on the schedule collection mirrors a row
into a flat `(cell, key, user_id, org_id, cron, timezone, next_fire_at)`
table. A row is identified by `cell` and `key`: the cell is where the
schedule itself is stored, so one schedule always maps to exactly one
row. For an ordinary flow the cell is the person's own storage; a
[hired seat](/docs/workforce/durable-hire#what-a-seat-saves-for-a-person)
stores per organization and person, so Alice's seats in two
organizations can each have a schedule named `weekly` without touching
each other's row. Each cron tick claims rows where
`next_fire_at <= now`, advances them in place using `cron-parser`, and
returns them. The contract is at-most-once: a row that has been advanced
and then fails to dispatch is dropped, not retried.

## Interface

```ts
export interface ScheduleIndexRow {
  /** Where the schedule is stored. With `key`, the row's identity. */
  cell: string;
  /** Who the schedule runs as. */
  userId: string;
  /** The organization the schedule fires into. */
  orgId?: string;
  key: string;
  cron: string;
  timezone?: string;
  nextFireAt: number;
}

export interface ScheduleIndex {
  /** Insert or update the row for `(cell, key)`. */
  upsert(row: ScheduleIndexRow): Promise<void>;
  /** Atomically claim due rows AND advance them. limit default 100. */
  claimDue(now: number, limit?: number): Promise<ScheduleIndexRow[]>;
  /** Remove the row for `(cell, key)`. No-op when there is none. */
  remove(id: { cell: string; key: string }): Promise<void>;
}
```

Treat `cell` as an opaque string: store it and compare it, never parse it.
`defineScheduleCollection` fills it in for you.

`claimDue` advances internally — in one transaction — so a second
caller at the same `now` will not see the same row.

`orgId` is the organization the schedule was created under, and the one it
fires into. A row can exist without one; a schedule with no organization does
not dispatch — see
[the organization a schedule fires into](./scheduled.md#the-organization-a-schedule-fires-into).

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

Uses `db.transaction(...).immediate` (BEGIN IMMEDIATE) to serialize
claim+advance against writers. better-sqlite3 is synchronous; the
interface is async so deployments can swap in a remote index later
without changing call sites.

## Schema setup

`createPostgresStores` and `createSQLiteStores` create the
`schedule_index` table automatically on construction. If you deploy
with `skipSchemaInit: true` (the recommended path on serverless cold
starts) you need to run the DDL out-of-band — without it, every call
to `upsert`, `remove`, or `claimDue` throws `relation "schedule_index"
does not exist`.

Postgres:

```sql
CREATE TABLE IF NOT EXISTS schedule_index (
  cell         text NOT NULL,
  key          text NOT NULL,
  user_id      text NOT NULL,
  org_id       text,
  cron         text NOT NULL,
  timezone     text,
  next_fire_at bigint NOT NULL,
  PRIMARY KEY (cell, key)
);
CREATE INDEX IF NOT EXISTS idx_schedule_index_next_fire_at
  ON schedule_index (next_fire_at);
```

SQLite:

```sql
CREATE TABLE IF NOT EXISTS schedule_index (
  cell         TEXT NOT NULL,
  key          TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  org_id       TEXT,
  cron         TEXT NOT NULL,
  timezone     TEXT,
  next_fire_at INTEGER NOT NULL,
  PRIMARY KEY (cell, key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_schedule_index_next_fire_at
  ON schedule_index (next_fire_at);
```

### Upgrading an existing table

Schema init converts a `schedule_index` keyed by `(user_id, key)` on its
own: every existing row is assigned the person's own cell and keeps
firing. If you run with `skipSchemaInit: true`, apply the same change out
of band.

Postgres:

```sql
ALTER TABLE schedule_index ADD COLUMN IF NOT EXISTS cell text;
UPDATE schedule_index
   SET cell = replace(replace(user_id, '\', '\\'), ':', '\:')
 WHERE cell IS NULL;
ALTER TABLE schedule_index ALTER COLUMN cell SET NOT NULL;
ALTER TABLE schedule_index DROP CONSTRAINT schedule_index_pkey;
ALTER TABLE schedule_index ADD PRIMARY KEY (cell, key);
```

`schedule_index_pkey` is the name Postgres gives the primary key when the
table was created by the statement above. If yours has another name,
`SELECT conname FROM pg_constraint WHERE conrelid = 'schedule_index'::regclass AND contype = 'p'`
shows it.

SQLite can't change a primary key in place, so the table is rebuilt:

```sql
BEGIN IMMEDIATE;
ALTER TABLE schedule_index RENAME TO schedule_index_pre_cell;
DROP INDEX IF EXISTS idx_schedule_index_next_fire_at;
CREATE TABLE schedule_index (
  cell         TEXT NOT NULL,
  key          TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  org_id       TEXT,
  cron         TEXT NOT NULL,
  timezone     TEXT,
  next_fire_at INTEGER NOT NULL,
  PRIMARY KEY (cell, key)
) WITHOUT ROWID;
CREATE INDEX idx_schedule_index_next_fire_at ON schedule_index (next_fire_at);
INSERT INTO schedule_index (cell, key, user_id, org_id, cron, timezone, next_fire_at)
SELECT replace(replace(user_id, '\', '\\'), ':', '\:'),
       key, user_id, org_id, cron, timezone, next_fire_at
  FROM schedule_index_pre_cell;
DROP TABLE schedule_index_pre_cell;
COMMIT;
```

The `replace` calls matter only for user ids containing `:` or `\`; they
match how user storage keys are written.

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

Key your storage on `cell` and `key`, not on `userId`: two rows for one
person and one key are normal when the person has schedules in more than
one storage cell. `orgId` and `cell` both have to survive the round trip,
so store what `upsert` hands you and return it from `claimDue`. Map your
storage's null `orgId` back to `undefined` rather than to an empty string,
the way the provided adapters do.

A conformance suite is published at `@flow-state-dev/scheduled/testing`:

```ts
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";

createScheduleIndexConformanceTests("my-backend", {
  createIndex: () => /* ... */,
  cleanup: (idx) => /* ... */
});
```

Drop that inside a vitest file and it will exercise upsert idempotence,
claim+advance, the organization round trip, two cells for one person
and key, the bad-cron skip path,
no-op remove, and the limit parameter.

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

## See also

- [Scheduled actions](./scheduled.md) — the dispatch contract and `defineFlow.schedules`.
- [Scheduled actions on Vercel Cron](/guides/scheduled-vercel-cron) — host-side wiring.
- [Dynamic scheduled actions](/guides/scheduled-dynamic) — when and why dynamic schedules.
- [Deploying to Vercel](/guides/deploying-to-vercel) and [Deploying to Railway](/guides/deploying-to-railway) — broader deployment context.
