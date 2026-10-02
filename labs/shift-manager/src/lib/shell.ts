/**
 * Small derivations the sidebar and Chief of Staff draw in design v2's form:
 * the person's initials in the footer (v2:110), a clock time on a line
 * (v2:135), and the lines Chief of Staff offers to start a message with
 * (v2:174). Each is drawn from what the Lab already holds; none invents a
 * value the Lab doesn't.
 */
import { streamCounts, type LoadedSnapshot } from "./derive";

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
 * The lines Chief of Staff offers above its composer, each of which only
 * fills the draft. v2 offers the question about what blocks a stream for the
 * one that needs the person (or, with none, the first one running), and
 * always "Who's on call?". A Lab with neither gets the one.
 */
export function chiefOfStaffSuggestions(snapshot: LoadedSnapshot): string[] {
  const streams = streamCounts(snapshot);
  const lines: string[] = [];
  if (streams.ok) {
    const needs = streams.value.find((s) => (s.needsYou ?? 0) > 0);
    const live = streams.value.find((s) => s.running.ok && s.running.value > 0);
    const stream = needs ?? live;
    if (stream !== undefined) lines.push(`What's blocking #${stream.workstream.id}?`);
  }
  lines.push("Who's on call?");
  return lines;
}
