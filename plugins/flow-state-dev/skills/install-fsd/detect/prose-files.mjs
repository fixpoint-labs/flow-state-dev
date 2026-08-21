/**
 * Delimiter accounting for the two files this skill appends a section to — `.gitignore` and
 * `AGENTS.md`.
 *
 * Not "does it have a section". **Count them, with line numbers**, because the answer decides
 * between three different actions and one of the three is destructive if it fires on the wrong
 * state. An unmatched start delimiter turns "replace our section" into "delete to end of file" in
 * a file the developer owns — in a `.gitignore` that is their whole ignore list. And more than one
 * section has no defensible pick: replacing one leaves the other as orphaned content nothing will
 * ever update again, and replacing both rewrites a region we did not author.
 */
import { SECTION_DELIMITERS } from "./constants.mjs";
import { readIfPresent } from "./fs-util.mjs";

/** Which delimiter pair a file uses, by extension. Markdown gets HTML comments; the rest get `#`. */
export function delimitersFor(path) {
  return path.endsWith(".md") ? SECTION_DELIMITERS.markdown : SECTION_DELIMITERS.hash;
}

/**
 * Every delimiter in a file, in order, with its line number — and the verdict that follows.
 *
 * - `absent` (zero of each) → the run appends a section
 * - `balanced` (exactly one start, then one end) → the run replaces between them
 * - anything else → **refuse**, naming the file and every delimiter line
 */
export function accountDelimiters(path) {
  const content = readIfPresent(path);
  if (content === null) {
    return { path, present: false, delimiters: [], verdict: "absent" };
  }

  const { start, end } = delimitersFor(path);
  const delimiters = [];
  content.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === start) delimiters.push({ line: index + 1, kind: "start" });
    else if (trimmed === end) delimiters.push({ line: index + 1, kind: "end" });
  });

  const verdict =
    delimiters.length === 0
      ? "absent"
      : delimiters.length === 2 && delimiters[0].kind === "start" && delimiters[1].kind === "end"
        ? "balanced"
        : "malformed";

  return { path, present: true, delimiters, verdict };
}
