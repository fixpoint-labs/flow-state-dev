/**
 * Scheduled times relative to the real clock, for tests that fire through the
 * endpoint: a time more than one period behind the latest due one is stale and
 * runs nothing, so a fixed calendar date stops working once it ages.
 */
import { latestScheduledTime } from "@flow-state-dev/core/internal";

/** The latest scheduled time of `cron` already due, then the one before it, as ISO strings. */
export function recentTimes(cron: string, timezone = "UTC"): { latest: string; previous: string } {
  const latest = latestScheduledTime(cron, timezone, Date.now());
  const previous = latest === null ? null : latestScheduledTime(cron, timezone, latest - 1);
  if (latest === null || previous === null) throw new Error(`"${cron}" has no recent scheduled times`);
  return { latest: new Date(latest).toISOString(), previous: new Date(previous).toISOString() };
}
