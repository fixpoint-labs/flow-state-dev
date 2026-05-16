/**
 * Per-process dedup for bad-cron warnings emitted from `ScheduleIndex`
 * implementations.
 *
 * A row whose cron string fails to parse is skipped without advancing
 * `nextFireAt`, so it reappears on every `claimDue` tick. Logging
 * unconditionally would produce one warning per minute per bad row.
 * The first time we see a `(userId, key)` we log; further occurrences
 * in the same process are silent until restart.
 *
 * The set is bounded by the number of distinct bad keys the process
 * ever sees — operationally negligible. Logged once is enough for an
 * operator to find and fix the row.
 */

/**
 * Build a one-shot bad-cron warn function for a `ScheduleIndex` impl.
 * `prefix` is prepended to the log line so the source store is obvious
 * (e.g. `"[flow-state/store-postgres]"`).
 */
export function createBadCronWarner(prefix: string): (
  userId: string,
  key: string,
  cron: string,
  err: unknown
) => void {
  const warned = new Set<string>();
  return function warnBadCron(userId, key, cron, err) {
    const k = `${userId}/${key}`;
    if (warned.has(k)) return;
    warned.add(k);
    // eslint-disable-next-line no-console
    console.warn(
      `${prefix} schedule_index row ${k} has unparseable cron "${cron}"; skipping advance`,
      err
    );
  };
}
