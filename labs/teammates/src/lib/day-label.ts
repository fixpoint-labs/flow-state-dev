/** The conversation's day breaks: what a day's divider says. */

/** A day as its divider says it: *Today*, *Yesterday*, else its date, "Mon, Nov 21". */
export function dayLabel(ts: number, now: number = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day(ts) === yesterday.toDateString()) return "Yesterday";
  return new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
