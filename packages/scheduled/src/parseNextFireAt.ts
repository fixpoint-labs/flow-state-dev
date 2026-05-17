/**
 * Centralised wrapper around `cron-parser`. Owning a single call site
 * keeps the dependency contract in one package — store adapters
 * implementing `ScheduleIndex` can mirror cron-string semantics
 * without taking `cron-parser` as a direct dependency.
 */

import { CronExpressionParser } from "cron-parser";

/**
 * Parse `cron` (POSIX five-field) and return the next firing time in
 * ms since epoch. Returns `null` if the expression is unparseable —
 * callers decide how to surface that (write-time rejection vs.
 * claim-time skip-and-warn).
 */
export function parseNextFireAt(cron: string, tz?: string): number | null {
  try {
    return CronExpressionParser.parse(cron, { tz })
      .next()
      .toDate()
      .getTime();
  } catch {
    return null;
  }
}
