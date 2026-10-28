/**
 * Scheduled times relative to the real clock, for tests that fire through the
 * endpoint: a time more than one period behind the latest due one is stale and
 * runs nothing, so a fixed calendar date stops working once it ages.
 */
import { CronExpressionParser } from "cron-parser";

/** The latest scheduled time of `cron` already due, then the one before it, as ISO strings. */
export function recentTimes(cron: string, timezone = "UTC"): { latest: string; previous: string } {
  const times = CronExpressionParser.parse(cron, { tz: timezone, currentDate: new Date(Date.now() + 1) });
  const latest = times.prev().toDate().toISOString();
  const previous = times.prev().toDate().toISOString();
  return { latest, previous };
}
