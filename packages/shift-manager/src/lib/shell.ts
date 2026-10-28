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
