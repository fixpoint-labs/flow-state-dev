/**
 * The conversation's day breaks: where two lines in a row were written on
 * different local calendar days, the later one opens with a divider named
 * Today, Yesterday, or the day's date ("Mon, Nov 16"; with its year when it
 * isn't this year's).
 *
 *     const breaks = dayBreaks(lines.map(lineTime), new Date());
 *     breaks[i] // "Yesterday" before line i, or undefined
 *
 * Pure: the page passes its clock in.
 */
import type { ItemLine } from "@flow-state-dev/react";

/** When a line was written: its item's time, a steps line's first step's; a stopped line has none of its own. */
export function lineTime(line: ItemLine): number | undefined {
  if (line.kind === "stopped") return undefined;
  return line.kind === "steps" ? line.items[0]?.ts : line.item.ts;
}

/** Local midnight of the day `at` falls on. */
const dayOf = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate());

/** What the divider before a line written at `at` reads, seen on `now`. */
export function dayLabel(at: number, now: Date): string {
  const day = dayOf(new Date(at));
  // Rounded: a day with a clock change is 23 or 25 hours long.
  const ago = Math.round((dayOf(now).getTime() - day.getTime()) / 86_400_000);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  return day.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * The divider before each line, by index: a label where the line's day isn't
 * the day of the last line before it with a time, `undefined` elsewhere. The
 * first line with a time opens none, and a line with no time (`undefined`)
 * neither opens one nor moves the day.
 */
export function dayBreaks(times: readonly (number | undefined)[], now: Date): (string | undefined)[] {
  let previous: number | undefined;
  return times.map((at) => {
    if (at === undefined) return undefined;
    const day = dayOf(new Date(at)).getTime();
    const changed = previous !== undefined && previous !== day;
    previous = day;
    return changed ? dayLabel(at, now) : undefined;
  });
}
