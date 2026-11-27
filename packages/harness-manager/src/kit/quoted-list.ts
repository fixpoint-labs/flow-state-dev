/**
 * How the coding flow's refusals list names: quoted, comma-separated, the last
 * two joined by "and" (`"implement" and "answer"`). One helper, so a refusal
 * at start and one at filing word a list the same way.
 */

/** `names` quoted and listed, as a refusal names them. */
export function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}
