/**
 * SQLite-backed `ScheduleIndex` for `@flow-state-dev/scheduled`'s
 * polling tick.
 *
 * better-sqlite3 is synchronous and single-writer; `claimDue` uses
 * `db.transaction(...).immediate` (BEGIN IMMEDIATE) to read + advance
 * the batch atomically. better-sqlite3's default is BEGIN DEFERRED,
 * which doesn't acquire a write lock until the first write — two
 * callers could both pass the SELECT and return the same rows. The
 * `.immediate` modifier escalates the lock at BEGIN, so concurrent
 * claimDue calls serialize. The interface is async-shaped so a
 * deployment can swap in a remote `ScheduleIndex` without changing
 * call sites.
 */

import type Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import {
  createBadCronWarner,
  type ScheduleIndex,
  type ScheduleIndexRow
} from "@flow-state-dev/scheduled";

/**
 * Build a `ScheduleIndex` backed by the `schedule_index` table in the
 * given better-sqlite3 database. Caller owns the `Database` lifecycle.
 */
export function createSQLiteScheduleIndex(db: Database.Database): ScheduleIndex {
  const warnBadCron = createBadCronWarner("[flow-state/store-sqlite]");
  const upsertStmt = db.prepare(
    `INSERT INTO schedule_index (user_id, key, cron, timezone, next_fire_at)
     VALUES (@userId, @key, @cron, @timezone, @nextFireAt)
     ON CONFLICT (user_id, key) DO UPDATE SET
       cron = excluded.cron,
       timezone = excluded.timezone,
       next_fire_at = excluded.next_fire_at`
  );

  const removeStmt = db.prepare(
    "DELETE FROM schedule_index WHERE user_id = ? AND key = ?"
  );

  const selectDueStmt = db.prepare(
    `SELECT user_id, key, cron, timezone, next_fire_at
       FROM schedule_index
      WHERE next_fire_at <= ?
      ORDER BY next_fire_at
      LIMIT ?`
  );

  const advanceStmt = db.prepare(
    "UPDATE schedule_index SET next_fire_at = ? WHERE user_id = ? AND key = ?"
  );

  // `.immediate` wraps the callback in BEGIN IMMEDIATE / COMMIT (with
  // automatic ROLLBACK on throw). Single-writer SQLite means we don't
  // need SKIP LOCKED — BEGIN IMMEDIATE serializes claimDue calls
  // against each other and against writers. The plain `db.transaction`
  // default is DEFERRED, which would let concurrent callers both pass
  // the SELECT before either escalates to a write lock.
  const claimDueTx = db.transaction((now: number, limit: number): ScheduleIndexRow[] => {
    const rows = selectDueStmt.all(now, limit) as Array<{
      user_id: string;
      key: string;
      cron: string;
      timezone: string | null;
      next_fire_at: number;
    }>;

    const claimed: ScheduleIndexRow[] = [];
    for (const row of rows) {
      const timezone = row.timezone ?? undefined;
      let next: number;
      try {
        next = CronExpressionParser.parse(row.cron, { tz: timezone })
          .next()
          .toDate()
          .getTime();
      } catch (err) {
        warnBadCron(row.user_id, row.key, row.cron, err);
        continue;
      }
      claimed.push({
        userId: row.user_id,
        key: row.key,
        cron: row.cron,
        timezone,
        nextFireAt: row.next_fire_at
      });
      advanceStmt.run(next, row.user_id, row.key);
    }
    return claimed;
  }).immediate;

  return {
    async upsert(row: ScheduleIndexRow): Promise<void> {
      upsertStmt.run({
        userId: row.userId,
        key: row.key,
        cron: row.cron,
        timezone: row.timezone ?? null,
        nextFireAt: row.nextFireAt
      });
    },

    async remove(userId: string, key: string): Promise<void> {
      removeStmt.run(userId, key);
    },

    async claimDue(now: number, limit = 100): Promise<ScheduleIndexRow[]> {
      return claimDueTx(now, limit);
    }
  };
}
