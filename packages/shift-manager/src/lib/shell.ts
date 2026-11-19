/**
 * Small derivations the sidebar and Shift Coordinator draw in design v2's form:
 * the user's initials in the footer (v2:110), a clock time on a line
 * (v2:135), the lines Shift Coordinator offers to start a message with
 * (v2:174), and the day a feed's day marker names. Each is drawn from what
 * the Lab already holds; none invents a value the Lab doesn't.
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

/**
 * A time of day as 24-hour `HH:MM`, in the page's time zone. Not the zone a feed's
 * day turns over in ({@link feedDay}, New York): the two differ outside New York.
 */
export function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The zone a feed's day turns over in, wherever the page is opened. Line times ({@link clockTime}) stay in the page's zone. */
const FEED_TIME_ZONE = "America/New_York";
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: FEED_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabelFormat = new Intl.DateTimeFormat("en-US", { timeZone: FEED_TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** The New York calendar day a moment falls on, as `YYYY-MM-DD`: two moments share a day when their keys match. */
export function feedDay(epochMs: number): string {
  return dayKeyFormat.format(epochMs);
}

/** A New York calendar day as a feed's day marker names it: `Thursday, November 19, 2026`. */
export function feedDayLabel(epochMs: number): string {
  return dayLabelFormat.format(epochMs);
}
