/**
 * Small derivations the sidebar and Shift Coordinator draw in design v2's form:
 * the user's initials in the footer (v2:110), a clock time on a line
 * (v2:135), and the lines Shift Coordinator offers to start a message with
 * (v2:174). Each is drawn from what the Lab already holds; none invents a
 * value the Lab doesn't.
 */

/**
 * Up to two initials for a user id: the first letter of each of its first two
 * words, split on anything not a letter or digit. A one-letter first word is
 * a prefix (`u_devforce_lab` reads DL), dropped while another word follows. A
 * one-word id gives its first two letters.
 */
export function initialsOf(userId: string): string {
  let words = userId.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  if (words.length > 1 && words[0]!.length === 1) words = words.slice(1);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[1]![0]}`;
  return letters.toUpperCase();
}

/** A time of day as 24-hour `HH:MM`, in the page's time zone. */
export function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * The calendar day an instant falls on, as `YYYY-MM-DD`, in `timeZone` (the
 * page's time zone when absent, as {@link clockTime} reads it). Two instants
 * share a day exactly when their keys are equal.
 */
export function dayKey(epochMs: number, timeZone?: string): string {
  return new Date(epochMs).toLocaleDateString("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * The label on the feed's marker for the day `epochMs` falls on: its date as
 * `Thu 19 Nov` (with the year when it isn't `now`'s), led by `Today` or
 * `Yesterday` when it is one of those, in `timeZone` (the page's when absent).
 */
export function dayLabel(epochMs: number, now: number, timeZone?: string): string {
  const at = new Date(epochMs);
  const sameYear = at.toLocaleDateString("en-CA", { timeZone, year: "numeric" }) === new Date(now).toLocaleDateString("en-CA", { timeZone, year: "numeric" });
  const date = at
    .toLocaleDateString("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
    .replace(",", "");
  const day = dayKey(epochMs, timeZone);
  if (day === dayKey(now, timeZone)) return `Today · ${date}`;
  // The day before `now`'s, stepped back on the calendar date itself, so no day length or offset can skip it.
  const [y, m, d] = dayKey(now, timeZone).split("-").map(Number);
  if (day === new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10)) return `Yesterday · ${date}`;
  return date;
}

/**
 * `entries` with a day marker between the last entry of one day and the first
 * of the next, in `timeZone` (the page's when absent): the new day's key and
 * the instant of its first entry. Only a crossing is marked: nothing goes
 * before the first entry.
 */
export function withDayMarkers<T>(entries: readonly T[], tsOf: (entry: T) => number, timeZone?: string) {
  const out: Array<T | { kind: "day"; day: string; at: number }> = [];
  let previous: string | undefined;
  for (const entry of entries) {
    const at = tsOf(entry);
    const day = dayKey(at, timeZone);
    if (previous !== undefined && day !== previous) out.push({ kind: "day", day, at });
    previous = day;
    out.push(entry);
  }
  return out;
}
