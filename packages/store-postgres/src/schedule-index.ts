/**
 * Postgres-backed `ScheduleIndex` implementation for the
 * `@flow-state-dev/scheduled` polling tick.
 *
 * The factory requires a `QueryExecutor` that implements `beginTx()`
 * — `claimDue` runs `SELECT ... FOR UPDATE SKIP LOCKED` followed by a
 * batched UPDATE inside one transaction, which only works against a
 * pinned connection. Both built-in pool-backed executors created by
 * `createPostgresStores` satisfy this; callers using a custom
 * `QueryExecutor` must implement `beginTx` themselves (e.g. via the
 * single-connection backends like PGlite).
 */

import { CronExpressionParser } from "cron-parser";
import type { ScheduleIndex, ScheduleIndexRow } from "@flow-state-dev/scheduled";
import type { QueryExecutor } from "./types";

/**
 * Build a `ScheduleIndex` backed by the `schedule_index` table.
 *
 * The executor must implement `beginTx()` — `claimDue` uses
 * `SELECT ... FOR UPDATE SKIP LOCKED` which requires a pinned
 * connection. Pool-backed executors from `createPostgresStores`
 * satisfy this; custom executors must implement it themselves.
 */
export function createPostgresScheduleIndex(executor: QueryExecutor): ScheduleIndex {
  // De-dupe bad-cron warnings within a process. The row stays at its
  // current nextFireAt so it keeps reappearing in claimDue (the spec
  // chose loud repeat over silent drop), but we only log the first
  // time we encounter each key — otherwise a single bad row produces
  // unbounded log volume.
  const warned = new Set<string>();

  return {
    async upsert(row: ScheduleIndexRow): Promise<void> {
      await executor.query(
        `INSERT INTO schedule_index (user_id, key, cron, timezone, next_fire_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, key) DO UPDATE SET
           cron = EXCLUDED.cron,
           timezone = EXCLUDED.timezone,
           next_fire_at = EXCLUDED.next_fire_at`,
        [row.userId, row.key, row.cron, row.timezone ?? null, row.nextFireAt]
      );
    },

    async remove(userId: string, key: string): Promise<void> {
      await executor.query(
        "DELETE FROM schedule_index WHERE user_id = $1 AND key = $2",
        [userId, key]
      );
    },

    async claimDue(now: number, limit = 100): Promise<ScheduleIndexRow[]> {
      const tx = await executor.beginTx!();
      try {
        const sel = await tx.query(
          `SELECT user_id, key, cron, timezone, next_fire_at
             FROM schedule_index
            WHERE next_fire_at <= $1
            ORDER BY next_fire_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED`,
          [now, limit]
        );

        const claimed: ScheduleIndexRow[] = [];
        const advances: Array<{ userId: string; key: string; next: number }> = [];

        for (const row of sel.rows) {
          const userId = row.user_id as string;
          const key = row.key as string;
          const cron = row.cron as string;
          const timezone = (row.timezone as string | null) ?? undefined;
          const fired = Number(row.next_fire_at);

          let next: number;
          try {
            next = CronExpressionParser.parse(cron, { tz: timezone })
              .next()
              .toDate()
              .getTime();
          } catch (err) {
            // Bad cron: skip — do NOT advance the row. Without an
            // advance the row will reappear on every tick. Log once
            // per (user_id, key) per process so operators surface it
            // without unbounded log volume.
            const warnKey = `${userId}/${key}`;
            if (!warned.has(warnKey)) {
              warned.add(warnKey);
              // eslint-disable-next-line no-console
              console.warn(
                `[flow-state/store-postgres] schedule_index row ${warnKey} has unparseable cron "${cron}"; skipping advance`,
                err
              );
            }
            continue;
          }

          claimed.push({ userId, key, cron, timezone, nextFireAt: fired });
          advances.push({ userId, key, next });
        }

        if (advances.length > 0) {
          // Batched UPDATE via a VALUES table. Placeholders: each row
          // consumes 3 params (user_id, key, next).
          const valueRows: string[] = [];
          const params: unknown[] = [];
          for (let i = 0; i < advances.length; i++) {
            const base = i * 3;
            // Cast the bigint to ensure the VALUES table column types
            // match the target column (otherwise Postgres may infer text).
            valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}::bigint)`);
            params.push(advances[i].userId, advances[i].key, advances[i].next);
          }
          const sql = `UPDATE schedule_index AS s
             SET next_fire_at = v.next
             FROM (VALUES ${valueRows.join(", ")}) AS v(user_id, key, next)
             WHERE s.user_id = v.user_id AND s.key = v.key`;
          await tx.query(sql, params);
        }

        await tx.commit();
        return claimed;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          // swallow rollback errors — surface the original
        }
        throw err;
      }
    }
  };
}
