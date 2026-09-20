/**
 * How a refusal names a value it will not accept: short, quoted, and never a
 * sprawling dump.
 *
 * Shared by the two seat-declaration modules — `./seat-resources` and
 * `./seat-references` — because an author who mis-indents one key and then the
 * other should not get two different descriptions of the same mistake. It
 * moved here from `seat-resources` when the second caller arrived; a second
 * copy is how "a mapping of 2 key(s)" and "an object" end up in one file.
 */

/** A value as a refusal names it. */
export function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `a list of ${value.length}`;
  return `a mapping of ${Object.keys(value as object).length} key(s)`;
}
