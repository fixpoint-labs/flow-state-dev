# FIX-1546 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Reference-page and README edits only; no new page, no guide. Flow authors write nothing new, so
the guides that show `defineScheduleCollection` stay as they are. The hand-rolled polling loop in
`apps/docs/guides/scheduled-dynamic.md` is the reader's own table, not the interface, and is left
alone. Voice watch-outs: introduce "storage cell" in plain words on first use, no sentences opening
with "This", no issue numbers.

## UPDATE · `apps/docs/docs/server/schedule-index.md` · "How it works", first paragraph

> The index trades a small amount of write-side work for a constant-time read. Each
> create/update/delete on the schedule collection mirrors a row into a flat
> `(cell, key, user_id, org_id, cron, timezone, next_fire_at)` table. A row is identified by
> `cell` and `key`: the cell is where the schedule itself is stored, so one schedule always maps
> to exactly one row. For an ordinary flow the cell is the person's own storage; a
> [hired seat](/docs/workforce/durable-hire#what-a-seat-saves-for-a-person) stores per
> organization and person, so Alice's seats in two organizations can each have a schedule named
> `weekly` without touching each other's row. Each cron tick claims rows where
> `next_fire_at <= now`, advances them in place using `cron-parser`, and returns them. The
> contract is at-most-once: a row that has been advanced and then fails to dispatch is dropped,
> not retried.

## UPDATE · same page · "Interface" code block and the paragraph after it

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

> Treat `cell` as an opaque string: store it and compare it, never parse it.
> `defineScheduleCollection` fills it in for you.

## UPDATE · same page · "Schema setup", both DDL blocks

Postgres and SQLite each gain `cell` and change the key. Postgres shown; SQLite is the same with its
own types and `WITHOUT ROWID`:

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
```

Add after the blocks:

> **Upgrading an existing table.** Schema init converts a `schedule_index` keyed by
> `(user_id, key)` on its own: every existing row is assigned the person's own cell and keeps
> firing. If you run with `skipSchemaInit: true`, apply the same change out of band. On Postgres:
>
> ```sql
> ALTER TABLE schedule_index ADD COLUMN IF NOT EXISTS cell text;
> UPDATE schedule_index
>    SET cell = replace(replace(user_id, '\', '\\'), ':', '\:')
>  WHERE cell IS NULL;
> ALTER TABLE schedule_index ALTER COLUMN cell SET NOT NULL;
> ALTER TABLE schedule_index DROP CONSTRAINT schedule_index_pkey;
> ALTER TABLE schedule_index ADD PRIMARY KEY (cell, key);
> ```
>
> The `replace` calls matter only for user ids containing `:` or `\`; they match how user
> storage keys are written.

(Implementer: confirm the constraint name and the SQLite rebuild statement against S5/S6 and
publish the SQLite form too.)

## UPDATE · same page · "Custom implementations"

Replace the `orgId` paragraph with:

> Key your storage on `cell` and `key`, not on `userId`: two rows for one person and one key are
> normal when the person has schedules in more than one storage cell. `orgId` and `cell` both have
> to survive the round trip, so store what `upsert` hands you and return it from `claimDue`. Map
> your storage's null `orgId` back to `undefined` rather than to an empty string, the way the
> provided adapters do.

And in the conformance paragraph, after "the organization round trip,": "two cells for one person
and key,".

## UPDATE · `apps/docs/docs/persistence/overview.md` · "Upgrading: moving hired seats' stored data", end of step 5

> A copied schedule is not in the schedule index yet. Write it once from the seat, for example by
> re-saving it, so its index row is created under the seat's cell. The original schedule and its
> index row stay where they were, like every other original.

## UPDATE · `packages/scheduled/README.md` · "Schedule index", end of first paragraph

> Rows are identified by the schedule's storage cell and key, so one schedule is always one row.

## UPDATE · `packages/scheduled/README.md` · conformance paragraph

"Covers upsert idempotence, one row per storage cell, atomic claim+advance, no-op remove, bad-cron
skip, and the `limit` parameter."

## Publication ownership

FIX-1546 owns every operation above and publishes them after the migration checks pass. The
`bullmq` guide's schedule-index section describes behaviour that does not change and is left as is.
