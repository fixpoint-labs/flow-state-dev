/**
 * Read a `PACKAGE.md`'s text into what a package says: a description for people
 * and a body of instructions for the worker.
 *
 * **Text in, never a path.** Nothing here knows where a package sits or how it
 * was found — the loader walks the tree and hands the file's contents over. A
 * package stored somewhere other than a file is then a new caller of this
 * function, not a change to it.
 *
 * Shares the `WORKER.md`/`TEAM.md`/`SKILL.md` frontmatter dialect, parsed with
 * the same helpers every other convention reader here uses. Stricter than the
 * others in one way: `description` is the only key a package may declare. What
 * a package is for is its body and its `blocks/` folder, and a key it did not
 * need is one an author would expect to do something.
 *
 * Node-free, so it sits on the package root beside the records.
 */

import { parseFrontmatterYaml, splitFrontmatter } from "@flow-state-dev/orchestration";
import { PACKAGE_MD } from "./manifest";

/** The one key a `PACKAGE.md`'s frontmatter may hold. */
const DESCRIPTION_KEY = "description";

/** What a `PACKAGE.md` says. */
export interface PackageText {
  /** A label for people. Required, and never handed to a model. */
  description: string;
  /** The instructions, verbatim, frontmatter removed. May be empty for a tools-only package. */
  body: string;
}

/**
 * Read one `PACKAGE.md`'s text, or say why it is refused.
 *
 * The refusal names no file — the caller knows where the text came from and
 * prefixes it — but it does name the key or the gap, so an author knows which
 * line to change. Every extra key is named, not only the first.
 *
 * @param text The file's whole contents.
 * @returns The description and body, or `{ refusal }`.
 */
export function readPackage(text: string): PackageText | { refusal: string } {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml.trim().length === 0) {
    return {
      refusal: `has no frontmatter — a ${PACKAGE_MD} needs at least a \`${DESCRIPTION_KEY}\``
    };
  }

  const declared = parseFrontmatterYaml(yaml);
  const extra = Object.keys(declared).filter((key) => key !== DESCRIPTION_KEY);
  if (extra.length > 0) {
    return {
      refusal:
        `declares ${extra.map((key) => `\`${key}:\``).join(", ")}. A ${PACKAGE_MD} declares ` +
        `\`${DESCRIPTION_KEY}\` and nothing else: its instructions are its body, and its tools ` +
        `are the files in its \`blocks/\` folder.`
    };
  }

  const description = declared[DESCRIPTION_KEY];
  if (typeof description !== "string" || description.trim().length === 0) {
    return { refusal: `must declare a non-empty \`${DESCRIPTION_KEY}\`` };
  }

  return { description, body };
}
