/**
 * How long a run took, in words: `formatRunDuration(324_000)` is
 * `"5 mins, 24 seconds"`.
 *
 * The coding harness adapters (Claude Code, Codex, Cursor) end a run with a
 * status that says how long it took. Hours and minutes are shown to two units
 * at most, so a long run reads `"1 hr, 3 mins"` and not a list of seconds.
 */

/** One unit of a duration, as `"1 min"` or `"5 mins"`. */
function unit(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Words for a duration in milliseconds, rounded to the nearest second. A
 * duration under half a second, or one that is negative or not a number (a
 * clock that ran backwards), is `"less than a second"`.
 *
 * @param ms The duration in milliseconds.
 */
export function formatRunDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.round(ms / 1000) : 0;
  if (total < 1) return "less than a second";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(unit(hours, "hr", "hrs"));
    if (minutes > 0) parts.push(unit(minutes, "min", "mins"));
  } else {
    if (minutes > 0) parts.push(unit(minutes, "min", "mins"));
    if (seconds > 0) parts.push(unit(seconds, "second", "seconds"));
  }
  return parts.join(", ");
}
