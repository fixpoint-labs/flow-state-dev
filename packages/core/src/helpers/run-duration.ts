/**
 * How long a coding-harness run took, in words. Claude Code, Codex and
 * Cursor append this to a finished run's status.
 */

function unit(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Words for a duration in milliseconds, rounded to the nearest second.
 * An hour or more shows hours and minutes only (`"1 hr, 3 mins"`). Under
 * half a second, a negative number, or `NaN` is `"less than a second"`.
 *
 * @param ms The duration in milliseconds.
 */
export function formatRunDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.round(ms / 1000) : 0;
  if (total < 1) return "less than a second";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = hours > 0 ? [unit(hours, "hr", "hrs")] : [];
  if (minutes > 0) parts.push(unit(minutes, "min", "mins"));
  if (hours === 0 && seconds > 0) parts.push(unit(seconds, "second", "seconds"));
  return parts.join(", ");
}
